import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { verifyAuthEvent, verifySignedEvent, type SignedEvent } from '../../src/domain/nostr.js';

const secretKey = generateSecretKey();
const now = 1_760_000_000;
const options = { now, maxClockSkewSeconds: 900 };

function signed(input: {
	kind?: number;
	content?: string;
	created_at?: number;
	tags?: string[][];
}): SignedEvent {
	return finalizeEvent(
		{
			kind: input.kind ?? 30_078,
			created_at: input.created_at ?? now,
			tags: input.tags ?? [['d', 'org.bitos.glo:v1:organization:test']],
			content: input.content ?? '{}'
		},
		secretKey
	) as SignedEvent;
}

describe('verifySignedEvent', () => {
	it('accepts a valid signed GLO event', () => {
		const result = verifySignedEvent(signed({}), options);
		expect(result.ok).toBe(true);
	});

	it('rejects disallowed kinds', () => {
		expect(verifySignedEvent(signed({ kind: 4 }), options)).toEqual({
			ok: false,
			reason: 'kind-not-allowed'
		});
	});

	it('rejects events too far in the future', () => {
		const event = signed({ created_at: now + 100_000 });
		expect(verifySignedEvent(event, options)).toEqual({
			ok: false,
			reason: 'future-timestamp'
		});
	});

	it('rejects a tampered id', () => {
		const event = signed({});
		expect(verifySignedEvent({ ...event, content: '{"tampered":true}' }, options)).toEqual({
			ok: false,
			reason: 'invalid-id'
		});
	});

	it('rejects a bad signature', () => {
		const event = signed({});
		const sig = (event.sig[0] === '0' ? '1' : '0') + event.sig.slice(1);
		expect(verifySignedEvent({ ...event, sig }, options)).toEqual({
			ok: false,
			reason: 'invalid-signature'
		});
	});

	it('rejects malformed input', () => {
		expect(verifySignedEvent(null, options)).toEqual({
			ok: false,
			reason: 'invalid-event-shape'
		});
	});
});

describe('verifyAuthEvent', () => {
	function authEvent(overrides: { nonce?: string } = {}): SignedEvent {
		return signed({
			kind: 27_235,
			content: '',
			tags: [
				['u', 'https://data.example.com/v1/auth/verify'],
				['method', 'POST'],
				['challenge', overrides.nonce ?? 'nonce-1'],
				['audience', 'https://data.example.com'],
				['workspace', 'ws-1']
			]
		});
	}

	const expected = {
		url: 'https://data.example.com/v1/auth/verify',
		audience: 'https://data.example.com',
		workspaceId: 'ws-1',
		nonce: 'nonce-1',
		now,
		maxClockSkewSeconds: 900
	};

	it('accepts a matching auth event', () => {
		expect(() => verifyAuthEvent(authEvent(), expected)).not.toThrow();
	});

	it('rejects a consumed or wrong nonce', () => {
		expect(() => verifyAuthEvent(authEvent({ nonce: 'other' }), expected)).toThrow(
			'Invalid auth event'
		);
	});
});
