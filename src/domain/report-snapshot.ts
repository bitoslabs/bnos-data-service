/**
 * Report snapshot payload validation.
 *
 * Snapshots are the only plaintext business data this service accepts. They are
 * aggregate-only by contract, so unknown keys are rejected: that is what stops
 * a client bug (or a malicious caller) from smuggling customer fields in.
 */
import { invalidRequest } from './errors.js';

export const REPORT_SNAPSHOT_KIND = 30_970;
export const REPORT_SNAPSHOT_TYPE = 'report.snapshot';

export type ReportGranularity = 'hour' | 'day' | 'week' | 'month';

export interface ReportProductTotal {
	productId: string;
	qty: number;
	revenueMinor: number;
}

export interface ReportSnapshot {
	type: typeof REPORT_SNAPSHOT_TYPE;
	version: 1;
	granularity: ReportGranularity;
	periodStart: string;
	periodEnd: string;
	locationId?: string;
	currency: string;
	grossMinor: number;
	netMinor: number;
	taxMinor: number;
	discountMinor: number;
	refundMinor: number;
	ordersCount: number;
	itemsCount: number;
	avgTicketMinor: number;
	payments: Record<string, number>;
	orderStatus: Record<string, number>;
	topProducts: ReportProductTotal[];
	generatedAt: string;
}

const GRANULARITIES = new Set<ReportGranularity>(['hour', 'day', 'week', 'month']);

const REQUIRED_KEYS = new Set([
	'type',
	'version',
	'granularity',
	'periodStart',
	'periodEnd',
	'currency',
	'grossMinor',
	'netMinor',
	'taxMinor',
	'discountMinor',
	'refundMinor',
	'ordersCount',
	'itemsCount',
	'avgTicketMinor',
	'payments',
	'orderStatus',
	'topProducts',
	'generatedAt'
]);

const OPTIONAL_KEYS = new Set(['locationId']);
const MAX_TOP_PRODUCTS = 50;
const MAX_COUNTER_KEYS = 20;
const MAX_KEY_LENGTH = 40;
const MAX_LOCATION_LENGTH = 128;
const MAX_PRODUCT_ID_LENGTH = 128;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SAFE_KEY = /^[A-Za-z0-9._~-]+$/;
const CURRENCY = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw invalidRequest(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function boundedString(value: unknown, label: string, max: number): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > max ||
		CONTROL_CHARS.test(value)
	) {
		throw invalidRequest(`${label} must be a bounded string`);
	}
	return value;
}

function isoDate(value: unknown, label: string): string {
	if (typeof value !== 'string') throw invalidRequest(`${label} must be an ISO-8601 string`);
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime())) {
		throw invalidRequest(`${label} must be an ISO-8601 string`);
	}
	return parsed.toISOString();
}

function counterMap(value: unknown, label: string): Record<string, number> {
	if (!isRecord(value)) throw invalidRequest(`${label} must be an object`);
	const entries = Object.entries(value);
	if (entries.length > MAX_COUNTER_KEYS) {
		throw invalidRequest(`${label} has too many keys`);
	}
	const result: Record<string, number> = {};
	for (const [key, raw] of entries) {
		if (!SAFE_KEY.test(key) || key.length > MAX_KEY_LENGTH) {
			throw invalidRequest(`${label} contains an invalid key`);
		}
		result[key] = nonNegativeInteger(raw, `${label}.${key}`);
	}
	return result;
}

function topProducts(value: unknown): ReportProductTotal[] {
	if (!Array.isArray(value) || value.length > MAX_TOP_PRODUCTS) {
		throw invalidRequest('topProducts must be an array with at most 50 entries');
	}
	return value.map((entry, index) => {
		if (!isRecord(entry)) throw invalidRequest(`topProducts[${index}] must be an object`);
		const keys = Object.keys(entry);
		if (keys.some((key) => !['productId', 'qty', 'revenueMinor'].includes(key))) {
			throw invalidRequest(`topProducts[${index}] contains an unknown key`);
		}
		return {
			productId: boundedString(entry.productId, `topProducts[${index}].productId`, MAX_PRODUCT_ID_LENGTH),
			qty: nonNegativeInteger(entry.qty, `topProducts[${index}].qty`),
			revenueMinor: nonNegativeInteger(
				entry.revenueMinor,
				`topProducts[${index}].revenueMinor`
			)
		};
	});
}

export function isReportGranularity(value: unknown): value is ReportGranularity {
	return typeof value === 'string' && GRANULARITIES.has(value as ReportGranularity);
}

/** Parse and validate a plaintext aggregate snapshot payload. */
export function parseReportSnapshotPayload(content: string): ReportSnapshot {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw invalidRequest('snapshot content must be JSON');
	}
	if (!isRecord(value)) throw invalidRequest('snapshot content must be an object');

	for (const key of Object.keys(value)) {
		if (!REQUIRED_KEYS.has(key) && !OPTIONAL_KEYS.has(key)) {
			throw invalidRequest(`snapshot contains an unknown field: ${key}`);
		}
	}

	if (value.type !== REPORT_SNAPSHOT_TYPE) throw invalidRequest('invalid snapshot type');
	if (value.version !== 1) throw invalidRequest('unsupported snapshot version');
	if (!isReportGranularity(value.granularity)) throw invalidRequest('invalid granularity');

	const periodStart = isoDate(value.periodStart, 'periodStart');
	const periodEnd = isoDate(value.periodEnd, 'periodEnd');
	if (new Date(periodStart) >= new Date(periodEnd)) {
		throw invalidRequest('periodStart must be before periodEnd');
	}

	if (typeof value.currency !== 'string' || !CURRENCY.test(value.currency)) {
		throw invalidRequest('currency must be a three-letter uppercase code');
	}

	return {
		type: REPORT_SNAPSHOT_TYPE,
		version: 1,
		granularity: value.granularity,
		periodStart,
		periodEnd,
		...(value.locationId !== undefined
			? { locationId: boundedString(value.locationId, 'locationId', MAX_LOCATION_LENGTH) }
			: {}),
		currency: value.currency,
		grossMinor: nonNegativeInteger(value.grossMinor, 'grossMinor'),
		netMinor: nonNegativeInteger(value.netMinor, 'netMinor'),
		taxMinor: nonNegativeInteger(value.taxMinor, 'taxMinor'),
		discountMinor: nonNegativeInteger(value.discountMinor, 'discountMinor'),
		refundMinor: nonNegativeInteger(value.refundMinor, 'refundMinor'),
		ordersCount: nonNegativeInteger(value.ordersCount, 'ordersCount'),
		itemsCount: nonNegativeInteger(value.itemsCount, 'itemsCount'),
		avgTicketMinor: nonNegativeInteger(value.avgTicketMinor, 'avgTicketMinor'),
		payments: counterMap(value.payments, 'payments'),
		orderStatus: counterMap(value.orderStatus, 'orderStatus'),
		topProducts: topProducts(value.topProducts),
		generatedAt: isoDate(value.generatedAt, 'generatedAt')
	};
}
