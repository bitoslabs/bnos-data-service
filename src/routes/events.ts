import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { forbidden } from '../domain/errors.js';
import { requireSession } from '../plugins/auth.js';
import { hasPermission } from '../services/auth.js';
import { ingestEvents } from '../services/ingest.js';
import type { RouteDeps } from './types.js';

interface EventsInput {
	events: unknown[];
}

export function registerEvents(app: FastifyInstance, deps: RouteDeps): void {
	const schema = Type.Object({
		events: Type.Array(Type.Unknown(), { maxItems: deps.config.maxBatchSize })
	});

	app.post<{ Body: EventsInput }>(
		'/v1/events',
		{ schema: { body: schema }, preHandler: deps.authenticate },
		async (request) => {
			const session = requireSession(request);
			if (!hasPermission(session, 'backup.write')) throw forbidden();

			return ingestEvents(
				{ db: deps.db, config: deps.config },
				session.workspaceId,
				request.body.events,
				deps.clock()
			);
		}
	);
}
