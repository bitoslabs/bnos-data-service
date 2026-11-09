/** Join a normalized base URL (no trailing slash) with a relative path. */
export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Exact URL the client signs in the auth event `u` tag. */
export function expectedVerifyUrl(audience: string): string {
	return joinUrl(audience, 'v1/auth/verify');
}

export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}
