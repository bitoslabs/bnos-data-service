/**
 * Authentication orchestration.
 *
 * One-time invite -> signed challenge -> short-lived session + rotating refresh.
 * All secrets are returned once and stored only as SHA-256 hashes.
 */
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import {
	consumeChallenge,
	createChallenge,
	findChallengeById,
	findSessionByRefreshHash,
	findSessionByTokenHash,
	insertSession,
	revokeByRefreshHash,
	revokeByTokenHash,
	revokeFamily,
	revokeSessionIfActive
} from '../db/auth.js';
import {
	consumeInvite,
	findInviteByCodeHash,
	findInviteById
} from '../db/invites.js';
import { hashSecret, randomHex, randomToken } from '../domain/hash.js';
import { forbidden, unauthorized } from '../domain/errors.js';
import { verifyAuthEvent } from '../domain/nostr.js';
import { expectedVerifyUrl } from '../domain/url.js';
import {
	findActiveMember,
	findWorkspace,
	upsertMember,
	type MemberRow
} from '../db/workspaces.js';
import { recordAudit } from '../db/audit.js';

export const DEFAULT_PERMISSIONS = [
	'backup.write',
	'status.read',
	'reports.read',
	'reports.write'
] as const;

export interface SessionContext {
	readonly pubkey: string;
	readonly workspaceId: string;
	readonly workspaceName: string;
	readonly permissions: readonly string[];
	readonly expiresAt: Date;
}

export interface SessionResponse {
	token: string;
	expiresAt: number;
	user: { pubkey: string };
	workspace: { id: string; name: string };
	permissions: string[];
	refreshToken: string;
	refreshExpiresAt: number;
}

export interface ChallengeResponse {
	challengeId: string;
	nonce: string;
	audience: string;
	expiresAt: number;
	serviceId: string;
	kind: number;
}

interface AuthDeps {
	db: Kysely<Database>;
	config: Config;
}

function seconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

function expiresIn(now: Date, ttlSeconds: number): Date {
	return new Date(now.getTime() + ttlSeconds * 1000);
}

export function hasPermission(context: SessionContext, permission: string): boolean {
	return context.permissions.includes(permission);
}

export async function issueChallenge(
	{ db, config }: AuthDeps,
	input: { invite: string; pubkey: string; workspaceId: string },
	now: Date
): Promise<ChallengeResponse> {
	const codeHash = hashSecret(input.invite);
	const invite = await findInviteByCodeHash(db, codeHash);

	if (!invite || invite.used_at || invite.expires_at <= now) {
		throw unauthorized('Invalid setup code');
	}
	if (invite.workspace_id !== input.workspaceId) {
		throw forbidden('The setup code belongs to a different workspace');
	}
	if (invite.pubkey && invite.pubkey !== input.pubkey) {
		throw forbidden('The setup code is bound to a different identity');
	}

	const workspace = await findWorkspace(db, input.workspaceId);
	if (!workspace) throw unauthorized('Invalid setup code');

	const member = await findActiveMember(db, input.workspaceId, input.pubkey);
	if (!member && invite.pubkey !== input.pubkey) {
		throw forbidden('This identity is not a member of the workspace');
	}

	const challengeId = `chl_${randomHex(16)}`;
	const nonce = randomToken(24);
	const expiresAt = expiresIn(now, config.challengeTtlSeconds);

	await createChallenge(db, {
		id: challengeId,
		nonce,
		inviteId: invite.id,
		workspaceId: input.workspaceId,
		pubkey: input.pubkey,
		audience: config.audience,
		expiresAt
	});

	await recordAudit(db, {
		workspaceId: input.workspaceId,
		actorPubkey: input.pubkey,
		action: 'auth.challenge',
		detail: { challengeId }
	});

	return {
		challengeId,
		nonce,
		audience: config.audience,
		expiresAt: seconds(expiresAt),
		serviceId: config.serviceId,
		kind: 27235
	};
}

async function issueSession(
	db: Kysely<Database>,
	config: Config,
	input: {
		pubkey: string;
		workspace: { id: string; name: string };
		permissions: string[];
		familyId?: string;
	},
	now: Date
): Promise<SessionResponse> {
	const token = randomToken(32);
	const refreshToken = randomToken(32);
	const expiresAt = expiresIn(now, config.accessTokenTtlSeconds);
	const refreshExpiresAt = expiresIn(now, config.refreshTokenTtlSeconds);

	await insertSession(db, {
		tokenHash: hashSecret(token),
		pubkey: input.pubkey,
		workspaceId: input.workspace.id,
		permissions: input.permissions,
		expiresAt,
		refreshTokenHash: hashSecret(refreshToken),
		refreshExpiresAt,
		familyId: input.familyId ?? randomUUID()
	});

	return {
		token,
		expiresAt: seconds(expiresAt),
		user: { pubkey: input.pubkey },
		workspace: input.workspace,
		permissions: input.permissions,
		refreshToken,
		refreshExpiresAt: seconds(refreshExpiresAt)
	};
}

function permissionsFor(member: MemberRow | undefined, invitePermissions: string[]): string[] {
	if (member && member.permissions.length) return [...member.permissions];
	if (invitePermissions.length) return [...invitePermissions];
	return [...DEFAULT_PERMISSIONS];
}

export async function verifyChallenge(
	{ db, config }: AuthDeps,
	input: { challengeId: string; event: unknown },
	now: Date
): Promise<SessionResponse> {
	const challenge = await findChallengeById(db, input.challengeId);
	if (!challenge || challenge.used_at || challenge.expires_at <= now) {
		throw unauthorized('The challenge is invalid or expired');
	}

	const event = verifyAuthEvent(input.event, {
		url: expectedVerifyUrl(config.audience),
		audience: config.audience,
		workspaceId: challenge.workspace_id,
		nonce: challenge.nonce,
		now: seconds(now),
		maxClockSkewSeconds: config.maxClockSkewSeconds
	});
	if (event.pubkey !== challenge.pubkey) throw unauthorized('The challenge is invalid');

	const invite = await findInviteById(db, challenge.invite_id);
	if (!invite || invite.used_at || invite.expires_at <= now) {
		throw unauthorized('The setup code is no longer valid');
	}
	if (invite.workspace_id !== challenge.workspace_id) throw unauthorized('Invalid invite');
	if (invite.pubkey && invite.pubkey !== event.pubkey) throw unauthorized('Invalid invite');

	const workspace = await findWorkspace(db, challenge.workspace_id);
	if (!workspace) throw unauthorized('Workspace not found');

	const existingMember = await findActiveMember(db, challenge.workspace_id, event.pubkey);
	if (!existingMember && invite.pubkey !== event.pubkey) {
		throw forbidden('This identity is not a member of the workspace');
	}

	const permissions = permissionsFor(existingMember, invite.permissions);

	await db.transaction().execute(async (trx) => {
		const challengeUsed = await consumeChallenge(trx, challenge.id, now);
		if (!challengeUsed) throw unauthorized('The challenge was already used');
		const inviteUsed = await consumeInvite(trx, invite.id, event.pubkey, now);
		if (!inviteUsed) throw unauthorized('The setup code was already used');

		if (!existingMember) {
			await upsertMember(trx, {
				workspaceId: challenge.workspace_id,
				pubkey: event.pubkey,
				role: 'staff',
				permissions
			});
		}
	});

	await recordAudit(db, {
		workspaceId: challenge.workspace_id,
		actorPubkey: event.pubkey,
		action: 'auth.verify'
	});

	return issueSession(
		db,
		config,
		{
			pubkey: event.pubkey,
			workspace,
			permissions
		},
		now
	);
}

export async function refreshSession(
	{ db, config }: AuthDeps,
	refreshToken: string,
	now: Date
): Promise<SessionResponse> {
	const refreshHash = hashSecret(refreshToken);
	const session = await findSessionByRefreshHash(db, refreshHash);
	if (!session) throw unauthorized('Invalid refresh token');

	if (session.revoked_at) {
		await revokeFamily(db, session.family_id, now);
		throw unauthorized('Refresh token reuse detected');
	}
	if (!session.refresh_expires_at || session.refresh_expires_at <= now) {
		throw unauthorized('Refresh token expired');
	}

	const member = await findActiveMember(db, session.workspace_id, session.pubkey);
	if (!member) {
		await revokeFamily(db, session.family_id, now);
		throw forbidden('Membership revoked');
	}

	const workspace = await findWorkspace(db, session.workspace_id);
	if (!workspace) throw unauthorized('Workspace not found');

	const rotated = await db.transaction().execute(async (trx) => {
		const claimed = await revokeSessionIfActive(trx, session.token_hash, now);
		if (!claimed) {
			await revokeFamily(trx, session.family_id, now);
			throw unauthorized('Refresh token reuse detected');
		}
		return issueSession(
			trx,
			config,
			{
				pubkey: session.pubkey,
				workspace,
				permissions: member.permissions.length ? [...member.permissions] : [...DEFAULT_PERMISSIONS],
				familyId: session.family_id
			},
			now
		);
	});

	return rotated;
}

export async function logoutSession(
	db: Kysely<Database>,
	input: { token?: string; refreshToken?: string },
	now: Date
): Promise<void> {
	if (input.token) await revokeByTokenHash(db, hashSecret(input.token), now);
	if (input.refreshToken) await revokeByRefreshHash(db, hashSecret(input.refreshToken), now);
}

export async function authenticateToken(
	db: Kysely<Database>,
	token: string,
	now: Date
): Promise<SessionContext> {
	if (!token) throw unauthorized();
	const session = await findSessionByTokenHash(db, hashSecret(token));
	if (!session || session.expires_at <= now) throw unauthorized('Session expired');

	const member = await findActiveMember(db, session.workspace_id, session.pubkey);
	if (!member) throw unauthorized('Membership revoked');

	const workspace = await findWorkspace(db, session.workspace_id);
	if (!workspace) throw unauthorized('Workspace not found');

	return {
		pubkey: session.pubkey,
		workspaceId: workspace.id,
		workspaceName: workspace.name,
		permissions: member.permissions.length ? member.permissions : [...DEFAULT_PERMISSIONS],
		expiresAt: session.expires_at
	};
}
