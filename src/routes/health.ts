import type { FastifyInstance } from 'fastify';
import { isDatabaseReady } from '../db/index.js';
import type { RouteDeps } from './types.js';

export function registerHealth(app: FastifyInstance, deps: RouteDeps): void {
	app.get('/healthz', async () => ({ ok: true }));

	app.get('/readyz', async (_request, reply) => {
		const ready = await isDatabaseReady(deps.db);
		if (!ready) return reply.status(503).send({ ok: false });
		return { ok: true };
	});
}
