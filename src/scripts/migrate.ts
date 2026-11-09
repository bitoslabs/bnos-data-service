import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { migrateToLatest } from '../db/migrate.js';

const config = loadConfig();
const { db } = createDatabase(config);

try {
	const ran = await migrateToLatest(db);
	console.log(ran.length ? `Applied migrations: ${ran.join(', ')}` : 'No pending migrations');
} finally {
	await db.destroy();
}
