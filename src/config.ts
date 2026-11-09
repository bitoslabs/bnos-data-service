/**
 * Environment configuration.
 *
 * Parsing is deliberately explicit: invalid configuration fails at boot rather
 * than producing a half-working service. Secrets are never logged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type DeploymentMode = 'self-hosted' | 'cloud';

export interface Config {
	readonly nodeEnv: 'development' | 'test' | 'production';
	readonly host: string;
	readonly port: number;
	/** Empty string means the service is mounted at the root. */
	readonly basePath: string;
	readonly deploymentMode: DeploymentMode;

	readonly databaseUrl: string;
	readonly databasePoolMax: number;
	readonly databaseStatementTimeoutMs: number;
	readonly autoMigrate: boolean;

	readonly serviceId: string;
	readonly serviceName: string;
	/** Public base URL including any path prefix, no trailing slash. */
	readonly audience: string;
	readonly corsOrigins: string[];

	readonly accessTokenTtlSeconds: number;
	readonly refreshTokenTtlSeconds: number;
	readonly challengeTtlSeconds: number;
	readonly inviteTtlSeconds: number;

	readonly maxEventBytes: number;
	readonly maxBatchSize: number;
	readonly maxBodyBytes: number;
	readonly maxClockSkewSeconds: number;

	readonly rateLimitMax: number;
	readonly rateLimitWindow: string;
	readonly authRateLimitMax: number;
	readonly authRateLimitWindow: string;

	readonly requireEncryptedContent: boolean;
	readonly allowPlaintextContent: boolean;
	readonly enableReporting: boolean;
	readonly enableRelayIndexer: boolean;
	readonly enableServerDecryption: boolean;
	readonly logLevel: string;

	readonly relayBatchSize: number;
	readonly relayPollIntervalMs: number;
	readonly relayMaxWaitMs: number;
	readonly relayMaxRounds: number;

	readonly reportMaxRangeDays: number;
	readonly reportMaxBuckets: number;
}

type Env = Record<string, string | undefined>;

/**
 * Parse a minimal `.env` file: KEY=value, optional quotes, `export ` prefix,
 * and full-line or trailing `#` comments. Values are not interpolated.
 */
export function parseEnvFile(contents: string): Record<string, string> {
	const values: Record<string, string> = {};

	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
		const separator = withoutExport.indexOf('=');
		if (separator <= 0) continue;

		const key = withoutExport.slice(0, separator).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = withoutExport.slice(separator + 1).trim();
		const quoted =
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"));

		if (quoted) {
			value = value.slice(1, -1);
		} else {
			const comment = value.search(/\s#/);
			if (comment >= 0) value = value.slice(0, comment).trim();
		}

		values[key] = value;
	}

	return values;
}

let dotEnvLoaded = false;

/** Load `.env` from the working directory without overriding real env vars. */
export function loadDotEnv(path = resolve(process.cwd(), '.env')): void {
	if (dotEnvLoaded || !existsSync(path)) return;
	dotEnvLoaded = true;

	let contents: string;
	try {
		contents = readFileSync(path, 'utf8');
	} catch {
		return;
	}

	for (const [key, value] of Object.entries(parseEnvFile(contents))) {
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

function required(env: Env, name: string): string {
	const value = env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable ${name}`);
	return value;
}

function optional(env: Env, name: string, fallback: string): string {
	const value = env[name]?.trim();
	return value ? value : fallback;
}

function int(env: Env, name: string, fallback: number, min = 0): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min) {
		throw new Error(`${name} must be an integer >= ${min}`);
	}
	return value;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
	const raw = env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (TRUE.has(raw)) return true;
	if (FALSE.has(raw)) return false;
	throw new Error(`${name} must be a boolean`);
}

function list(env: Env, name: string): string[] {
	return optional(env, name, '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

function normalizeBasePath(raw: string): string {
	const value = raw.trim();
	if (!value || value === '/') return '';
	const withLeading = value.startsWith('/') ? value : `/${value}`;
	return withLeading.replace(/\/+$/, '');
}

function normalizeAudience(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('SERVICE_AUDIENCE must be an absolute http(s) URL');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('SERVICE_AUDIENCE must use http or https');
	}
	if (url.search || url.hash || url.username || url.password) {
		throw new Error('SERVICE_AUDIENCE must not contain credentials, query, or fragment');
	}
	return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

function nodeEnv(env: Env): Config['nodeEnv'] {
	const value = optional(env, 'NODE_ENV', 'development');
	if (value === 'development' || value === 'test' || value === 'production') return value;
	throw new Error('NODE_ENV must be development, test, or production');
}

function deploymentMode(env: Env): DeploymentMode {
	const value = optional(env, 'DEPLOYMENT_MODE', 'self-hosted');
	if (value === 'self-hosted' || value === 'cloud') return value;
	throw new Error('DEPLOYMENT_MODE must be self-hosted or cloud');
}

export function loadConfig(env: Env = process.env): Config {
	if (env === process.env) loadDotEnv();
	const host = optional(env, 'HOST', '127.0.0.1');
	const port = int(env, 'PORT', 8080, 1);
	const mode = nodeEnv(env);
	const audienceDefault = `http://${host}:${port}`;

	const enableServerDecryption = bool(env, 'ENABLE_SERVER_DECRYPTION', false);
	if (enableServerDecryption) {
		throw new Error('ENABLE_SERVER_DECRYPTION is not supported in v1');
	}

	return {
		nodeEnv: mode,
		host,
		port,
		basePath: normalizeBasePath(optional(env, 'BASE_PATH', '')),
		deploymentMode: deploymentMode(env),

		databaseUrl: required(env, 'DATABASE_URL'),
		databasePoolMax: int(env, 'DATABASE_POOL_MAX', 10, 1),
		databaseStatementTimeoutMs: int(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 1_000),
		autoMigrate: bool(env, 'AUTO_MIGRATE', mode !== 'production'),

		serviceId: optional(env, 'SERVICE_ID', 'bnos-data-service'),
		serviceName: optional(env, 'SERVICE_NAME', 'BNOS Data Service'),
		audience: normalizeAudience(optional(env, 'SERVICE_AUDIENCE', audienceDefault)),
		corsOrigins: list(env, 'CORS_ORIGINS'),

		accessTokenTtlSeconds: int(env, 'ACCESS_TOKEN_TTL_SECONDS', 900, 60),
		refreshTokenTtlSeconds: int(env, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000, 3_600),
		challengeTtlSeconds: int(env, 'CHALLENGE_TTL_SECONDS', 300, 30),
		inviteTtlSeconds: int(env, 'INVITE_TTL_SECONDS', 86_400, 60),

		maxEventBytes: int(env, 'MAX_EVENT_BYTES', 524_288, 1_024),
		maxBatchSize: int(env, 'MAX_BATCH_SIZE', 100, 1),
		maxBodyBytes: int(env, 'MAX_BODY_BYTES', 2_097_152, 1_024),
		maxClockSkewSeconds: int(env, 'MAX_EVENT_CLOCK_SKEW_SECONDS', 900, 0),

		rateLimitMax: int(env, 'RATE_LIMIT_MAX', 120, 1),
		rateLimitWindow: optional(env, 'RATE_LIMIT_WINDOW', '1 minute'),
		authRateLimitMax: int(env, 'AUTH_RATE_LIMIT_MAX', 20, 1),
		authRateLimitWindow: optional(env, 'AUTH_RATE_LIMIT_WINDOW', '1 minute'),

		requireEncryptedContent: bool(env, 'REQUIRE_ENCRYPTED_CONTENT', true),
		allowPlaintextContent: bool(env, 'ALLOW_PLAINTEXT_CONTENT', false),
		enableReporting: bool(env, 'ENABLE_REPORTING', true),
		enableRelayIndexer: bool(env, 'ENABLE_RELAY_INDEXER', false),
		enableServerDecryption: false,
		logLevel: optional(env, 'LOG_LEVEL', mode === 'test' ? 'silent' : 'info'),

		relayBatchSize: Math.min(int(env, 'RELAY_BATCH_SIZE', 200, 1), 500),
		relayPollIntervalMs: int(env, 'RELAY_POLL_INTERVAL_MS', 30_000, 1_000),
		relayMaxWaitMs: int(env, 'RELAY_MAX_WAIT_MS', 8_000, 1_000),
		relayMaxRounds: int(env, 'RELAY_MAX_ROUNDS', 50, 1),

		reportMaxRangeDays: int(env, 'REPORT_MAX_RANGE_DAYS', 400, 1),
		reportMaxBuckets: int(env, 'REPORT_MAX_BUCKETS', 2_000, 1)
	};
}
