import { describe, expect, it } from 'vitest';
import {
	buildBatchFilter,
	eventMatchesWorkspace,
	nextCursor,
	normalizeRelayUrl,
	parseRelayFilter
} from '../../src/domain/relay.js';

describe('normalizeRelayUrl', () => {
	it('normalizes wss URLs and removes trailing slashes', () => {
		expect(normalizeRelayUrl('wss://relay.example.com/')).toBe('wss://relay.example.com');
	});

	it('allows ws only on loopback', () => {
		expect(normalizeRelayUrl('ws://localhost:7777')).toBe('ws://localhost:7777');
		expect(() => normalizeRelayUrl('ws://relay.example.com')).toThrow('wss://');
	});

	it('rejects http and credentials', () => {
		expect(() => normalizeRelayUrl('https://relay.example.com')).toThrow('wss://');
		expect(() => normalizeRelayUrl('wss://user:pass@relay.example.com')).toThrow('credentials');
	});
});

describe('parseRelayFilter', () => {
	it('accepts supported keys', () => {
		expect(
			parseRelayFilter({
				kinds: [30_078, 30_100],
				authors: ['a'.repeat(64)],
				'#organization': ['ws-1'],
				since: 100,
				limit: 50
			})
		).toEqual({
			kinds: [30_078, 30_100],
			authors: ['a'.repeat(64)],
			'#organization': ['ws-1'],
			since: 100,
			limit: 50
		});
	});

	it('rejects unknown keys and invalid values', () => {
		expect(() => parseRelayFilter({ foo: 1 })).toThrow('Unsupported filter key');
		expect(() => parseRelayFilter({ authors: ['nope'] })).toThrow('hex');
		expect(() => parseRelayFilter({ kinds: ['x'] })).toThrow('integer array');
		expect(() => parseRelayFilter({ since: -1 })).toThrow('non-negative');
	});

	it('requires a type selector', () => {
		expect(() => parseRelayFilter({ '#organization': ['ws-1'] })).toThrow(
			'kinds, ids, or authors'
		);
	});
});

describe('buildBatchFilter', () => {
	it('uses the filter since on the first run', () => {
		expect(buildBatchFilter({ kinds: [30_078], since: 50 }, 0, 100)).toEqual({
			kinds: [30_078],
			since: 50,
			limit: 100
		});
	});

	it('advances to the cursor and caps the limit', () => {
		const filter = buildBatchFilter({ kinds: [30_078], since: 50 }, 200, 10_000);
		expect(filter.since).toBe(200);
		expect(filter.limit).toBe(500);
	});
});

describe('eventMatchesWorkspace', () => {
	const member = 'b'.repeat(64);
	const allowed = new Set([member]);

	it('accepts a member with a matching organization tag', () => {
		expect(
			eventMatchesWorkspace(
				{ pubkey: member, tags: [['organization', 'ws-1']] },
				'ws-1',
				allowed
			)
		).toBe(true);
	});

	it('accepts a member with no organization tag', () => {
		expect(eventMatchesWorkspace({ pubkey: member, tags: [] }, 'ws-1', allowed)).toBe(true);
	});

	it('rejects non-members and mismatched organizations', () => {
		expect(
			eventMatchesWorkspace({ pubkey: 'c'.repeat(64), tags: [] }, 'ws-1', allowed)
		).toBe(false);
		expect(
			eventMatchesWorkspace(
				{ pubkey: member, tags: [['organization', 'ws-2']] },
				'ws-1',
				allowed
			)
		).toBe(false);
	});
});

describe('nextCursor', () => {
	it('returns the highest created_at, never below the current cursor', () => {
		expect(nextCursor([{ created_at: 10 }, { created_at: 25 }], 20)).toBe(25);
		expect(nextCursor([{ created_at: 10 }], 20)).toBe(20);
	});
});
