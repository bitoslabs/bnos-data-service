import { describe, expect, it } from 'vitest';
import { checkEncryptionEnvelope } from '../../src/domain/envelope.js';

function envelope(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		v: 1,
		encrypted: true,
		scheme: 'org.bitos.bnos.organization-key.v1',
		alg: 'AES-256-GCM',
		kid: 'k_test',
		nonce: Buffer.alloc(12, 1).toString('base64url'),
		aad: { recordId: 'record-1' },
		ciphertext: Buffer.alloc(32, 2).toString('base64url'),
		...overrides
	});
}

describe('checkEncryptionEnvelope', () => {
	it('accepts a canonical GLO envelope', () => {
		const result = checkEncryptionEnvelope(envelope());
		expect(result).toEqual({
			ok: true,
			scheme: 'org.bitos.bnos.organization-key.v1',
			kid: 'k_test'
		});
	});

	it('accepts the bdgo-os local company key scheme', () => {
		expect(checkEncryptionEnvelope(envelope({ scheme: 'bdgoos.local-company-key.v1' })).ok).toBe(
			true
		);
	});

	it('rejects plaintext', () => {
		expect(checkEncryptionEnvelope('hello')).toEqual({
			ok: false,
			reason: 'plaintext-not-allowed'
		});
	});

	it('rejects unexpected keys', () => {
		expect(checkEncryptionEnvelope(envelope({ extra: true }))).toEqual({
			ok: false,
			reason: 'invalid-envelope'
		});
	});

	it('rejects a non-12-byte nonce', () => {
		expect(checkEncryptionEnvelope(envelope({ nonce: Buffer.alloc(8, 1).toString('base64url') }))).toEqual(
			{ ok: false, reason: 'invalid-envelope' }
		);
	});

	it('rejects an unsupported scheme', () => {
		expect(checkEncryptionEnvelope(envelope({ scheme: 'unknown' }))).toEqual({
			ok: false,
			reason: 'unsupported-scheme'
		});
	});

	it('rejects non-canonical JSON', () => {
		const canonical = envelope();
		const spaced = JSON.stringify(JSON.parse(canonical), null, 2);
		expect(checkEncryptionEnvelope(spaced)).toEqual({
			ok: false,
			reason: 'invalid-envelope'
		});
	});
});
