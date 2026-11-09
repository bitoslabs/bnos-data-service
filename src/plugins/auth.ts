import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import { unauthorized } from '../domain/errors.js';
import { authenticateToken, type SessionContext } from '../services/auth.js';

export function readBearerToken(request: FastifyRequest): string | undefined {
	const header = request.headers.authorization;
	if (!header) return undefined;
	const [scheme, value] = header.split(' ');
	if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
	return value.trim() || undefined;
}

export function createAuthenticator(
	db: Kysely<Database>,
	clock: () => Date
): preHandlerHookHandler {
	return async (request) => {
		const token = readBearerToken(request);
		if (!token) throw unauthorized();
		request.auth = await authenticateToken(db, token, clock());
	};
}

export function requireSession(request: FastifyRequest): SessionContext {
	if (!request.auth) throw unauthorized();
	return request.auth;
}
