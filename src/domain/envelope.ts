/**
 * Encryption envelope validation.
 *
 * The service stores ciphertext, so it validates the wrapper shape only. This
 * mirrors the client guard in bnos-svelte `data-service/queue.ts` and accepts
 * the two GLO ciphertext schemes used by the clients.
 */
export type EnvelopeCheck =
	| { ok: true; scheme: string; kid: string }
	| { ok: false; reason: string };

const ALLOWED_KEYS = new Set([
	'v',
	'encrypted',
	'scheme',
	'alg',
	'kid',
	'nonce',
	'ciphertext',
	'aad'
]);

const ALLOWED_SCHEMES = new Set([
	'org.bitos.bnos.organization-key.v1',
	'bdgoos.local-company-key.v1'
]);

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_CONTENT_BYTES = 512 * 1024;
const MAX_CIPHERTEXT_BYTES = 512 * 1024;
const MAX_KID_LENGTH = 256;
const NONCE_BYTES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCanonical(value: unknown): Buffer | null {
	if (typeof value !== 'string' || !BASE64URL.test(value)) return null;
	const bytes = Buffer.from(value, 'base64url');
	return bytes.toString('base64url') === value ? bytes : null;
}

export function checkEncryptionEnvelope(content: string): EnvelopeCheck {
	if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
		return { ok: false, reason: 'content-too-large' };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { ok: false, reason: 'plaintext-not-allowed' };
	}
	if (!isRecord(parsed)) return { ok: false, reason: 'invalid-envelope' };

	// Reject alternate encodings that could smuggle extra fields past validation.
	if (JSON.stringify(parsed) !== content) return { ok: false, reason: 'invalid-envelope' };
	if (Object.keys(parsed).some((key) => !ALLOWED_KEYS.has(key))) {
		return { ok: false, reason: 'invalid-envelope' };
	}
	if (parsed.v !== 1 || parsed.encrypted !== true) return { ok: false, reason: 'invalid-envelope' };
	if (parsed.alg !== 'AES-256-GCM') return { ok: false, reason: 'invalid-envelope' };
	if (typeof parsed.scheme !== 'string' || !ALLOWED_SCHEMES.has(parsed.scheme)) {
		return { ok: false, reason: 'unsupported-scheme' };
	}
	if (
		typeof parsed.kid !== 'string' ||
		!parsed.kid ||
		parsed.kid.length > MAX_KID_LENGTH ||
		CONTROL_CHARS.test(parsed.kid)
	) {
		return { ok: false, reason: 'invalid-envelope' };
	}

	const nonce = decodeCanonical(parsed.nonce);
	if (!nonce || nonce.length !== NONCE_BYTES) return { ok: false, reason: 'invalid-envelope' };

	const ciphertext = decodeCanonical(parsed.ciphertext);
	if (!ciphertext || ciphertext.length < 16 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
		return { ok: false, reason: 'invalid-envelope' };
	}

	if (parsed.aad !== undefined) {
		if (!isRecord(parsed.aad)) return { ok: false, reason: 'invalid-envelope' };
		for (const [key, value] of Object.entries(parsed.aad)) {
			if (key !== 'recordId') return { ok: false, reason: 'invalid-envelope' };
			if (
				typeof value !== 'string' ||
				!value ||
				value.length > 256 ||
				CONTROL_CHARS.test(value)
			) {
				return { ok: false, reason: 'invalid-envelope' };
			}
		}
	}

	return { ok: true, scheme: parsed.scheme, kid: parsed.kid };
}
