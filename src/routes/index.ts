import type { FastifyInstance } from 'fastify';
import { registerAuth } from './auth.js';
import { registerCapabilities } from './capabilities.js';
import { registerEvents } from './events.js';
import { registerHealth } from './health.js';
import { registerReports } from './reports.js';
import { registerStatus } from './status.js';
import type { RouteDeps } from './types.js';

function registerScopedRoutes(app: FastifyInstance, deps: RouteDeps): void {
	registerCapabilities(app, deps);
	registerAuth(app, deps);
	registerEvents(app, deps);
	registerStatus(app, deps);
	if (deps.config.enableReporting) registerReports(app, deps);
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
	registerHealth(app, deps);

	const scoped = async (instance: FastifyInstance): Promise<void> => {
		registerScopedRoutes(instance, deps);
	};

	if (deps.config.basePath) {
		void app.register(scoped, { prefix: deps.config.basePath });
	} else {
		void app.register(scoped);
	}
}
