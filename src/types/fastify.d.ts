import 'fastify';
import type { SessionContext } from '../services/auth.js';

declare module 'fastify' {
	interface FastifyRequest {
		auth?: SessionContext;
	}
}
