import { describe, expect, it } from 'vitest';
import {
	groupDaySnapshots,
	mergeRollupPayload
} from '../../src/domain/report-rollup.js';

const generatedAt = new Date('2026-11-04T00:00:00.000Z');

function dayPayload(overrides: Record<string, unknown> = {}) {
	return {
		type: 'report.snapshot',
		version: 1,
		granularity: 'day',
		grossMinor: 1000,
		netMinor: 900,
		taxMinor: 100,
		discountMinor: 0,
		refundMinor: 0,
		ordersCount: 2,
		itemsCount: 3,
		avgTicketMinor: 500,
		payments: { cash: 1000 },
		orderStatus: { completed: 2 },
		topProducts: [{ productId: 'p1', qty: 1, revenueMinor: 1000 }],
		...overrides
	};
}

describe('mergeRollupPayload', () => {
	it('sums totals, counters, and products', () => {
		const merged = mergeRollupPayload(
			[
				dayPayload(),
				dayPayload({
					grossMinor: 2000,
					netMinor: 1800,
					taxMinor: 200,
					ordersCount: 3,
					itemsCount: 4,
					payments: { cash: 500, lightning: 1500 },
					orderStatus: { completed: 3 },
					topProducts: [{ productId: 'p2', qty: 2, revenueMinor: 2000 }]
				})
			],
			generatedAt
		);

		expect(merged.grossMinor).toBe(3000);
		expect(merged.netMinor).toBe(2700);
		expect(merged.taxMinor).toBe(300);
		expect(merged.ordersCount).toBe(5);
		expect(merged.itemsCount).toBe(7);
		expect(merged.avgTicketMinor).toBe(600);
		expect(merged.payments).toEqual({ cash: 1500, lightning: 1500 });
		expect(merged.orderStatus).toEqual({ completed: 5 });
		expect(merged.topProducts).toEqual([
			{ productId: 'p2', qty: 2, revenueMinor: 2000 },
			{ productId: 'p1', qty: 1, revenueMinor: 1000 }
		]);
		expect(merged.derived).toBe(true);
		expect(merged.sourceGranularity).toBe('day');
		expect(merged.generatedAt).toBe('2026-11-04T00:00:00.000Z');
	});

	it('ignores derived inputs and malformed payloads', () => {
		const merged = mergeRollupPayload(
			[dayPayload(), { derived: true, grossMinor: 999_999 }, null, 'nope'],
			generatedAt
		);
		expect(merged.grossMinor).toBe(1000);
		expect(merged.ordersCount).toBe(2);
	});

	it('returns zeroes for no input', () => {
		const merged = mergeRollupPayload([], generatedAt);
		expect(merged.grossMinor).toBe(0);
		expect(merged.avgTicketMinor).toBe(0);
		expect(merged.topProducts).toEqual([]);
	});
});

describe('groupDaySnapshots', () => {
	it('groups by location, currency, and bucket', () => {
		const bucketStart = new Date('2026-11-02T00:00:00.000Z');
		const bucketEnd = new Date('2026-11-09T00:00:00.000Z');
		const groups = groupDaySnapshots(
			[
				{
					locationId: 'loc-1',
					currency: 'USD',
					bucketStart,
					bucketEnd,
					grossMinor: 1000,
					ordersCount: 2,
					payload: dayPayload()
				},
				{
					locationId: 'loc-1',
					currency: 'USD',
					bucketStart,
					bucketEnd,
					grossMinor: 2000,
					ordersCount: 3,
					payload: dayPayload({ grossMinor: 2000, ordersCount: 3 })
				},
				{
					locationId: 'loc-2',
					currency: 'USD',
					bucketStart,
					bucketEnd,
					grossMinor: 500,
					ordersCount: 1,
					payload: dayPayload({ grossMinor: 500, ordersCount: 1 })
				}
			],
			generatedAt
		);

		expect(groups).toHaveLength(2);
		expect(groups[0]?.locationId).toBe('loc-1');
		expect(groups[0]?.payload.grossMinor).toBe(3000);
		expect(groups[1]?.locationId).toBe('loc-2');
		expect(groups[1]?.payload.grossMinor).toBe(500);
	});

	it('returns no groups for no rows', () => {
		expect(groupDaySnapshots([], generatedAt)).toEqual([]);
	});
});
