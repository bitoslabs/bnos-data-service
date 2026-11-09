import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import { up as initial } from './001-init.js';
import { up as relay } from './002-relay.js';
import { up as reports } from './003-reports.js';
import { up as derivedReports } from './004-derived-reports.js';

export interface Migration {
	readonly name: string;
	readonly up: (db: Kysely<Database>) => Promise<void>;
}

export const migrations: readonly Migration[] = [
	{ name: '001-init', up: initial },
	{ name: '002-relay', up: relay },
	{ name: '003-reports', up: reports },
	{ name: '004-derived-reports', up: derivedReports }
];
