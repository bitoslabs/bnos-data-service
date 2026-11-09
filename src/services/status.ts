import type { Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import { getBackupState } from '../db/workspaces.js';
import type { SessionContext } from './auth.js';

export interface StatusResponse {
	workspace: { id: string; name: string } | null;
	connection: { serverTime: number };
	backup: {
		lastBackupAt: number | null;
		lastVerifiedRestoreAt: number | null;
		state: 'unknown' | 'current' | 'stale' | 'failed';
	};
}

function unix(date: Date | null): number | null {
	return date ? Math.floor(date.getTime() / 1000) : null;
}

function backupState(value: string | undefined): StatusResponse['backup']['state'] {
	if (value === 'current' || value === 'stale' || value === 'failed') return value;
	return 'unknown';
}

export async function getStatus(
	db: Kysely<Database>,
	session: SessionContext,
	now: Date
): Promise<StatusResponse> {
	const state = await getBackupState(db, session.workspaceId);
	return {
		workspace: { id: session.workspaceId, name: session.workspaceName },
		connection: { serverTime: Math.floor(now.getTime() / 1000) },
		backup: {
			lastBackupAt: unix(state?.last_backup_at ?? state?.last_event_received_at ?? null),
			lastVerifiedRestoreAt: unix(state?.last_verified_restore_at ?? null),
			state: backupState(state?.state)
		}
	};
}
