import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from './types.js';

export type { Database } from './types.js';

// pg returns int8 (bigint) as a string by default; event timestamps fit safely.
pg.types.setTypeParser(20, (value) => Number(value));

export interface DatabaseHandle {
	readonly db: Kysely<Database>;
	readonly pool: pg.Pool;
}

export function createDatabase(config: Config): DatabaseHandle {
	const pool = new pg.Pool({
		connectionString: config.databaseUrl,
		max: config.databasePoolMax,
		statement_timeout: config.databaseStatementTimeoutMs
	});
	const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
	return { db, pool };
}

export async function isDatabaseReady(db: Kysely<Database>): Promise<boolean> {
	try {
		await sql`select 1`.execute(db);
		return true;
	} catch {
		return false;
	}
}
