# AGENTS.md

Guidance for coding agents working on `bnos-data-service`.

## What this app is

Backend service for the BNOS stack: encrypted event backup, fast snapshot
reporting, and relay backfill into PostgreSQL for the `bnos-svelte` console and
bdGo OS. It is **optional** — checkout, local reads, and relay sync must keep
working when this service is offline.

Read [`README.md`](README.md) and the relevant file in [`docs/`](docs) before
non-trivial changes. The protocol is a contract; see `docs/PROTOCOL.md`.

## Golden rules

1. **Implement protocol v1 exactly.** The client is already built against it in
   `../bnos-svelte/src/lib/data-service/`. Do not change paths, field names, or
   units (timestamps are Unix seconds; money is integer minor units).
2. **Never require the service for a transaction.** It is a background
   destination, never a checkout dependency.
3. **The server holds ciphertext, not business plaintext.** Private event content
   is an AES-256-GCM envelope. Do not add a decryption path unless explicitly
   scoped, reviewed, and gated behind `ENABLE_SERVER_DECRYPTION=false`.
4. **Tenant scope comes from the session.** Never trust `workspaceId`,
   `organization`, or `location` from a request body or event tag for
   authorization.
5. **Verify every event.** Canonical id, Schnorr signature, kind allowlist,
   envelope shape, size and clock bounds. Ingest is idempotent by event id.
6. **Store secrets hashed.** Tokens and invite codes are random opaque values;
   store only SHA-256 hashes. Redact them from logs.
7. **Keep it lightweight.** One service, one PostgreSQL. No Redis, Kafka,
   microservices, GraphQL, Prisma, or added frameworks without a decision record.
8. **Honest reporting.** Reports are labeled snapshots with a watermark. Missing
   periods are gaps. Never imply completeness or verified restore without evidence.
9. **Clean code, one responsibility.** Follow [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).
   Every module, file, and function has one reason to change. Routes validate and
   delegate; domain logic stays pure; persistence stays in `db/`; no SQL or HTTP
   types leak into `domain/`. Split anything whose name needs "and", avoid flag
   parameters, early-return instead of deep nesting, and never create a
   `utils.ts`/`helpers.ts` dumping ground.

## Where things live

| Area | Path |
| --- | --- |
| HTTP app factory and entry | `src/app.ts`, `src/server.ts` |
| Config validation | `src/config.ts` |
| Fastify plugins (db, auth, errors, limits) | `src/plugins/` |
| Routes (capabilities, auth, events, status, reports) | `src/routes/` |
| Nostr verification, envelope and GLO helpers | `src/domain/` |
| Kysely types and migrations | `src/db/` |
| Ingest pipeline and projections | `src/ingest/` |
| Snapshot storage, rollups, queries | `src/reports/` |
| Relay indexer and scheduler | `src/worker/` |
| Admin CLI | `src/admin/cli.ts` |
| Tests | `test/` |
| Docs | `docs/` |

## Commands

The app is a pnpm package. Run from this folder:

```sh
pnpm install
pnpm dev            # start with watch
pnpm build          # tsc build
pnpm start          # run built server
pnpm migrate        # run forward-only migrations
pnpm worker         # run the relay backfill worker
pnpm test           # vitest (unit + integration)
pnpm test:unit      # unit only
pnpm lint           # tsc --noEmit + prettier/eslint if configured
```

Integration tests need a real PostgreSQL; use testcontainers or
`DATABASE_URL` pointing at a disposable database. Never run tests against
production data.

## Conventions

- TypeScript strict, ESM, Node.js 22 LTS.
- Fastify 5 with TypeBox schemas for request/response validation.
- Kysely for queries; parameterized SQL only. No string-concatenated SQL.
- Tabs for indentation; single quotes; print width 100 (match sibling apps).
- Keep business logic out of route handlers: routes validate and delegate to
  `ingest/`, `reports/`, `domain/`.
- **SRP and clean code** are enforced, not advisory: one purpose per unit, pure
  `domain/`, persistence in `db/`, injected clock/ids, small functions, early
  returns, explicit return types on exports. See
  [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for rules and examples.
- Tests co-located or under `test/`; every security rule in
  `docs/SECURITY.md` needs a test. One behavior per test.
- Migrations are forward-only and reviewable; never edit a shipped migration.

## Gotchas

- Timestamps in the protocol are **Unix seconds**; database operational columns
  use `timestamptz`, while `events.created_at` stays `bigint`.
- The client rejects redirects and non-JSON responses; do not add redirects.
- The client maps `401` to unauthorized and `403` to forbidden; use them
  precisely.
- The client acknowledges both `accepted` and `duplicates`; use `rejected` only
  for non-retryable invalid events. Retryable failures must be `5xx`.
- `restoreStatus` must be advertised only after a real restore drill.
- Base URL may include a path prefix; preserve it (`BASE_PATH` or proxy strip).
- Do not publish report snapshots to relays; they are sent to the service only.

## Before finishing

- Run the type check, tests, and lint.
- Confirm the security checklist in `docs/SECURITY.md` still holds.
- Walk the SRP/clean-code review checklist in `docs/CONVENTIONS.md`.
- Update docs and `docs/ROADMAP.md` checkboxes when behavior changes.
