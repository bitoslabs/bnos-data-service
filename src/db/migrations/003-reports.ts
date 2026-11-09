import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/**
 * Report snapshots: keep the signed source event for audit, enforce one row per
 * logical period (so multiple devices converge instead of double counting), and
 * add the location lookup index.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema.alterTable('report_snapshots').addColumn('raw_event', 'jsonb').execute();

	await sql`
		create unique index report_snapshots_logical_idx
		on report_snapshots (workspace_id, (coalesce(location_id, '')), granularity, period_start, currency)
	`.execute(db);

	await sql`
		create index report_snapshots_location_idx
		on report_snapshots (workspace_id, location_id, granularity, period_start desc)
		where location_id is not null
	`.execute(db);
}
