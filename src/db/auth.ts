import type { Kysely } from 'kysely';
import type { Database } from './types.js';

export interface ChallengeRow {
	id: string;
	nonce: string;
	invite_id: string;
	workspace_id: string;
	pubkey: string;
	audience: string;
	expires_at: Date;
	used_at: Date | null;
}

export interface SessionRow {
	token_hash: Buffer;
	pubkey: string;
	workspace_id: string;
	permissions: string[];
	expires_at: Date;
	refresh_token_hash: Buffer | null;
	refresh_expires_at: Date | null;
	family_id: string;
	revoked_at: Date | null;
}

export async function createChallenge(
	db: Kysely<Database>,
	input: {
		id: string;
		nonce: string;
		inviteId: string;
		workspaceId: string;
		pubkey: string;
		audience: string;
		expiresAt: Date;
	}
): Promise<void> {
	await db
		.insertInto('challenges')
		.values({
			id: input.id,
			nonce: input.nonce,
			invite_id: input.inviteId,
			workspace_id: input.workspaceId,
			pubkey: input.pubkey,
			audience: input.audience,
			expires_at: input.expiresAt
		})
		.execute();
}

export async function findChallengeById(
	db: Kysely<Database>,
	id: string
): Promise<ChallengeRow | undefined> {
	return db
		.selectFrom('challenges')
		.select([
			'id',
			'nonce',
			'invite_id',
			'workspace_id',
			'pubkey',
			'audience',
			'expires_at',
			'used_at'
		])
		.where('id', '=', id)
		.executeTakeFirst();
}

/** Atomically mark a challenge used. Returns false when already consumed. */
export async function consumeChallenge(
	db: Kysely<Database>,
	id: string,
	at: Date
): Promise<boolean> {
	const result = await db
		.updateTable('challenges')
		.set({ used_at: at })
		.where('id', '=', id)
		.where('used_at', 'is', null)
		.returning('id')
		.executeTakeFirst();
	return Boolean(result);
}

export async function insertSession(
	db: Kysely<Database>,
	input: {
		tokenHash: Buffer;
		pubkey: string;
		workspaceId: string;
		permissions: string[];
		expiresAt: Date;
		refreshTokenHash: Buffer;
		refreshExpiresAt: Date;
		familyId: string;
	}
): Promise<void> {
	await db
		.insertInto('sessions')
		.values({
			token_hash: input.tokenHash,
			pubkey: input.pubkey,
			workspace_id: input.workspaceId,
			permissions: input.permissions,
			expires_at: input.expiresAt,
			refresh_token_hash: input.refreshTokenHash,
			refresh_expires_at: input.refreshExpiresAt,
			family_id: input.familyId,
			revoked_at: null
		})
		.execute();
}

export async function findSessionByTokenHash(
	db: Kysely<Database>,
	tokenHash: Buffer
): Promise<SessionRow | undefined> {
	return db
		.selectFrom('sessions')
		.select([
			'token_hash',
			'pubkey',
			'workspace_id',
			'permissions',
			'expires_at',
			'refresh_token_hash',
			'refresh_expires_at',
			'family_id',
			'revoked_at'
		])
		.where('token_hash', '=', tokenHash)
		.where('revoked_at', 'is', null)
		.executeTakeFirst();
}

/** Includes revoked rows so refresh-token reuse can revoke the family. */
export async function findSessionByRefreshHash(
	db: Kysely<Database>,
	refreshTokenHash: Buffer
): Promise<SessionRow | undefined> {
	return db
		.selectFrom('sessions')
		.select([
			'token_hash',
			'pubkey',
			'workspace_id',
			'permissions',
			'expires_at',
			'refresh_token_hash',
			'refresh_expires_at',
			'family_id',
			'revoked_at'
		])
		.where('refresh_token_hash', '=', refreshTokenHash)
		.executeTakeFirst();
}

export async function revokeByTokenHash(
	db: Kysely<Database>,
	tokenHash: Buffer,
	at: Date
): Promise<void> {
	await db
		.updateTable('sessions')
		.set({ revoked_at: at })
		.where('token_hash', '=', tokenHash)
		.where('revoked_at', 'is', null)
		.execute();
}

/** Atomically revoke an active session. Returns false if it was already revoked. */
export async function revokeSessionIfActive(
	db: Kysely<Database>,
	tokenHash: Buffer,
	at: Date
): Promise<boolean> {
	const result = await db
		.updateTable('sessions')
		.set({ revoked_at: at })
		.where('token_hash', '=', tokenHash)
		.where('revoked_at', 'is', null)
		.returning('token_hash')
		.executeTakeFirst();
	return Boolean(result);
}

export async function revokeByRefreshHash(
	db: Kysely<Database>,
	refreshTokenHash: Buffer,
	at: Date
): Promise<void> {
	await db
		.updateTable('sessions')
		.set({ revoked_at: at })
		.where('refresh_token_hash', '=', refreshTokenHash)
		.where('revoked_at', 'is', null)
		.execute();
}

export async function revokeFamily(
	db: Kysely<Database>,
	familyId: string,
	at: Date
): Promise<void> {
	await db
		.updateTable('sessions')
		.set({ revoked_at: at })
		.where('family_id', '=', familyId)
		.where('revoked_at', 'is', null)
		.execute();
}

export async function revokeAllExpired(db: Kysely<Database>, at: Date): Promise<void> {
	await db.deleteFrom('sessions').where('refresh_expires_at', '<', at).execute();
	await db.deleteFrom('challenges').where('expires_at', '<', at).execute();
}
