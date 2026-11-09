/**
 * Pure rollup aggregation.
 *
 * Day snapshots are merged by logical bucket (workspace/location/currency/
 * period). Only aggregates are combined; no customer data exists here.
 */
export interface RollupPayload {
	derived: true;
	sourceGranularity: 'day';
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
	topProducts: { productId: string; qty: number; revenueMinor: number }[];
	generatedAt: string;
}

export interface DaySnapshotInput {
	locationId: string | null;
	currency: string;
	bucketStart: Date;
	bucketEnd: Date;
	grossMinor: number | null;
	ordersCount: number | null;
	payload: unknown;
}

export interface RollupGroup {
	locationId: string | null;
	currency: string;
	bucketStart: Date;
	bucketEnd: Date;
	payload: RollupPayload;
}

const MAX_TOP_PRODUCTS = 50;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SAFE_KEY = /^[A-Za-z0-9._~-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function addCounters(target: Record<string, number>, value: unknown): void {
	if (!isRecord(value)) return;
	for (const [key, raw] of Object.entries(value)) {
		if (!SAFE_KEY.test(key) || key.length > 40) continue;
		target[key] = (target[key] ?? 0) + safeNumber(raw);
	}
}

function addProducts(
	target: Map<string, { qty: number; revenueMinor: number }>,
	value: unknown
): void {
	if (!Array.isArray(value)) return;
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const productId = entry.productId;
		if (typeof productId !== 'string' || !productId || productId.length > 128) continue;
		if (CONTROL_CHARS.test(productId)) continue;
		const current = target.get(productId) ?? { qty: 0, revenueMinor: 0 };
		current.qty += safeNumber(entry.qty);
		current.revenueMinor += safeNumber(entry.revenueMinor);
		target.set(productId, current);
	}
}

/** Merge one or more day payloads into a single rollup payload. */
export function mergeRollupPayload(payloads: readonly unknown[], generatedAt: Date): RollupPayload {
	let grossMinor = 0;
	let netMinor = 0;
	let taxMinor = 0;
	let discountMinor = 0;
	let refundMinor = 0;
	let ordersCount = 0;
	let itemsCount = 0;
	const payments: Record<string, number> = {};
	const orderStatus: Record<string, number> = {};
	const products = new Map<string, { qty: number; revenueMinor: number }>();

	for (const payload of payloads) {
		if (!isRecord(payload) || payload.derived === true) continue;
		grossMinor += safeNumber(payload.grossMinor);
		netMinor += safeNumber(payload.netMinor);
		taxMinor += safeNumber(payload.taxMinor);
		discountMinor += safeNumber(payload.discountMinor);
		refundMinor += safeNumber(payload.refundMinor);
		ordersCount += safeNumber(payload.ordersCount);
		itemsCount += safeNumber(payload.itemsCount);
		addCounters(payments, payload.payments);
		addCounters(orderStatus, payload.orderStatus);
		addProducts(products, payload.topProducts);
	}

	const topProducts = [...products.entries()]
		.map(([productId, totals]) => ({ productId, ...totals }))
		.sort((a, b) => b.revenueMinor - a.revenueMinor || b.qty - a.qty)
		.slice(0, MAX_TOP_PRODUCTS);

	return {
		derived: true,
		sourceGranularity: 'day',
		grossMinor,
		netMinor,
		taxMinor,
		discountMinor,
		refundMinor,
		ordersCount,
		itemsCount,
		avgTicketMinor: ordersCount > 0 ? Math.round(grossMinor / ordersCount) : 0,
		payments,
		orderStatus,
		topProducts,
		generatedAt: generatedAt.toISOString()
	};
}

/** Group day snapshots by location, currency, and bucket start. */
export function groupDaySnapshots(
	rows: readonly DaySnapshotInput[],
	generatedAt: Date
): RollupGroup[] {
	const groups = new Map<
		string,
		{ locationId: string | null; currency: string; bucketStart: Date; bucketEnd: Date; payloads: unknown[] }
	>();

	for (const row of rows) {
		const key = `${row.locationId ?? ''}|${row.currency}|${row.bucketStart.toISOString()}`;
		const existing = groups.get(key);
		if (existing) {
			existing.payloads.push(row.payload);
			if (row.bucketEnd > existing.bucketEnd) existing.bucketEnd = row.bucketEnd;
		} else {
			groups.set(key, {
				locationId: row.locationId,
				currency: row.currency,
				bucketStart: row.bucketStart,
				bucketEnd: row.bucketEnd,
				payloads: [row.payload]
			});
		}
	}

	return [...groups.values()]
		.map((group) => ({
			locationId: group.locationId,
			currency: group.currency,
			bucketStart: group.bucketStart,
			bucketEnd: group.bucketEnd,
			payload: mergeRollupPayload(group.payloads, generatedAt)
		}))
		.sort(
			(a, b) =>
				a.bucketStart.getTime() - b.bucketStart.getTime() ||
				a.currency.localeCompare(b.currency) ||
				(a.locationId ?? '').localeCompare(b.locationId ?? '')
		);
}
