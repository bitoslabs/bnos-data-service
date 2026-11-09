import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { forbidden } from '../domain/errors.js';
import { requireSession } from '../plugins/auth.js';
import { hasPermission } from '../services/auth.js';
import { getReportSummary, ingestReportSnapshot, reportEtag } from '../services/reports.js';
import type { RouteDeps } from './types.js';

interface SnapshotInput {
	snapshot: unknown;
}

export function registerReports(app: FastifyInstance, deps: RouteDeps): void {
	const bodySchema = Type.Object({ snapshot: Type.Unknown() });

	app.post<{ Body: SnapshotInput }>(
		'/v1/reports/snapshots',
		{ schema: { body: bodySchema }, preHandler: deps.authenticate },
		async (request) => {
			const session = requireSession(request);
			if (!hasPermission(session, 'reports.write') && !hasPermission(session, 'backup.write')) {
				throw forbidden();
			}

			return ingestReportSnapshot(
				{ db: deps.db, config: deps.config },
				session,
				request.body.snapshot,
				deps.clock()
			);
		}
	);

	app.get<{ Querystring: Record<string, string | undefined> }>(
		'/v1/reports/summary',
		{ preHandler: deps.authenticate },
		async (request, reply) => {
			const session = requireSession(request);
			if (!hasPermission(session, 'reports.read')) throw forbidden();

			const summary = await getReportSummary(
				{ db: deps.db, config: deps.config },
				session,
				request.query,
				deps.clock()
			);

			const etag = reportEtag(summary);
			void reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
			const ifNoneMatch = request.headers['if-none-match'];
			if (ifNoneMatch?.split(',').some((value) => value.trim() === etag)) {
				return reply.status(304).send();
			}
			return summary;
		}
	);
}
