import type { FastifyInstance } from 'fastify';
import { forbidden } from '../domain/errors.js';
import { requireSession } from '../plugins/auth.js';
import { hasPermission } from '../services/auth.js';
import { getStatus } from '../services/status.js';
import type { RouteDeps } from './types.js';

export function registerStatus(app: FastifyInstance, deps: RouteDeps): void {
	app.get('/v1/status', { preHandler: deps.authenticate }, async (request) => {
		const session = requireSession(request);
		if (!hasPermission(session, 'status.read')) throw forbidden();
		return getStatus(deps.db, session, deps.clock());
	});
}
