/**
 * Nostr event verification.
 *
 * Verification is a policy boundary, not an HTTP concern: routes and workers
 * both need the same checks, and ingest turns failures into per-event reasons
 * instead of failing the whole batch.
 */
import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import { ServiceError, unauthorized } from './errors.js';
import { isHex } from './hash.js';

export interface SignedEvent {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
}

export type VerificationResult =
	| { ok: true; event: SignedEvent }
	| { ok: false; reason: string };

interface VerifyOptions {
	now: number;
	maxClockSkewSeconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTagList(value: unknown): value is string[][] {
	return (
		Array.isArray(value) &&
		value.every(
			(tag) => Array.isArray(tag) && tag.length > 0 && tag.every((part) => typeof part === 'string')
		)
	);
}

/** Structural check only; signatures are verified separately. */
export function isSignedEvent(value: unknown): value is SignedEvent {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		isHex(value.id, 64) &&
		typeof value.pubkey === 'string' &&
		isHex(value.pubkey, 64) &&
		typeof value.sig === 'string' &&
		isHex(value.sig, 128) &&
		typeof value.content === 'string' &&
		typeof value.created_at === 'number' &&
		Number.isInteger(value.created_at) &&
		typeof value.kind === 'number' &&
		Number.isInteger(value.kind) &&
		isTagList(value.tags)
	);
}

/**
 * Copy only the protocol fields.
 *
 * `nostr-tools` attaches an enumerable `verified` symbol to events returned by
 * `finalizeEvent`; trusting it would let a caller spread a tampered event and
 * inherit the marker. A plain copy forces real cryptographic verification.
 */
function toPlainEvent(event: SignedEvent): SignedEvent {
	return {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig
	};
}

/** Event id if present, for rejected-item reporting. */
export function eventIdOf(value: unknown): string | undefined {
	if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
		const id = (value as { id: string }).id;
		return id || undefined;
	}
	return undefined;
}

/** Allowed kinds for backup ingest: profiles, contacts, deletions, and GLO. */
export function isAllowedIngestKind(kind: number): boolean {
	if (kind === 0 || kind === 3 || kind === 5) return true;
	return kind >= 30_000 && kind <= 39_999;
}

export function getTagValue(tags: readonly string[][], name: string): string | undefined {
	return tags.find((tag) => tag[0] === name)?.[1];
}

/**
 * Verify canonical id, Schnorr signature, kind policy, and clock bounds.
 * Returns a reason string on failure; never throws.
 */
export function verifySignedEvent(value: unknown, options: VerifyOptions): VerificationResult {
	if (!isSignedEvent(value)) return { ok: false, reason: 'invalid-event-shape' };
	const event = toPlainEvent(value);

	if (!isAllowedIngestKind(event.kind)) return { ok: false, reason: 'kind-not-allowed' };
	if (event.created_at <= 0) return { ok: false, reason: 'invalid-timestamp' };
	if (event.created_at > options.now + options.maxClockSkewSeconds) {
		return { ok: false, reason: 'future-timestamp' };
	}

	let expectedId: string;
	try {
		expectedId = getEventHash(event);
	} catch {
		return { ok: false, reason: 'invalid-event-shape' };
	}
	if (expectedId !== event.id) return { ok: false, reason: 'invalid-id' };
	if (!verifyEvent(event)) return { ok: false, reason: 'invalid-signature' };

	return { ok: true, event };
}

export interface AuthEventExpectation {
	url: string;
	audience: string;
	workspaceId: string;
	nonce: string;
	now: number;
	maxClockSkewSeconds: number;
}

/**
 * Verify the NIP-98-style event used to authorize a challenge.
 * Throws `401` on any mismatch so callers do not reveal which check failed.
 */
export function verifyAuthEvent(value: unknown, expected: AuthEventExpectation): SignedEvent {
	if (!isSignedEvent(value)) throw unauthorized('Invalid auth event');

	const event = toPlainEvent(value);
	if (event.kind !== 27235) throw unauthorized('Invalid auth event');
	if (Math.abs(event.created_at - expected.now) > expected.maxClockSkewSeconds) {
		throw unauthorized('Invalid auth event');
	}
	if (getTagValue(event.tags, 'u') !== expected.url) throw unauthorized('Invalid auth event');
	if (getTagValue(event.tags, 'method') !== 'POST') throw unauthorized('Invalid auth event');
	if (getTagValue(event.tags, 'challenge') !== expected.nonce) {
		throw unauthorized('Invalid auth event');
	}
	if (getTagValue(event.tags, 'audience') !== expected.audience) {
		throw unauthorized('Invalid auth event');
	}
	if (getTagValue(event.tags, 'workspace') !== expected.workspaceId) {
		throw unauthorized('Invalid auth event');
	}

	let expectedId: string;
	try {
		expectedId = getEventHash(event);
	} catch {
		throw unauthorized('Invalid auth event');
	}
	if (expectedId !== event.id) throw unauthorized('Invalid auth event');
	if (!verifyEvent(event)) throw unauthorized('Invalid auth event');

	return event;
}

/** Non-fatal assertion used by services that already have a result type. */
export function ensureVerified(result: VerificationResult): SignedEvent {
	if (!result.ok) throw new ServiceError('rejected', result.reason, 400);
	return result.event;
}
