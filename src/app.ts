import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { createAuthenticator } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerRoutes } from './routes/index.js';

export interface BuildAppInput {
	readonly config: Config;
	readonly db: Kysely<Database>;
	readonly clock?: () => Date;
}

export async function buildApp(input: BuildAppInput): Promise<FastifyInstance> {
	const { config, db } = input;
	const clock = input.clock ?? (() => new Date());

	const app = Fastify({
		logger: {
			level: config.logLevel,
			redact: {
				paths: [
					'req.headers.authorization',
					'authorization',
					'*.token',
					'*.refreshToken',
					'*.invite',
					'*.code'
				],
				censor: '[redacted]'
			}
		},
		bodyLimit: config.maxBodyBytes,
		trustProxy: true
	});

	await app.register(helmet, { contentSecurityPolicy: false });
	await app.register(cors, {
		origin: config.corsOrigins.length ? config.corsOrigins : false,
		methods: ['GET', 'POST', 'OPTIONS'],
		allowedHeaders: ['authorization', 'content-type', 'accept'],
		maxAge: 86_400
	});
	await app.register(rateLimit, {
		global: true,
		max: config.rateLimitMax,
		timeWindow: config.rateLimitWindow
	});

	registerErrorHandler(app);

	const authenticate = createAuthenticator(db, clock);
	registerRoutes(app, { config, db, clock, authenticate });

	return app;
}
