import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

export interface WorkspaceRow {
	id: string;
	name: string;
	plan: string;
	status: string;
}

export interface MemberRow {
	workspace_id: string;
	pubkey: string;
	role: string;
	permissions: string[];
	revoked_at: Date | null;
}

export async function findWorkspace(
	db: Kysely<Database>,
	workspaceId: string
): Promise<WorkspaceRow | undefined> {
	return db
		.selectFrom('workspaces')
		.select(['id', 'name', 'plan', 'status'])
		.where('id', '=', workspaceId)
		.executeTakeFirst();
}

export async function findActiveMember(
	db: Kysely<Database>,
	workspaceId: string,
	pubkey: string
): Promise<MemberRow | undefined> {
	return db
		.selectFrom('workspace_members')
		.selectAll()
		.where('workspace_id', '=', workspaceId)
		.where('pubkey', '=', pubkey)
		.where('revoked_at', 'is', null)
		.executeTakeFirst();
}

/** Pubkeys of current members, used to authorize relayed events. */
export async function listActiveMemberPubkeys(
	db: Kysely<Database>,
	workspaceId: string
): Promise<string[]> {
	const rows = await db
		.selectFrom('workspace_members')
		.select('pubkey')
		.where('workspace_id', '=', workspaceId)
		.where('revoked_at', 'is', null)
		.execute();
	return rows.map((row) => row.pubkey);
}

export async function upsertMember(
	db: Kysely<Database>,
	input: {
		workspaceId: string;
		pubkey: string;
		role: string;
		permissions: string[];
	}
): Promise<void> {
	await db
		.insertInto('workspace_members')
		.values({
			workspace_id: input.workspaceId,
			pubkey: input.pubkey,
			role: input.role,
			permissions: input.permissions,
			revoked_at: null
		})
		.onConflict((oc) =>
			oc.columns(['workspace_id', 'pubkey']).doUpdateSet({
				role: input.role,
				permissions: input.permissions,
				revoked_at: null
			})
		)
		.execute();
}

export async function createWorkspace(
	db: Kysely<Database>,
	input: { id: string; name: string; plan?: string }
): Promise<void> {
	await db
		.insertInto('workspaces')
		.values({ id: input.id, name: input.name, plan: input.plan ?? 'self-hosted' })
		.execute();
}

export async function listWorkspaces(db: Kysely<Database>): Promise<WorkspaceRow[]> {
	return db
		.selectFrom('workspaces')
		.select(['id', 'name', 'plan', 'status'])
		.orderBy('created_at', 'asc')
		.execute();
}

export async function revokeMember(
	db: Kysely<Database>,
	workspaceId: string,
	pubkey: string,
	at: Date
): Promise<void> {
	await db
		.updateTable('workspace_members')
		.set({ revoked_at: at })
		.where('workspace_id', '=', workspaceId)
		.where('pubkey', '=', pubkey)
		.execute();
}

export interface BackupStateRow {
	workspace_id: string;
	last_event_received_at: Date | null;
	last_backup_at: Date | null;
	last_verified_restore_at: Date | null;
	state: string;
}

export async function getBackupState(
	db: Kysely<Database>,
	workspaceId: string
): Promise<BackupStateRow | undefined> {
	return db
		.selectFrom('workspace_backup_state')
		.select([
			'workspace_id',
			'last_event_received_at',
			'last_backup_at',
			'last_verified_restore_at',
			'state'
		])
		.where('workspace_id', '=', workspaceId)
		.executeTakeFirst();
}

export async function touchBackupState(
	db: Kysely<Database>,
	workspaceId: string,
	at: Date
): Promise<void> {
	await sql`
		insert into workspace_backup_state
			(workspace_id, last_event_received_at, last_backup_at, state, updated_at)
		values
			(${workspaceId}, ${at}, ${at}, 'current', ${at})
		on conflict (workspace_id) do update set
			last_event_received_at = excluded.last_event_received_at,
			last_backup_at = excluded.last_backup_at,
			state = 'current',
			updated_at = excluded.updated_at
	`.execute(db);
}

export async function markRestoreVerified(
	db: Kysely<Database>,
	workspaceId: string,
	at: Date
): Promise<void> {
	await sql`
		insert into workspace_backup_state
			(workspace_id, last_verified_restore_at, state, updated_at)
		values
			(${workspaceId}, ${at}, 'current', ${at})
		on conflict (workspace_id) do update set
			last_verified_restore_at = excluded.last_verified_restore_at,
			updated_at = excluded.updated_at
	`.execute(db);
}
