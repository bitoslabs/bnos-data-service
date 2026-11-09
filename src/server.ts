import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { migrateToLatest } from './db/migrate.js';

const config = loadConfig();
const { db } = createDatabase(config);

if (config.autoMigrate) {
	const ran = await migrateToLatest(db);
	if (ran.length) {
		console.log(`Applied migrations: ${ran.join(', ')}`);
	}
}

const app = await buildApp({ config, db });

let closing = false;
async function shutdown(signal: string): Promise<void> {
	if (closing) return;
	closing = true;
	app.log.info({ signal }, 'shutting down');
	await app.close();
	await db.destroy();
	process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
	await app.listen({ host: config.host, port: config.port });
} catch (error) {
	app.log.error({ err: error }, 'failed to start');
	await db.destroy();
	process.exit(1);
}
