import type { ColumnType, Generated } from 'kysely';
import type { SignedEvent } from '../domain/nostr.js';

export interface BnosMigrationsTable {
	name: string;
	applied_at: Generated<Date>;
}

export interface WorkspacesTable {
	id: string;
	name: string;
	plan: Generated<string>;
	status: Generated<string>;
	created_at: Generated<Date>;
}

export interface WorkspaceMembersTable {
	workspace_id: string;
	pubkey: string;
	role: Generated<string>;
	permissions: ColumnType<string[], string[], string[]>;
	created_at: Generated<Date>;
	revoked_at: Date | null;
}

export interface InvitesTable {
	id: Generated<string>;
	workspace_id: string;
	code_hash: Buffer;
	pubkey: string | null;
	permissions: ColumnType<string[], string[], string[]>;
	created_by: string | null;
	created_at: Generated<Date>;
	expires_at: Date;
	used_at: Date | null;
	used_by: string | null;
}

export interface ChallengesTable {
	id: string;
	nonce: string;
	invite_id: string;
	workspace_id: string;
	pubkey: string;
	audience: string;
	created_at: Generated<Date>;
	expires_at: Date;
	used_at: Date | null;
}

export interface SessionsTable {
	token_hash: Buffer;
	pubkey: string;
	workspace_id: string;
	permissions: ColumnType<string[], string[], string[]>;
	created_at: Generated<Date>;
	expires_at: Date;
	refresh_token_hash: Buffer | null;
	refresh_expires_at: Date | null;
	family_id: string;
	revoked_at: Date | null;
}

export interface EventsTable {
	id: string;
	pubkey: string;
	kind: number;
	created_at: number;
	workspace_id: string;
	location_id: string | null;
	d_tag: string | null;
	address: string | null;
	visibility: string | null;
	encrypted: boolean;
	envelope_scheme: string | null;
	envelope_kid: string | null;
	content_bytes: number;
	raw_event: ColumnType<SignedEvent, SignedEvent, never>;
	received_at: Generated<Date>;
}

export interface WorkspaceBackupStateTable {
	workspace_id: string;
	last_event_received_at: Date | null;
	last_backup_at: Date | null;
	last_verified_restore_at: Date | null;
	state: Generated<string>;
	updated_at: Generated<Date>;
}

export interface ReportSnapshotsTable {
	id: Generated<number>;
	workspace_id: string;
	location_id: string | null;
	source_event_id: string;
	type: string;
	granularity: string;
	period_start: Date;
	period_end: Date;
	currency: string;
	gross_minor: number | null;
	orders_count: number | null;
	payload: ColumnType<unknown, unknown, never>;
	raw_event: ColumnType<SignedEvent | null, SignedEvent | null, never>;
	derived: Generated<boolean>;
	created_at: Generated<Date>;
}

export interface RelaySubscriptionsTable {
	id: Generated<number>;
	workspace_id: string;
	relay_url: string;
	filter: ColumnType<unknown, unknown, never>;
	enabled: Generated<boolean>;
	created_at: Generated<Date>;
}

export interface RelayCursorsTable {
	subscription_id: number;
	since: Generated<number>;
	updated_at: Generated<Date>;
	last_error: string | null;
	last_error_at: Date | null;
}

export interface AuditLogTable {
	id: Generated<number>;
	workspace_id: string | null;
	actor_pubkey: string | null;
	action: string;
	detail: ColumnType<unknown, unknown, never>;
	created_at: Generated<Date>;
}

export interface Database {
	bnos_migrations: BnosMigrationsTable;
	workspaces: WorkspacesTable;
	workspace_members: WorkspaceMembersTable;
	invites: InvitesTable;
	challenges: ChallengesTable;
	sessions: SessionsTable;
	events: EventsTable;
	workspace_backup_state: WorkspaceBackupStateTable;
	report_snapshots: ReportSnapshotsTable;
	relay_subscriptions: RelaySubscriptionsTable;
	relay_cursors: RelayCursorsTable;
	audit_log: AuditLogTable;
}
