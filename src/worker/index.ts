import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { runRelayIndexer, type Logger } from './relay-indexer.js';

const config = loadConfig();

if (!config.enableRelayIndexer) {
	console.log('Relay indexer is disabled (set ENABLE_RELAY_INDEXER=true to run it)');
	process.exit(0);
}

const { db } = createDatabase(config);
const controller = new AbortController();
const logger: Logger = {
	info: (detail, message) => console.log(message, JSON.stringify(detail)),
	error: (detail, message) => console.error(message, JSON.stringify(detail))
};

process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

try {
	await runRelayIndexer({
		db,
		config,
		clock: () => new Date(),
		logger,
		signal: controller.signal
	});
} finally {
	await db.destroy();
}
