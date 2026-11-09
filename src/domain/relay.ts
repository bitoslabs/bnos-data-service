/**
 * Relay backfill policy.
 *
 * Filters are validated before use, and every relayed event must be authored by
 * a current workspace member. An `organization` tag alone is not authorization:
 * anyone can publish an event claiming a workspace on a public relay.
 */
import { isHex } from './hash.js';
import { isLoopbackHost } from './url.js';

export type RelayFilter = Record<string, unknown>;

const MAX_FILTER_LIMIT = 500;
const MAX_TAG_VALUES = 500;
const MAX_SEARCH = 512;

const SCALAR_KEYS = new Set(['since', 'until', 'limit']);
const ARRAY_KEYS = new Set(['ids', 'authors', 'kinds']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

function stringArray(value: unknown, label: string, maxItems = MAX_TAG_VALUES): string[] {
	if (!Array.isArray(value) || value.length > maxItems || !value.every((v) => typeof v === 'string')) {
		throw new Error(`${label} must be a string array`);
	}
	return value as string[];
}

/** Validate an admin-supplied NIP-01 filter. Unknown keys are rejected. */
export function parseRelayFilter(value: unknown): RelayFilter {
	if (!isRecord(value)) throw new Error('filter must be an object');

	const filter: RelayFilter = {};
	for (const [key, raw] of Object.entries(value)) {
		if (key === 'ids' || key === 'authors') {
			const entries = stringArray(raw, key);
			if (!entries.every((entry) => isHex(entry, 64))) {
				throw new Error(`${key} must contain 64-character hex values`);
			}
			filter[key] = entries;
			continue;
		}
		if (key === 'kinds') {
			if (
				!Array.isArray(raw) ||
				!raw.every((kind) => typeof kind === 'number' && Number.isInteger(kind) && kind >= 0)
			) {
				throw new Error('kinds must be an integer array');
			}
			filter[key] = raw;
			continue;
		}
		if (SCALAR_KEYS.has(key)) {
			filter[key] = nonNegativeInteger(raw, key);
			continue;
		}
		if (key === 'search') {
			if (typeof raw !== 'string' || raw.length > MAX_SEARCH) {
				throw new Error('search must be a bounded string');
			}
			filter[key] = raw;
			continue;
		}
		if (key.startsWith('#') && key.length > 1) {
			filter[key] = stringArray(raw, key);
			continue;
		}
		throw new Error(`Unsupported filter key: ${key}`);
	}

	if (!filter.kinds && !filter.ids && !filter.authors) {
		throw new Error('filter must include kinds, ids, or authors');
	}

	return filter;
}

/**
 * Merge the durable cursor and batch cap into the stored filter.
 * `since` is inclusive; boundary events are re-fetched and deduped by id.
 */
export function buildBatchFilter(
	filter: RelayFilter,
	cursor: number,
	limit: number
): RelayFilter {
	const baseSince = typeof filter.since === 'number' ? filter.since : 0;
	const since = cursor > 0 ? Math.max(cursor, baseSince) : baseSince;
	return {
		...filter,
		...(since > 0 ? { since } : {}),
		limit: Math.min(limit, MAX_FILTER_LIMIT)
	};
}

export function getEventTag(event: { tags: readonly string[][] }, name: string): string | undefined {
	return event.tags.find((tag) => tag[0] === name)?.[1];
}

/**
 * A relayed event belongs to a workspace only when its author is a current
 * member and any `organization` tag matches. This blocks spoofed tags.
 */
export function eventMatchesWorkspace(
	event: { pubkey: string; tags: readonly string[][] },
	workspaceId: string,
	allowedAuthors: ReadonlySet<string>
): boolean {
	if (!allowedAuthors.has(event.pubkey)) return false;
	const organization = getEventTag(event, 'organization');
	if (organization && organization !== workspaceId) return false;
	return true;
}

/** Highest `created_at` in the batch, never below the existing cursor. */
export function nextCursor(
	events: readonly { created_at: number }[],
	current: number
): number {
	let next = current;
	for (const event of events) {
		if (event.created_at > next) next = event.created_at;
	}
	return next;
}

/** Accept `wss://` anywhere and `ws://` only on loopback for development. */
export function normalizeRelayUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new Error('Relay URL must be a valid ws:// or wss:// URL');
	}
	if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
		throw new Error('Relay URL must use wss:// (or ws:// on loopback)');
	}
	if (url.protocol === 'ws:' && !isLoopbackHost(url.hostname)) {
		throw new Error('Use wss:// for remote relays');
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error('Relay URL must not contain credentials, query, or fragment');
	}
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.protocol}//${url.host}${path}`;
}
