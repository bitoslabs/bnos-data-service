import { sql, type Kysely } from 'kysely';
import type { SignedEvent } from '../domain/nostr.js';
import type { ReportSnapshot } from '../domain/report-snapshot.js';
import type { Database } from './types.js';

export type StoreSnapshotResult = 'accepted' | 'duplicate';

/**
 * Store one logical period. The unique logical index means a correction from
 * any device replaces the prior aggregate instead of adding a second total.
 */
export async function storeReportSnapshot(
	db: Kysely<Database>,
	input: { workspaceId: string; snapshot: ReportSnapshot; event: SignedEvent }
): Promise<StoreSnapshotResult> {
	return db.transaction().execute(async (trx) => {
		const existing = await trx
			.selectFrom('report_snapshots')
			.select('source_event_id')
			.where('source_event_id', '=', input.event.id)
			.executeTakeFirst();
		if (existing) return 'duplicate';

		await sql`
			insert into report_snapshots (
				workspace_id, location_id, source_event_id, type, granularity,
				period_start, period_end, currency, gross_minor, orders_count,
				payload, raw_event, derived
			) values (
				${input.workspaceId},
				${input.snapshot.locationId ?? null},
				${input.event.id},
				${input.snapshot.type},
				${input.snapshot.granularity},
				${new Date(input.snapshot.periodStart)},
				${new Date(input.snapshot.periodEnd)},
				${input.snapshot.currency},
				${input.snapshot.grossMinor},
				${input.snapshot.ordersCount},
				${JSON.stringify(input.snapshot)}::jsonb,
				${JSON.stringify(input.event)}::jsonb,
				false
			)
			on conflict (workspace_id, (coalesce(location_id, '')), granularity, period_start, currency)
			do update set
				source_event_id = excluded.source_event_id,
				period_end = excluded.period_end,
				gross_minor = excluded.gross_minor,
				orders_count = excluded.orders_count,
				payload = excluded.payload,
				raw_event = excluded.raw_event,
				derived = false,
				created_at = now()
		`.execute(trx);

		return 'accepted';
	});
}

export interface ReportBucketRow {
	period_start: Date;
	period_end: Date;
	location_id: string | null;
	currency: string;
	source_event_id: string;
	gross_minor: number | null;
	orders_count: number | null;
	payload: unknown;
	derived: boolean;
	created_at: Date;
}

export async function queryReportBuckets(
	db: Kysely<Database>,
	params: {
		workspaceId: string;
		from: number;
		to: number;
		granularity: string;
		locationId?: string;
		currency?: string;
		limit: number;
	}
): Promise<ReportBucketRow[]> {
	let query = db
		.selectFrom('report_snapshots')
		.select([
			'period_start',
			'period_end',
			'location_id',
			'currency',
			'source_event_id',
			'gross_minor',
			'orders_count',
			'payload',
			'derived',
			'created_at'
		])
		.where('workspace_id', '=', params.workspaceId)
		.where('granularity', '=', params.granularity)
		.where('period_start', '>=', new Date(params.from * 1000))
		.where('period_start', '<', new Date(params.to * 1000));

	if (params.locationId) query = query.where('location_id', '=', params.locationId);
	if (params.currency) query = query.where('currency', '=', params.currency);

	return query.orderBy('period_start', 'asc').limit(params.limit).execute();
}

export async function reportWatermark(
	db: Kysely<Database>,
	params: {
		workspaceId: string;
		from: number;
		to: number;
		granularity: string;
		locationId?: string;
		currency?: string;
	}
): Promise<Date | null> {
	const location = params.locationId ?? null;
	const currency = params.currency ?? null;
	const result = await sql<{ watermark: Date | null }>`
		select max(created_at) as watermark
		from report_snapshots
		where workspace_id = ${params.workspaceId}
			and granularity = ${params.granularity}
			and period_start >= ${new Date(params.from * 1000)}
			and period_start < ${new Date(params.to * 1000)}
			and (${location}::text is null or location_id = ${location})
			and (${currency}::text is null or currency = ${currency})
	`.execute(db);
	return result.rows[0]?.watermark ?? null;
}

export interface DaySnapshotRow {
	workspace_id: string;
	location_id: string | null;
	currency: string;
	bucket_start: Date;
	bucket_end: Date;
	gross_minor: number | null;
	orders_count: number | null;
	payload: unknown;
}

/** Day-level aggregate inputs for a week/month rollup. */
export async function listDaySnapshotsForRollup(
	db: Kysely<Database>,
	params: {
		workspaceId: string;
		granularity: 'week' | 'month';
		from?: number;
		to?: number;
	}
): Promise<DaySnapshotRow[]> {
	const fromDate = params.from ? new Date(params.from * 1000) : null;
	const toDate = params.to ? new Date(params.to * 1000) : null;

	const result = await sql<DaySnapshotRow>`
		select
			workspace_id,
			location_id,
			currency,
			(date_trunc(${params.granularity}, period_start at time zone 'UTC')
				at time zone 'UTC') as bucket_start,
			((date_trunc(${params.granularity}, period_start at time zone 'UTC')
				+ case when ${params.granularity} = 'week'
					then interval '1 week' else interval '1 month' end)
				at time zone 'UTC') as bucket_end,
			gross_minor,
			orders_count,
			payload
		from report_snapshots
		where workspace_id = ${params.workspaceId}
			and granularity = 'day'
			and derived = false
			and (${fromDate}::timestamptz is null or period_start >= ${fromDate})
			and (${toDate}::timestamptz is null or period_start < ${toDate})
		order by period_start asc
	`.execute(db);

	return result.rows;
}

/**
 * Insert or replace a derived rollup. The `where derived` guard means a
 * client-signed snapshot for the same logical period is never overwritten.
 */
export async function upsertDerivedSnapshot(
	db: Kysely<Database>,
	input: {
		workspaceId: string;
		locationId: string | null;
		granularity: 'week' | 'month';
		periodStart: Date;
		periodEnd: Date;
		currency: string;
		grossMinor: number;
		ordersCount: number;
		payload: unknown;
		sourceEventId: string;
	}
): Promise<void> {
	await sql`
		insert into report_snapshots (
			workspace_id, location_id, source_event_id, type, granularity,
			period_start, period_end, currency, gross_minor, orders_count,
			payload, raw_event, derived
		) values (
			${input.workspaceId},
			${input.locationId},
			${input.sourceEventId},
			'report.rollup',
			${input.granularity},
			${input.periodStart},
			${input.periodEnd},
			${input.currency},
			${input.grossMinor},
			${input.ordersCount},
			${JSON.stringify(input.payload)}::jsonb,
			null,
			true
		)
		on conflict (workspace_id, (coalesce(location_id, '')), granularity, period_start, currency)
		do update set
			source_event_id = excluded.source_event_id,
			period_end = excluded.period_end,
			gross_minor = excluded.gross_minor,
			orders_count = excluded.orders_count,
			payload = excluded.payload,
			raw_event = null,
			derived = true,
			created_at = now()
		where report_snapshots.derived = true
	`.execute(db);
}
