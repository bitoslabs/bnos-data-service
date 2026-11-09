/**
 * Ingest pipeline: verify, classify, persist.
 *
 * Ingest is idempotent by event id and never decrypts content. Invalid events
 * are reported per item so the client can keep them queued without failing the
 * whole batch.
 */
import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { insertEvents, type EventRowInput } from '../db/events.js';
import { touchBackupState } from '../db/workspaces.js';
import { checkEncryptionEnvelope } from '../domain/envelope.js';
import { invalidRequest } from '../domain/errors.js';
import { randomHex } from '../domain/hash.js';
import { eventIdOf, getTagValue, verifySignedEvent, type SignedEvent } from '../domain/nostr.js';

export interface IngestResult {
	accepted: string[];
	duplicates: string[];
	rejected: { id: string; reason: string }[];
}

function extractId(value: unknown): string {
	return eventIdOf(value) ?? randomHex(32);
}

function classify(event: SignedEvent): {
	locationId: string | null;
	dTag: string | null;
	address: string | null;
	visibility: string | null;
	organization: string | undefined;
} {
	const dTag = getTagValue(event.tags, 'd') ?? null;
	return {
		locationId: getTagValue(event.tags, 'location') ?? null,
		dTag,
		address: dTag ? `${event.kind}:${event.pubkey}:${dTag}` : null,
		visibility: getTagValue(event.tags, 'visibility') ?? null,
		organization: getTagValue(event.tags, 'organization')
	};
}

export interface IngestOptions {
	/** When set, the event author must be in this set (relay backfill). */
	allowedAuthors?: ReadonlySet<string>;
	/** When true, events without an `organization` tag are rejected. */
	requireOrganization?: boolean;
}

export async function ingestEvents(
	{ db, config }: { db: Kysely<Database>; config: Config },
	workspaceId: string,
	events: readonly unknown[],
	now: Date,
	options: IngestOptions = {}
): Promise<IngestResult> {
	if (events.length > config.maxBatchSize) {
		throw invalidRequest(`Batch exceeds ${config.maxBatchSize} events`);
	}

	const nowSeconds = Math.floor(now.getTime() / 1000);
	const rows: EventRowInput[] = [];
	const rejected: IngestResult['rejected'] = [];
	const mustEncrypt = config.requireEncryptedContent && !config.allowPlaintextContent;

	for (const raw of events) {
		const id = extractId(raw);
		const verification = verifySignedEvent(raw, {
			now: nowSeconds,
			maxClockSkewSeconds: config.maxClockSkewSeconds
		});
		if (!verification.ok) {
			rejected.push({ id, reason: verification.reason });
			continue;
		}

		const event = verification.event;
		const contentBytes = Buffer.byteLength(event.content, 'utf8');
		if (contentBytes > config.maxEventBytes) {
			rejected.push({ id, reason: 'event-too-large' });
			continue;
		}

		const parts = classify(event);
		if (options.allowedAuthors && !options.allowedAuthors.has(event.pubkey)) {
			rejected.push({ id, reason: 'author-not-authorized' });
			continue;
		}
		if (parts.organization && parts.organization !== workspaceId) {
			rejected.push({ id, reason: 'workspace-mismatch' });
			continue;
		}
		if (!parts.organization && options.requireOrganization) {
			rejected.push({ id, reason: 'workspace-mismatch' });
			continue;
		}

		const envelope = checkEncryptionEnvelope(event.content);
		if (!envelope.ok && mustEncrypt) {
			rejected.push({ id, reason: envelope.reason });
			continue;
		}

		rows.push({
			event,
			workspaceId,
			locationId: parts.locationId,
			dTag: parts.dTag,
			address: parts.address,
			visibility: parts.visibility,
			encrypted: envelope.ok,
			envelopeScheme: envelope.ok ? envelope.scheme : null,
			envelopeKid: envelope.ok ? envelope.kid : null,
			contentBytes
		});
	}

	const inserted = await insertEvents(db, rows);
	if (inserted.accepted.length || inserted.duplicates.length) {
		await touchBackupState(db, workspaceId, now);
	}

	return {
		accepted: inserted.accepted,
		duplicates: inserted.duplicates,
		rejected
	};
}
