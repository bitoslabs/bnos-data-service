/**
 * Admin CLI: workspace and invite bootstrap.
 *
 * Run with elevated database credentials. Admin actions are intentionally not
 * exposed over HTTP in v1.
 */
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { createInvite } from '../db/invites.js';
import {
	createWorkspace,
	findWorkspace,
	listWorkspaces,
	markRestoreVerified,
	revokeMember,
	upsertMember
} from '../db/workspaces.js';
import {
	createRelaySubscription,
	disableRelaySubscription,
	listRelaySubscriptions
} from '../db/relays.js';
import { hashSecret, isHex, randomHex, randomToken } from '../domain/hash.js';
import { normalizeRelayUrl, parseRelayFilter } from '../domain/relay.js';
import { DEFAULT_PERMISSIONS } from '../services/auth.js';
import { runRollups } from '../services/rollups.js';

const DEFAULT_RELAY_KINDS = [
	30_078, 30_100, 30_101, 30_102, 30_103, 30_200, 30_201, 30_202, 30_300,
	30_400, 30_500, 30_520, 30_521, 30_600, 30_970
];

const argv = process.argv.slice(2);
const command = argv[0];

function arg(name: string): string | undefined {
	const index = argv.indexOf(`--${name}`);
	if (index < 0) return undefined;
	const value = argv[index + 1];
	return value && !value.startsWith('--') ? value : undefined;
}

function has(name: string): boolean {
	return argv.includes(`--${name}`);
}

function requireArg(name: string): string {
	const value = arg(name)?.trim();
	if (!value) throw new Error(`Missing --${name}`);
	return value;
}

function pubkeyArg(): string | undefined {
	const value = arg('pubkey')?.trim();
	if (!value) return undefined;
	if (!isHex(value, 64)) throw new Error('--pubkey must be 64 hex characters');
	return value.toLowerCase();
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._~-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

function usage(): void {
	console.log(`Usage:
  admin create-workspace --name <name> [--id <id>] [--pubkey <hex>] [--plan <plan>]
  admin create-invite --workspace <id> [--pubkey <hex>] [--ttl <seconds>] [--permissions a,b]
  admin list-workspaces
  admin revoke-member --workspace <id> --pubkey <hex>
  admin restore-drill --workspace <id> --verified
  admin add-relay --workspace <id> --url <wss://...> [--filter '<json>'] [--since <unix>]
  admin list-relays [--workspace <id>]
  admin disable-relay --id <id>
  admin rollup --granularity week|month [--workspace <id>] [--from <unix>] [--to <unix>]`);
}

async function main(): Promise<void> {
	if (!command || command === 'help' || has('help')) {
		usage();
		return;
	}

	const config = loadConfig();
	const { db } = createDatabase(config);

	try {
		switch (command) {
			case 'create-workspace': {
				const name = requireArg('name');
				const id = arg('id')?.trim() || `${slug(name) || 'workspace'}-${randomHex(4)}`;
				const plan = arg('plan')?.trim() || 'self-hosted';
				const pubkey = pubkeyArg();

				await createWorkspace(db, { id, name, plan });
				if (pubkey) {
					await upsertMember(db, {
						workspaceId: id,
						pubkey,
						role: 'owner',
						permissions: [...DEFAULT_PERMISSIONS]
					});
				}
				console.log(JSON.stringify({ id, name, plan, owner: pubkey ?? null }, null, 2));
				return;
			}

			case 'create-invite': {
				const workspaceId = requireArg('workspace');
				const workspace = await findWorkspace(db, workspaceId);
				if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

				const ttl = Number(arg('ttl') ?? config.inviteTtlSeconds);
				if (!Number.isInteger(ttl) || ttl < 60) throw new Error('--ttl must be >= 60 seconds');

				const pubkey = pubkeyArg();
				const permissions = arg('permissions')
					?.split(',')
					.map((value) => value.trim())
					.filter(Boolean);

				const code = randomToken(32);
				const expiresAt = new Date(Date.now() + ttl * 1000);
				const invite = await createInvite(db, {
					workspaceId,
					codeHash: hashSecret(code),
					pubkey: pubkey ?? null,
					permissions: permissions?.length ? permissions : [...DEFAULT_PERMISSIONS],
					expiresAt
				});

				console.log(
					JSON.stringify(
						{
							inviteId: invite.id,
							workspaceId,
							code,
							expiresAt: expiresAt.toISOString(),
							pubkey: pubkey ?? null
						},
						null,
						2
					)
				);
				return;
			}

			case 'list-workspaces': {
				console.log(JSON.stringify(await listWorkspaces(db), null, 2));
				return;
			}

			case 'revoke-member': {
				const workspaceId = requireArg('workspace');
				const pubkey = requireArg('pubkey');
				if (!isHex(pubkey, 64)) throw new Error('--pubkey must be 64 hex characters');
				await revokeMember(db, workspaceId, pubkey.toLowerCase(), new Date());
				console.log(`Revoked ${pubkey} from ${workspaceId}`);
				return;
			}

			case 'restore-drill': {
				const workspaceId = requireArg('workspace');
				if (!has('verified')) {
					throw new Error('Refusing to mark a restore verified without --verified');
				}
				await markRestoreVerified(db, workspaceId, new Date());
				console.log(`Marked restore verified for ${workspaceId}`);
				return;
			}

			case 'add-relay': {
				const workspaceId = requireArg('workspace');
				const workspace = await findWorkspace(db, workspaceId);
				if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

				const relayUrl = normalizeRelayUrl(requireArg('url'));
				const since = Number(arg('since') ?? 0);
				if (!Number.isInteger(since) || since < 0) {
					throw new Error('--since must be a non-negative Unix timestamp');
				}

				let filter;
				const rawFilter = arg('filter');
				if (rawFilter) {
					let parsed: unknown;
					try {
						parsed = JSON.parse(rawFilter);
					} catch {
						throw new Error('--filter must be valid JSON');
					}
					filter = parseRelayFilter(parsed);
				} else {
					filter = { kinds: DEFAULT_RELAY_KINDS, '#organization': [workspaceId] };
				}

				const id = await createRelaySubscription(db, {
					workspaceId,
					relayUrl,
					filter,
					since
				});
				console.log(JSON.stringify({ id, workspaceId, relayUrl, filter, since }, null, 2));
				return;
			}

			case 'list-relays': {
				console.log(
					JSON.stringify(await listRelaySubscriptions(db, arg('workspace')), null, 2)
				);
				return;
			}

			case 'disable-relay': {
				const id = Number(requireArg('id'));
				if (!Number.isInteger(id) || id < 1) throw new Error('--id must be a positive integer');
				await disableRelaySubscription(db, id);
				console.log(`Disabled relay subscription ${id}`);
				return;
			}

			case 'rollup': {
				const granularity = requireArg('granularity');
				if (granularity !== 'week' && granularity !== 'month') {
					throw new Error('--granularity must be week or month');
				}
				const workspaceId = arg('workspace');
				if (workspaceId && !(await findWorkspace(db, workspaceId))) {
					throw new Error(`Workspace not found: ${workspaceId}`);
				}
				const from = arg('from') ? Number(arg('from')) : undefined;
				const to = arg('to') ? Number(arg('to')) : undefined;
				if (from !== undefined && (!Number.isInteger(from) || from < 0)) {
					throw new Error('--from must be a non-negative Unix timestamp');
				}
				if (to !== undefined && (!Number.isInteger(to) || to < 0)) {
					throw new Error('--to must be a non-negative Unix timestamp');
				}
				const result = await runRollups(
					{ db, now: new Date() },
					{ granularity, workspaceId, from, to }
				);
				console.log(JSON.stringify(result, null, 2));
				return;
			}

			default:
				usage();
				process.exitCode = 1;
		}
	} finally {
		await db.destroy();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
