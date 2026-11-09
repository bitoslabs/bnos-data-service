import type { Kysely } from 'kysely';
import type { SignedEvent } from '../domain/nostr.js';
import type { Database } from './types.js';

export interface EventRowInput {
	event: SignedEvent;
	workspaceId: string;
	locationId: string | null;
	dTag: string | null;
	address: string | null;
	visibility: string | null;
	encrypted: boolean;
	envelopeScheme: string | null;
	envelopeKid: string | null;
	contentBytes: number;
}

export interface InsertEventsResult {
	accepted: string[];
	duplicates: string[];
}

/**
 * Insert events idempotently. Rows that already exist are reported as
 * duplicates so the client can acknowledge and remove them.
 */
export async function insertEvents(
	db: Kysely<Database>,
	rows: readonly EventRowInput[]
): Promise<InsertEventsResult> {
	if (!rows.length) return { accepted: [], duplicates: [] };

	const inserted = await db
		.insertInto('events')
		.values(
			rows.map((row) => ({
				id: row.event.id,
				pubkey: row.event.pubkey,
				kind: row.event.kind,
				created_at: row.event.created_at,
				workspace_id: row.workspaceId,
				location_id: row.locationId,
				d_tag: row.dTag,
				address: row.address,
				visibility: row.visibility,
				encrypted: row.encrypted,
				envelope_scheme: row.envelopeScheme,
				envelope_kid: row.envelopeKid,
				content_bytes: row.contentBytes,
				raw_event: row.event
			}))
		)
		.onConflict((oc) => oc.column('id').doNothing())
		.returning('id')
		.execute();

	const accepted = inserted.map((row) => row.id);
	const acceptedSet = new Set(accepted);
	const duplicates = rows.map((row) => row.event.id).filter((id) => !acceptedSet.has(id));
	return { accepted, duplicates };
}

export async function countEvents(
	db: Kysely<Database>,
	workspaceId: string
): Promise<number> {
	const row = await db
		.selectFrom('events')
		.select((eb) => eb.fn.countAll<number>().as('count'))
		.where('workspace_id', '=', workspaceId)
		.executeTakeFirst();
	return Number(row?.count ?? 0);
}
