import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';

export function registerCapabilities(app: FastifyInstance, deps: RouteDeps): void {
	app.get('/v1/capabilities', async () => ({
		protocol: 1,
		service: {
			id: deps.config.serviceId,
			name: deps.config.serviceName
		},
		auth: {
			challenge: 'nostr-event',
			kind: 27235,
			audience: deps.config.audience
		},
		capabilities: {
			backup: true,
			status: true,
			reporting: deps.config.enableReporting,
			// Only advertise this after a real, verified restore drill.
			restoreStatus: false
		}
	}));
}
