import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';
import { migrations } from './migrations/index.js';

/**
 * Small forward-only migration runner.
 *
 * A dedicated migrations table makes this safe to run on every boot; shipped
 * migrations are never edited.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
	await db.schema
		.createTable('bnos_migrations')
		.ifNotExists()
		.addColumn('name', 'text', (col) => col.primaryKey())
		.addColumn('applied_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	const rows = await db.selectFrom('bnos_migrations').select('name').execute();
	const applied = new Set(rows.map((row) => row.name));
	const ran: string[] = [];

	for (const migration of migrations) {
		if (applied.has(migration.name)) continue;
		await db.transaction().execute(async (trx) => {
			await migration.up(trx);
			await trx
				.insertInto('bnos_migrations')
				.values({ name: migration.name })
				.execute();
		});
		ran.push(migration.name);
	}

	return ran;
}
