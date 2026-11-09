import { describe, expect, it } from 'vitest';
import { parseReportRange } from '../../src/domain/report-query.js';

const limits = { maxRangeDays: 400, maxBuckets: 2000 };
const day = 86_400;

describe('parseReportRange', () => {
	it('parses a valid range', () => {
		const range = parseReportRange(
			{ from: '1761955200', to: String(1761955200 + day), granularity: 'day' },
			limits
		);
		expect(range.from).toBe(1761955200);
		expect(range.to).toBe(1761955200 + day);
		expect(range.granularity).toBe('day');
	});

	it('parses optional location and currency', () => {
		const range = parseReportRange(
			{
				from: '1761955200',
				to: String(1761955200 + day),
				granularity: 'day',
				location: 'loc-1',
				currency: 'USD'
			},
			limits
		);
		expect(range.locationId).toBe('loc-1');
		expect(range.currency).toBe('USD');
	});

	it('rejects invalid ranges', () => {
		expect(() =>
			parseReportRange({ from: 'x', to: '2', granularity: 'day' }, limits)
		).toThrow('from');
		expect(() =>
			parseReportRange({ from: '2', to: '1', granularity: 'day' }, limits)
		).toThrow('before to');
		expect(() =>
			parseReportRange({ from: '1', to: String(1 + 401 * day), granularity: 'day' }, limits)
		).toThrow('exceeds');
	});

	it('rejects too many buckets', () => {
		expect(() =>
			parseReportRange(
				{ from: '1', to: String(1 + 2001 * 3600), granularity: 'hour' },
				limits
			)
		).toThrow('buckets');
	});

	it('rejects bad granularity, location, and currency', () => {
		expect(() =>
			parseReportRange({ from: '1', to: String(1 + day), granularity: 'year' }, limits)
		).toThrow('granularity');
		expect(() =>
			parseReportRange(
				{ from: '1', to: String(1 + day), granularity: 'day', location: 'x'.repeat(129) },
				limits
			)
		).toThrow('location');
		expect(() =>
			parseReportRange(
				{ from: '1', to: String(1 + day), granularity: 'day', currency: 'usd' },
				limits
			)
		).toThrow('currency');
	});
});
