/**
 * Report snapshot ingestion and summary queries.
 *
 * Snapshots are plaintext aggregates sent only over authenticated HTTPS. They
 * are the single exception to the encrypted-backup rule, so validation is
 * strict and the source event is retained for audit.
 */
import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { queryReportBuckets, reportWatermark, storeReportSnapshot } from '../db/reports.js';
import { findActiveMember } from '../db/workspaces.js';
import { ServiceError, forbidden } from '../domain/errors.js';
import { sha256Hex } from '../domain/hash.js';
import { eventIdOf, getTagValue, verifySignedEvent } from '../domain/nostr.js';
import { parseReportRange, type ReportRange } from '../domain/report-query.js';
import {
	REPORT_SNAPSHOT_KIND,
	parseReportSnapshotPayload,
	type ReportGranularity,
	type ReportSnapshot
} from '../domain/report-snapshot.js';
import type { SessionContext } from './auth.js';

export interface SnapshotIngestResult {
	accepted: string[];
	duplicates: string[];
	rejected: { id: string; reason: string }[];
}

function unix(date: string): number {
	return Math.floor(new Date(date).getTime() / 1000);
}

function tagMatches(
	event: { tags: readonly string[][] },
	name: string,
	expected: string
): boolean {
	const value = getTagValue(event.tags, name);
	return value === undefined || value === expected;
}

function periodTagMatches(
	event: { tags: readonly string[][] },
	name: string,
	expectedUnix: number
): boolean {
	const value = getTagValue(event.tags, name);
	if (value === undefined) return true;
	const parsed = Number(value);
	return Number.isFinite(parsed) && Math.floor(parsed) === expectedUnix;
}

function tagsMatchSnapshot(
	event: { tags: readonly string[][] },
	workspaceId: string,
	snapshot: ReportSnapshot
): boolean {
	if (getTagValue(event.tags, 'organization') !== workspaceId) return false;
	if (!tagMatches(event, 'granularity', snapshot.granularity)) return false;
	if (!tagMatches(event, 'currency', snapshot.currency)) return false;
	if (snapshot.locationId && !tagMatches(event, 'location', snapshot.locationId)) return false;
	if (!periodTagMatches(event, 'period-start', unix(snapshot.periodStart))) return false;
	if (!periodTagMatches(event, 'period-end', unix(snapshot.periodEnd))) return false;
	return true;
}

export async function ingestReportSnapshot(
	{ db, config }: { db: Kysely<Database>; config: Config },
	session: SessionContext,
	rawEvent: unknown,
	now: Date
): Promise<SnapshotIngestResult> {
	const id = eventIdOf(rawEvent) ?? 'unknown';
	const rejected = (reason: string): SnapshotIngestResult => ({
		accepted: [],
		duplicates: [],
		rejected: [{ id, reason }]
	});

	const verification = verifySignedEvent(rawEvent, {
		now: Math.floor(now.getTime() / 1000),
		maxClockSkewSeconds: config.maxClockSkewSeconds
	});
	if (!verification.ok) return rejected(verification.reason);

	const event = verification.event;
	if (event.kind !== REPORT_SNAPSHOT_KIND) return rejected('kind-not-allowed');
	if (Buffer.byteLength(event.content, 'utf8') > config.maxEventBytes) {
		return rejected('event-too-large');
	}

	const member = await findActiveMember(db, session.workspaceId, event.pubkey);
	if (!member) throw forbidden('Snapshot author is not a workspace member');

	let snapshot: ReportSnapshot;
	try {
		snapshot = parseReportSnapshotPayload(event.content);
	} catch (error) {
		const message = error instanceof ServiceError ? error.message : 'invalid-snapshot';
		return rejected(message.slice(0, 200));
	}

	if (!tagsMatchSnapshot(event, session.workspaceId, snapshot)) {
		return rejected('snapshot-tag-mismatch');
	}

	const result = await storeReportSnapshot(db, {
		workspaceId: session.workspaceId,
		snapshot,
		event
	});

	return result === 'duplicate'
		? { accepted: [], duplicates: [event.id], rejected: [] }
		: { accepted: [event.id], duplicates: [], rejected: [] };
}

export interface ReportSummaryBucket {
	start: number;
	end: number;
	locationId: string | null;
	currency: string;
	grossMinor: number | null;
	ordersCount: number | null;
	completeness: 'snapshot';
	derived: boolean;
	payload: unknown;
}

export interface ReportSummaryResponse {
	snapshot: true;
	generatedAt: number;
	range: {
		from: number;
		to: number;
		granularity: ReportGranularity;
		locationId: string | null;
	};
	currency: string | null;
	buckets: ReportSummaryBucket[];
	watermark: number | null;
}

export async function getReportSummary(
	{ db, config }: { db: Kysely<Database>; config: Config },
	session: SessionContext,
	query: Record<string, unknown>,
	now: Date
): Promise<ReportSummaryResponse> {
	const range: ReportRange = parseReportRange(query, {
		maxRangeDays: config.reportMaxRangeDays,
		maxBuckets: config.reportMaxBuckets
	});

	const rows = await queryReportBuckets(db, {
		workspaceId: session.workspaceId,
		from: range.from,
		to: range.to,
		granularity: range.granularity,
		locationId: range.locationId,
		currency: range.currency,
		limit: config.reportMaxBuckets
	});

	const watermark = await reportWatermark(db, {
		workspaceId: session.workspaceId,
		from: range.from,
		to: range.to,
		granularity: range.granularity,
		locationId: range.locationId,
		currency: range.currency
	});

	return {
		snapshot: true,
		generatedAt: Math.floor(now.getTime() / 1000),
		range: {
			from: range.from,
			to: range.to,
			granularity: range.granularity,
			locationId: range.locationId ?? null
		},
		currency: range.currency ?? null,
		buckets: rows.map((row) => ({
			start: Math.floor(row.period_start.getTime() / 1000),
			end: Math.floor(row.period_end.getTime() / 1000),
			locationId: row.location_id,
			currency: row.currency,
			grossMinor: row.gross_minor,
			ordersCount: row.orders_count,
			completeness: 'snapshot',
			derived: row.derived,
			payload: row.payload
		})),
		watermark: watermark ? Math.floor(watermark.getTime() / 1000) : null
	};
}


/** Stable validator for a summary response; excludes the per-request clock. */
export function reportEtag(response: ReportSummaryResponse): string {
	const basis = {
		range: response.range,
		currency: response.currency,
		buckets: response.buckets,
		watermark: response.watermark
	};
	return `W/"${sha256Hex(JSON.stringify(basis))}"`;
}
