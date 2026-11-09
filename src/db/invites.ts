import type { Kysely } from 'kysely';
import type { Database } from './types.js';

export interface InviteRow {
	id: string;
	workspace_id: string;
	code_hash: Buffer;
	pubkey: string | null;
	permissions: string[];
	created_by: string | null;
	expires_at: Date;
	used_at: Date | null;
	used_by: string | null;
}

export async function createInvite(
	db: Kysely<Database>,
	input: {
		workspaceId: string;
		codeHash: Buffer;
		pubkey?: string | null;
		permissions: string[];
		createdBy?: string | null;
		expiresAt: Date;
	}
): Promise<{ id: string }> {
	const row = await db
		.insertInto('invites')
		.values({
			workspace_id: input.workspaceId,
			code_hash: input.codeHash,
			pubkey: input.pubkey ?? null,
			permissions: input.permissions,
			created_by: input.createdBy ?? null,
			expires_at: input.expiresAt
		})
		.returning('id')
		.executeTakeFirstOrThrow();
	return { id: row.id };
}

export async function findInviteByCodeHash(
	db: Kysely<Database>,
	codeHash: Buffer
): Promise<InviteRow | undefined> {
	return db.selectFrom('invites').selectAll().where('code_hash', '=', codeHash).executeTakeFirst();
}

export async function findInviteById(
	db: Kysely<Database>,
	inviteId: string
): Promise<InviteRow | undefined> {
	return db.selectFrom('invites').selectAll().where('id', '=', inviteId).executeTakeFirst();
}

/** Atomically consume an unused invite. Returns false if already used. */
export async function consumeInvite(
	db: Kysely<Database>,
	inviteId: string,
	pubkey: string,
	at: Date
): Promise<boolean> {
	const result = await db
		.updateTable('invites')
		.set({ used_at: at, used_by: pubkey })
		.where('id', '=', inviteId)
		.where('used_at', 'is', null)
		.returning('id')
		.executeTakeFirst();
	return Boolean(result);
}
