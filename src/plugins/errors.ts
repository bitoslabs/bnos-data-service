import type { FastifyInstance } from 'fastify';
import { ServiceError } from '../domain/errors.js';

interface MaybeFastifyError {
	validation?: unknown;
	statusCode?: number;
	code?: string;
}

/**
 * Single boundary between domain errors and HTTP. Internal details are never
 * returned to clients.
 */
export function registerErrorHandler(app: FastifyInstance): void {
	app.setNotFoundHandler(async (_request, reply) => {
		reply.status(404).send({ error: { code: 'not-found', message: 'Not found' } });
	});

	app.setErrorHandler(async (error, request, reply) => {
		if (error instanceof ServiceError) {
			return reply
				.status(error.statusCode)
				.send({ error: { code: error.code, message: error.message } });
		}

		const fastifyError = error as unknown as MaybeFastifyError;
		if (fastifyError.validation) {
			return reply
				.status(400)
				.send({ error: { code: 'invalid-request', message: 'Invalid request' } });
		}
		if (fastifyError.statusCode === 413 || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
			return reply
				.status(413)
				.send({ error: { code: 'payload-too-large', message: 'Request body is too large' } });
		}
		if (fastifyError.statusCode && fastifyError.statusCode < 500) {
			return reply
				.status(fastifyError.statusCode)
				.send({ error: { code: 'invalid-request', message: 'Invalid request' } });
		}

		request.log.error({ err: error }, 'unhandled request error');
		return reply
			.status(500)
			.send({ error: { code: 'internal', message: 'Internal server error' } });
	});
}
