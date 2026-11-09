import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/**
 * Initial schema: tenancy, auth, encrypted event archive, backup state, and
 * the report snapshot tables used by the reporting extension.
 *
 * Events are a normal table in v1. Range partitioning by created_at can be
 * added later without changing the application queries.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.createTable('workspaces')
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('plan', 'text', (col) => col.notNull().defaultTo('self-hosted'))
		.addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable('workspace_members')
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('pubkey', sql`char(64)`, (col) => col.notNull())
		.addColumn('role', 'text', (col) => col.notNull().defaultTo('staff'))
		.addColumn('permissions', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('revoked_at', 'timestamptz')
		.addPrimaryKeyConstraint('workspace_members_pk', ['workspace_id', 'pubkey'])
		.execute();

	await db.schema
		.createTable('invites')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('code_hash', sql`bytea`, (col) => col.notNull())
		.addColumn('pubkey', sql`char(64)`)
		.addColumn('permissions', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
		.addColumn('created_by', sql`char(64)`)
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('expires_at', 'timestamptz', (col) => col.notNull())
		.addColumn('used_at', 'timestamptz')
		.addColumn('used_by', sql`char(64)`)
		.execute();
	await sql`create unique index invites_code_hash_idx on invites (code_hash)`.execute(db);
	await sql`create index invites_workspace_expiry_idx on invites (workspace_id, expires_at)`.execute(
		db
	);

	await db.schema
		.createTable('challenges')
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('nonce', 'text', (col) => col.notNull())
		.addColumn('invite_id', 'uuid', (col) =>
			col.notNull().references('invites.id').onDelete('cascade')
		)
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('pubkey', sql`char(64)`, (col) => col.notNull())
		.addColumn('audience', 'text', (col) => col.notNull())
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('expires_at', 'timestamptz', (col) => col.notNull())
		.addColumn('used_at', 'timestamptz')
		.execute();
	await sql`create unique index challenges_nonce_idx on challenges (nonce)`.execute(db);
	await sql`create index challenges_expiry_idx on challenges (expires_at)`.execute(db);

	await db.schema
		.createTable('sessions')
		.addColumn('token_hash', sql`bytea`, (col) => col.primaryKey())
		.addColumn('pubkey', sql`char(64)`, (col) => col.notNull())
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('permissions', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('expires_at', 'timestamptz', (col) => col.notNull())
		.addColumn('refresh_token_hash', sql`bytea`)
		.addColumn('refresh_expires_at', 'timestamptz')
		.addColumn('family_id', 'uuid', (col) => col.notNull().defaultTo(sql`gen_random_uuid()`))
		.addColumn('revoked_at', 'timestamptz')
		.execute();
	await sql`create unique index sessions_refresh_hash_idx on sessions (refresh_token_hash)`.execute(
		db
	);
	await sql`create index sessions_member_idx on sessions (workspace_id, pubkey)`.execute(db);
	await sql`create index sessions_refresh_expiry_idx on sessions (refresh_expires_at)`.execute(db);

	await db.schema
		.createTable('events')
		.addColumn('id', sql`char(64)`, (col) => col.primaryKey())
		.addColumn('pubkey', sql`char(64)`, (col) => col.notNull())
		.addColumn('kind', 'integer', (col) => col.notNull())
		.addColumn('created_at', 'bigint', (col) => col.notNull())
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('location_id', 'text')
		.addColumn('d_tag', 'text')
		.addColumn('address', 'text')
		.addColumn('visibility', 'text')
		.addColumn('encrypted', 'boolean', (col) => col.notNull().defaultTo(true))
		.addColumn('envelope_scheme', 'text')
		.addColumn('envelope_kid', 'text')
		.addColumn('content_bytes', 'integer', (col) => col.notNull())
		.addColumn('raw_event', 'jsonb', (col) => col.notNull())
		.addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
	await sql`create index events_ws_kind_time_idx on events (workspace_id, kind, created_at desc)`.execute(
		db
	);
	await sql`create index events_ws_loc_kind_time_idx on events (workspace_id, location_id, kind, created_at desc)`.execute(
		db
	);
	await sql`create index events_ws_pubkey_kind_time_idx on events (workspace_id, pubkey, kind, created_at desc)`.execute(
		db
	);
	await sql`create index events_address_idx on events (workspace_id, address, created_at desc) where address is not null`.execute(
		db
	);

	await db.schema
		.createTable('workspace_backup_state')
		.addColumn('workspace_id', 'text', (col) =>
			col.primaryKey().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('last_event_received_at', 'timestamptz')
		.addColumn('last_backup_at', 'timestamptz')
		.addColumn('last_verified_restore_at', 'timestamptz')
		.addColumn('state', 'text', (col) => col.notNull().defaultTo('unknown'))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable('report_snapshots')
		.addColumn('id', 'bigserial', (col) => col.primaryKey())
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('location_id', 'text')
		.addColumn('source_event_id', sql`char(64)`, (col) => col.notNull())
		.addColumn('type', 'text', (col) => col.notNull().defaultTo('report.snapshot'))
		.addColumn('granularity', 'text', (col) => col.notNull())
		.addColumn('period_start', 'timestamptz', (col) => col.notNull())
		.addColumn('period_end', 'timestamptz', (col) => col.notNull())
		.addColumn('currency', sql`char(3)`, (col) => col.notNull())
		.addColumn('gross_minor', 'bigint')
		.addColumn('orders_count', 'integer')
		.addColumn('payload', 'jsonb', (col) => col.notNull())
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
	await sql`create unique index report_snapshots_source_idx on report_snapshots (source_event_id)`.execute(
		db
	);
	await sql`create index report_snapshots_lookup_idx on report_snapshots (workspace_id, granularity, period_start desc)`.execute(
		db
	);

	await db.schema
		.createTable('audit_log')
		.addColumn('id', 'bigserial', (col) => col.primaryKey())
		.addColumn('workspace_id', 'text')
		.addColumn('actor_pubkey', sql`char(64)`)
		.addColumn('action', 'text', (col) => col.notNull())
		.addColumn('detail', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
	await sql`create index audit_log_workspace_idx on audit_log (workspace_id, created_at desc)`.execute(
		db
	);
}
