import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 of a string or byte buffer, as bytes. */
export function sha256(value: string | Uint8Array): Buffer {
	return createHash('sha256').update(value).digest();
}

/** SHA-256 hex digest. */
export function sha256Hex(value: string | Uint8Array): string {
	return sha256(value).toString('hex');
}

/** Opaque, URL-safe secret (tokens, invite codes, nonces). */
export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 16): string {
	return randomBytes(bytes).toString('hex');
}

/** Hash a bearer/refresh token or invite code for storage. */
export function hashSecret(value: string): Buffer {
	return sha256(value);
}

export function safeEqual(left: Buffer, right: Buffer): boolean {
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export function isHex(value: string, length: number): boolean {
	return value.length === length && /^[0-9a-f]+$/i.test(value);
}
