/** Bounded report query parsing. */
import { invalidRequest } from './errors.js';
import { isReportGranularity, type ReportGranularity } from './report-snapshot.js';

export interface ReportRange {
	from: number;
	to: number;
	granularity: ReportGranularity;
	locationId?: string;
	currency?: string;
}

export interface ReportLimits {
	maxRangeDays: number;
	maxBuckets: number;
}

const SECONDS_PER_BUCKET: Record<ReportGranularity, number> = {
	hour: 3_600,
	day: 86_400,
	week: 604_800,
	// Conservative: a month never contributes more than 31 daily buckets.
	month: 86_400 * 31
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CURRENCY = /^[A-Z]{3}$/;

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
		throw invalidRequest(`${label} must be a Unix timestamp in seconds`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw invalidRequest(`${label} must be a Unix timestamp in seconds`);
	}
	return parsed;
}

/** Validate query parameters before they reach SQL. */
export function parseReportRange(
	query: Record<string, unknown>,
	limits: ReportLimits
): ReportRange {
	const from = positiveInteger(query.from, 'from');
	const to = positiveInteger(query.to, 'to');
	if (from >= to) throw invalidRequest('from must be before to');

	const span = to - from;
	if (span > limits.maxRangeDays * 86_400) {
		throw invalidRequest(`range exceeds ${limits.maxRangeDays} days`);
	}

	if (!isReportGranularity(query.granularity)) {
		throw invalidRequest('granularity must be hour, day, week, or month');
	}
	const granularity = query.granularity;

	const buckets = Math.ceil(span / SECONDS_PER_BUCKET[granularity]);
	if (buckets > limits.maxBuckets) {
		throw invalidRequest(`requested range exceeds ${limits.maxBuckets} buckets`);
	}

	let locationId: string | undefined;
	if (query.location !== undefined) {
		if (
			typeof query.location !== 'string' ||
			!query.location ||
			query.location.length > 128 ||
			CONTROL_CHARS.test(query.location)
		) {
			throw invalidRequest('location must be a bounded string');
		}
		locationId = query.location;
	}

	let currency: string | undefined;
	if (query.currency !== undefined) {
		if (typeof query.currency !== 'string' || !CURRENCY.test(query.currency)) {
			throw invalidRequest('currency must be a three-letter uppercase code');
		}
		currency = query.currency;
	}

	return {
		from,
		to,
		granularity,
		...(locationId ? { locationId } : {}),
		...(currency ? { currency } : {})
	};
}
