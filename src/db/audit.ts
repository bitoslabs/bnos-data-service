import type { Kysely } from 'kysely';
import type { Database } from './types.js';

export async function recordAudit(
	db: Kysely<Database>,
	input: {
		workspaceId: string | null;
		actorPubkey: string | null;
		action: string;
		detail?: Record<string, unknown>;
	}
): Promise<void> {
	await db
		.insertInto('audit_log')
		.values({
			workspace_id: input.workspaceId,
			actor_pubkey: input.actorPubkey,
			action: input.action,
			detail: input.detail ?? {}
		})
		.execute();
}
