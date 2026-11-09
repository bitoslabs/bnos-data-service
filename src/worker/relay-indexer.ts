/**
 * Relay backfill worker.
 *
 * Pulls events from configured relays into the same verified ingest pipeline.
 * Cursors advance only after durable persistence. Every event must be authored
 * by a current workspace member, so a public `organization` tag alone cannot
 * inject data into another tenant.
 */
import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { ingestEvents, type IngestResult } from '../services/ingest.js';
import {
	advanceRelayCursor,
	listEnabledRelaySubscriptions,
	recordRelayError,
	type RelaySubscriptionRow
} from '../db/relays.js';
import { listActiveMemberPubkeys } from '../db/workspaces.js';
import {
	buildBatchFilter,
	eventMatchesWorkspace,
	nextCursor,
	parseRelayFilter
} from '../domain/relay.js';
import type { SignedEvent } from '../domain/nostr.js';

export interface Logger {
	info(detail: Record<string, unknown>, message: string): void;
	error(detail: Record<string, unknown>, message: string): void;
}

export type RelayQuery = (
	relayUrl: string,
	filter: Record<string, unknown>,
	options: { maxWaitMs: number }
) => Promise<SignedEvent[]>;

export interface RelayIndexerDeps {
	readonly db: Kysely<Database>;
	readonly config: Config;
	readonly clock: () => Date;
	readonly logger: Logger;
	readonly signal?: AbortSignal;
	readonly query?: RelayQuery;
}

export interface SyncSummary extends IngestResult {
	rounds: number;
	skipped: number;
}

function defaultQuery(pool: SimplePool): RelayQuery {
	return async (relayUrl, filter, options) => {
		const events = await pool.querySync([relayUrl], filter as Filter, {
			maxWait: options.maxWaitMs
		});
		return events as SignedEvent[];
	};
}

function emptySummary(): SyncSummary {
	return { accepted: [], duplicates: [], rejected: [], rounds: 0, skipped: 0 };
}

/**
 * Backfill one subscription until caught up, the batch cap is reached, or the
 * worker is aborted. Exported for testing with an injected query function.
 */
export async function syncRelaySubscription(
	deps: RelayIndexerDeps,
	subscription: RelaySubscriptionRow
): Promise<SyncSummary> {
	const summary = emptySummary();

	let filter: Record<string, unknown>;
	try {
		filter = parseRelayFilter(subscription.filter);
	} catch (error) {
		await recordRelayError(
			deps.db,
			subscription.id,
			error instanceof Error ? error.message : 'invalid-filter',
			deps.clock()
		);
		deps.logger.error({ subscriptionId: subscription.id }, 'invalid relay filter');
		return summary;
	}

	const allowedAuthors = new Set(
		await listActiveMemberPubkeys(deps.db, subscription.workspace_id)
	);
	if (!allowedAuthors.size) {
		deps.logger.info(
			{ subscriptionId: subscription.id },
			'no active members; skipping relay subscription'
		);
		return summary;
	}

	const query = deps.query;
	if (!query) throw new Error('relay query function is required');
	let cursor = subscription.since;

	try {
		for (let round = 0; round < deps.config.relayMaxRounds; round++) {
			if (deps.signal?.aborted) break;
			summary.rounds = round + 1;

			const batchFilter = buildBatchFilter(
				filter,
				cursor,
				deps.config.relayBatchSize
			);
			const events = await query(subscription.relay_url, batchFilter, {
				maxWaitMs: deps.config.relayMaxWaitMs
			});
			if (!events.length) break;

			const forWorkspace = events.filter((event) =>
				eventMatchesWorkspace(event, subscription.workspace_id, allowedAuthors)
			);
			summary.skipped += events.length - forWorkspace.length;

			let roundAccepted = 0;
			if (forWorkspace.length) {
				const result = await ingestEvents(
					{ db: deps.db, config: deps.config },
					subscription.workspace_id,
					forWorkspace,
					deps.clock(),
					{ allowedAuthors }
				);
				summary.accepted.push(...result.accepted);
				summary.duplicates.push(...result.duplicates);
				summary.rejected.push(...result.rejected);
				roundAccepted = result.accepted.length;
			}

			const advanced = nextCursor(events, cursor);
			await advanceRelayCursor(deps.db, subscription.id, advanced, deps.clock());

			const noProgress = advanced <= cursor && roundAccepted === 0;
			cursor = advanced;
			if (noProgress) break;
			if (events.length < deps.config.relayBatchSize) break;
		}
	} catch (error) {
		await recordRelayError(
			deps.db,
			subscription.id,
			error instanceof Error ? error.message : 'relay-error',
			deps.clock()
		);
		deps.logger.error(
			{ subscriptionId: subscription.id, err: error },
			'relay backfill failed'
		);
	}

	return summary;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const done = (): void => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener('abort', done, { once: true });
	});
}

/** Poll all enabled subscriptions forever until the signal aborts. */
export async function runRelayIndexer(deps: RelayIndexerDeps): Promise<void> {
	const pool = new SimplePool();
	const query = deps.query ?? defaultQuery(pool);

	try {
		while (!deps.signal?.aborted) {
			const subscriptions = await listEnabledRelaySubscriptions(deps.db);

			for (const subscription of subscriptions) {
				if (deps.signal?.aborted) break;
				const summary = await syncRelaySubscription({ ...deps, query }, subscription);
				if (summary.accepted.length || summary.skipped || summary.rejected.length) {
					deps.logger.info(
						{
							subscriptionId: subscription.id,
							workspaceId: subscription.workspace_id,
							accepted: summary.accepted.length,
							duplicates: summary.duplicates.length,
							rejected: summary.rejected.length,
							skipped: summary.skipped,
							rounds: summary.rounds
						},
						'relay backfill'
					);
				}
			}

			await sleep(deps.config.relayPollIntervalMs, deps.signal);
		}
	} finally {
		pool.destroy();
	}
}
