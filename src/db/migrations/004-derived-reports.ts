import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/**
 * Mark server-derived rollups so a client-signed snapshot for the same logical
 * period always wins, while a rollup can still be recomputed.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.alterTable('report_snapshots')
		.addColumn('derived', 'boolean', (col) => col.notNull().defaultTo(false))
		.execute();

	await sql`
		create index report_snapshots_derived_idx
		on report_snapshots (workspace_id, granularity)
		where derived
	`.execute(db);
}
