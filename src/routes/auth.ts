import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
	issueChallenge,
	logoutSession,
	refreshSession,
	verifyChallenge
} from '../services/auth.js';
import { readBearerToken } from '../plugins/auth.js';
import type { RouteDeps } from './types.js';

const Pubkey = Type.String({ pattern: '^[0-9a-fA-F]{64}$' });

const ChallengeBody = Type.Object({
	invite: Type.String({ minLength: 1, maxLength: 512 }),
	pubkey: Pubkey,
	workspaceId: Type.String({ minLength: 1, maxLength: 256 })
});

const VerifyBody = Type.Object({
	challengeId: Type.String({ minLength: 1, maxLength: 128 }),
	event: Type.Unknown()
});

const RefreshBody = Type.Object({
	refreshToken: Type.String({ minLength: 1, maxLength: 512 })
});

type ChallengeInput = Static<typeof ChallengeBody>;
type VerifyInput = Static<typeof VerifyBody>;
type RefreshInput = Static<typeof RefreshBody>;
type LogoutInput = { refreshToken?: string };

function authRouteConfig(deps: RouteDeps) {
	return {
		rateLimit: {
			max: deps.config.authRateLimitMax,
			timeWindow: deps.config.authRateLimitWindow
		}
	};
}

export function registerAuth(app: FastifyInstance, deps: RouteDeps): void {
	app.post<{ Body: ChallengeInput }>(
		'/v1/auth/challenge',
		{ schema: { body: ChallengeBody }, config: authRouteConfig(deps) },
		async (request) => issueChallenge({ db: deps.db, config: deps.config }, request.body, deps.clock())
	);

	app.post<{ Body: VerifyInput }>(
		'/v1/auth/verify',
		{ schema: { body: VerifyBody }, config: authRouteConfig(deps) },
		async (request) =>
			verifyChallenge({ db: deps.db, config: deps.config }, request.body, deps.clock())
	);

	app.post<{ Body: RefreshInput }>(
		'/v1/auth/refresh',
		{ schema: { body: RefreshBody }, config: authRouteConfig(deps) },
		async (request) =>
			refreshSession({ db: deps.db, config: deps.config }, request.body.refreshToken, deps.clock())
	);

	app.post<{ Body: LogoutInput }>('/v1/auth/logout', async (request, reply) => {
		await logoutSession(
			deps.db,
			{
				token: readBearerToken(request),
				refreshToken: request.body?.refreshToken
			},
			deps.clock()
		);
		return reply.status(204).send();
	});
}
