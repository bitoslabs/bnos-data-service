import type { preHandlerHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';

export interface RouteDeps {
	readonly config: Config;
	readonly db: Kysely<Database>;
	readonly clock: () => Date;
	readonly authenticate: preHandlerHookHandler;
}
