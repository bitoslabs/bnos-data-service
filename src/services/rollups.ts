/**
 * Week/month rollups from client day snapshots.
 *
 * Safe to re-run: derived rows are replaced, while a client-signed snapshot for
 * the same logical period is left untouched.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import { listDaySnapshotsForRollup, upsertDerivedSnapshot } from '../db/reports.js';
import { listWorkspaces } from '../db/workspaces.js';
import { sha256Hex } from '../domain/hash.js';
import { groupDaySnapshots } from '../domain/report-rollup.js';

export type RollupGranularity = 'week' | 'month';

export interface RollupOptions {
	workspaceId?: string;
	granularity: RollupGranularity;
	from?: number;
	to?: number;
}

export interface RollupSummary {
	workspaces: number;
	rows: number;
}

export async function runRollups(
	{ db, now }: { db: Kysely<Database>; now: Date },
	options: RollupOptions
): Promise<RollupSummary> {
	const workspaceIds = options.workspaceId
		? [options.workspaceId]
		: (await listWorkspaces(db)).map((workspace) => workspace.id);

	let rows = 0;

	for (const workspaceId of workspaceIds) {
		await db.transaction().execute(async (trx) => {
			const dayRows = await listDaySnapshotsForRollup(trx, {
				workspaceId,
				granularity: options.granularity,
				from: options.from,
				to: options.to
			});
			const groups = groupDaySnapshots(
				dayRows.map((row) => ({
					locationId: row.location_id,
					currency: row.currency,
					bucketStart: row.bucket_start,
					bucketEnd: row.bucket_end,
					grossMinor: row.gross_minor,
					ordersCount: row.orders_count,
					payload: row.payload
				})),
				now
			);

			for (const group of groups) {
				const sourceEventId = sha256Hex(
					[
						'report.rollup',
						workspaceId,
						group.locationId ?? '',
						options.granularity,
						group.bucketStart.toISOString(),
						group.currency
					].join('|')
				);
				await upsertDerivedSnapshot(trx, {
					workspaceId,
					locationId: group.locationId,
					granularity: options.granularity,
					periodStart: group.bucketStart,
					periodEnd: group.bucketEnd,
					currency: group.currency,
					grossMinor: group.payload.grossMinor,
					ordersCount: group.payload.ordersCount,
					payload: group.payload,
					sourceEventId
				});
				rows++;
			}
		});
	}

	return { workspaces: workspaceIds.length, rows };
}
