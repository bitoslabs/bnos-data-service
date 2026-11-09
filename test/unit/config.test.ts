import { describe, expect, it } from 'vitest';
import { loadConfig, parseEnvFile } from '../../src/config.js';

const base = {
	NODE_ENV: 'test',
	DATABASE_URL: 'postgres://bnos:secret@127.0.0.1:5432/bnos',
	SERVICE_AUDIENCE: 'https://data.example.com'
};

describe('parseEnvFile', () => {
	it('parses keys, quotes, export, and comments', () => {
		expect(
			parseEnvFile(
				[
					'A=1',
					'# comment',
					'B="two words"',
					"export C='three'",
					'D=value # trailing comment',
					'E=',
					'not a key'
				].join('\n')
			)
		).toEqual({ A: '1', B: 'two words', C: 'three', D: 'value', E: '' });
	});
});

describe('loadConfig', () => {
	it('loads defaults', () => {
		const config = loadConfig(base);
		expect(config.audience).toBe('https://data.example.com');
		expect(config.basePath).toBe('');
		expect(config.requireEncryptedContent).toBe(true);
		expect(config.accessTokenTtlSeconds).toBe(900);
	});

	it('normalizes the base path', () => {
		expect(loadConfig({ ...base, BASE_PATH: 'bnos/' }).basePath).toBe('/bnos');
	});

	it('requires a database URL', () => {
		expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL');
	});

	it('refuses server decryption in v1', () => {
		expect(() => loadConfig({ ...base, ENABLE_SERVER_DECRYPTION: 'true' })).toThrow(
			'ENABLE_SERVER_DECRYPTION'
		);
	});

	it('rejects an invalid audience', () => {
		expect(() => loadConfig({ ...base, SERVICE_AUDIENCE: 'not-a-url' })).toThrow(
			'SERVICE_AUDIENCE'
		);
	});
});
