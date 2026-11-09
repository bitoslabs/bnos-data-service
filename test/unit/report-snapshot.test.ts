import { describe, expect, it } from 'vitest';
import { parseReportSnapshotPayload } from '../../src/domain/report-snapshot.js';

function payload(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: 'report.snapshot',
		version: 1,
		granularity: 'day',
		periodStart: '2026-11-01T00:00:00.000Z',
		periodEnd: '2026-11-02T00:00:00.000Z',
		currency: 'USD',
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
		topProducts: [{ productId: 'p1', qty: 1, revenueMinor: 500 }],
		generatedAt: '2026-11-02T00:00:05.000Z',
		...overrides
	});
}

describe('parseReportSnapshotPayload', () => {
	it('accepts a valid aggregate payload', () => {
		const snapshot = parseReportSnapshotPayload(payload());
		expect(snapshot.granularity).toBe('day');
		expect(snapshot.grossMinor).toBe(1000);
		expect(snapshot.topProducts).toHaveLength(1);
	});

	it('accepts an optional location', () => {
		expect(parseReportSnapshotPayload(payload({ locationId: 'loc-1' })).locationId).toBe('loc-1');
	});

	it('rejects unknown fields (PII guard)', () => {
		expect(() => parseReportSnapshotPayload(payload({ customerName: 'Alice' }))).toThrow(
			'unknown field'
		);
	});

	it('rejects invalid dates and currencies', () => {
		expect(() => parseReportSnapshotPayload(payload({ periodStart: 'nope' }))).toThrow(
			'periodStart'
		);
		expect(() => parseReportSnapshotPayload(payload({ currency: 'usd' }))).toThrow('currency');
	});

	it('rejects reversed periods', () => {
		expect(() =>
			parseReportSnapshotPayload(
				payload({ periodStart: '2026-11-02T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' })
			)
		).toThrow('before periodEnd');
	});

	it('rejects negative and non-integer amounts', () => {
		expect(() => parseReportSnapshotPayload(payload({ grossMinor: -1 }))).toThrow('grossMinor');
		expect(() => parseReportSnapshotPayload(payload({ netMinor: 1.5 }))).toThrow('netMinor');
	});

	it('caps top products and rejects unknown product fields', () => {
		const tooMany = Array.from({ length: 51 }, (_, i) => ({
			productId: `p-${i}`,
			qty: 1,
			revenueMinor: 1
		}));
		expect(() => parseReportSnapshotPayload(payload({ topProducts: tooMany }))).toThrow(
			'at most 50'
		);
		expect(() =>
			parseReportSnapshotPayload(
				payload({ topProducts: [{ productId: 'p1', qty: 1, revenueMinor: 1, secret: 'x' }] })
			)
		).toThrow('unknown key');
	});

	it('rejects non-JSON and missing fields', () => {
		expect(() => parseReportSnapshotPayload('plain text')).toThrow('must be JSON');
		expect(() => parseReportSnapshotPayload(JSON.stringify({ type: 'report.snapshot' }))).toThrow(
			'version'
		);
	});
});
