import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/** Relay backfill subscriptions and their durable cursors. */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.createTable('relay_subscriptions')
		.addColumn('id', 'bigserial', (col) => col.primaryKey())
		.addColumn('workspace_id', 'text', (col) =>
			col.notNull().references('workspaces.id').onDelete('cascade')
		)
		.addColumn('relay_url', 'text', (col) => col.notNull())
		.addColumn('filter', 'jsonb', (col) => col.notNull())
		.addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
	await sql`create index relay_subscriptions_workspace_idx on relay_subscriptions (workspace_id)`.execute(
		db
	);
	await sql`create index relay_subscriptions_enabled_idx on relay_subscriptions (enabled) where enabled`.execute(
		db
	);

	await db.schema
		.createTable('relay_cursors')
		.addColumn('subscription_id', 'bigint', (col) =>
			col.primaryKey().references('relay_subscriptions.id').onDelete('cascade')
		)
		.addColumn('since', 'bigint', (col) => col.notNull().defaultTo(0))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('last_error', 'text')
		.addColumn('last_error_at', 'timestamptz')
		.execute();
}
