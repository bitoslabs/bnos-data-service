import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

export interface RelaySubscriptionRow {
	id: number;
	workspace_id: string;
	relay_url: string;
	filter: unknown;
	enabled: boolean;
	since: number;
}

export async function createRelaySubscription(
	db: Kysely<Database>,
	input: {
		workspaceId: string;
		relayUrl: string;
		filter: Record<string, unknown>;
		since?: number;
	}
): Promise<number> {
	return db.transaction().execute(async (trx) => {
		const subscription = await trx
			.insertInto('relay_subscriptions')
			.values({
				workspace_id: input.workspaceId,
				relay_url: input.relayUrl,
				filter: input.filter
			})
			.returning('id')
			.executeTakeFirstOrThrow();

		await trx
			.insertInto('relay_cursors')
			.values({ subscription_id: subscription.id, since: input.since ?? 0 })
			.execute();

		return subscription.id;
	});
}

const SELECT_WITH_CURSOR = sql<RelaySubscriptionRow>`
	select
		s.id,
		s.workspace_id,
		s.relay_url,
		s.filter,
		s.enabled,
		coalesce(c.since, 0) as since
	from relay_subscriptions s
	left join relay_cursors c on c.subscription_id = s.id
`;

export async function listRelaySubscriptions(
	db: Kysely<Database>,
	workspaceId?: string
): Promise<RelaySubscriptionRow[]> {
	if (workspaceId) {
		const result = await sql<RelaySubscriptionRow>`
			${SELECT_WITH_CURSOR}
			where s.workspace_id = ${workspaceId}
			order by s.id asc
		`.execute(db);
		return result.rows;
	}

	const result = await sql<RelaySubscriptionRow>`
		${SELECT_WITH_CURSOR}
		order by s.id asc
	`.execute(db);
	return result.rows;
}

export async function listEnabledRelaySubscriptions(
	db: Kysely<Database>
): Promise<RelaySubscriptionRow[]> {
	const result = await sql<RelaySubscriptionRow>`
		${SELECT_WITH_CURSOR}
		where s.enabled
		order by s.id asc
	`.execute(db);
	return result.rows;
}

export async function disableRelaySubscription(
	db: Kysely<Database>,
	id: number
): Promise<void> {
	await db.updateTable('relay_subscriptions').set({ enabled: false }).where('id', '=', id).execute();
}

export async function advanceRelayCursor(
	db: Kysely<Database>,
	subscriptionId: number,
	since: number,
	at: Date
): Promise<void> {
	await sql`
		insert into relay_cursors (subscription_id, since, updated_at)
		values (${subscriptionId}, ${since}, ${at})
		on conflict (subscription_id) do update set
			since = greatest(relay_cursors.since, excluded.since),
			updated_at = excluded.updated_at,
			last_error = null,
			last_error_at = null
	`.execute(db);
}

export async function recordRelayError(
	db: Kysely<Database>,
	subscriptionId: number,
	message: string,
	at: Date
): Promise<void> {
	await sql`
		insert into relay_cursors (subscription_id, since, updated_at, last_error, last_error_at)
		values (${subscriptionId}, 0, ${at}, ${message.slice(0, 500)}, ${at})
		on conflict (subscription_id) do update set
			last_error = excluded.last_error,
			last_error_at = excluded.last_error_at,
			updated_at = excluded.updated_at
	`.execute(db);
}
