# Roadmap

Delivery is phased so the service becomes useful to existing clients as early as
possible. Phases 0–2 complete the v1 client contract; everything after that adds
relay backfill and reporting.

Guiding rule: **never break the local-first client.** The service is optional and
must not become a checkout dependency.

## Phase 0 — Foundation

Goal: a bootable, observable Fastify service with a database.

- [x] Package scaffold: TypeScript strict, ESM, Node 22, `pnpm`.
- [x] Fastify app factory (`buildApp`) separate from process entry.
- [x] Config module with fail-fast environment validation.
- [x] PostgreSQL pool + Kysely instance.
- [x] Migration runner and first migration (tenancy/auth/event tables).
- [x] `GET /healthz` and `GET /readyz`.
- [x] Structured logging with secret redaction.
- [x] `@fastify/helmet`, CORS allowlist, body limits.
- [x] `GET /v1/capabilities` returning `protocol: 1`.
- [x] Multi-stage Dockerfile and `docker compose`.
- [ ] Vitest setup with a real PostgreSQL via testcontainers.

Exit criteria:

- Container boots, runs migrations, and serves capabilities over HTTP.
- Health checks pass and a deliberate DB outage flips readiness to failing.

## Phase 1 — Authentication

Goal: a client can connect with a one-time setup code and a signed challenge.

- [x] Admin CLI: create workspace, create invite, revoke member, list workspaces.
- [x] Invite storage: hashed, single-use, TTL, optional pubkey binding.
- [x] `POST /v1/auth/challenge`: validate invite + membership, issue nonce.
- [x] Auth event verification: id, Schnorr signature, `u`, `method`,
      `challenge`, `audience`, `workspace`, timestamp skew.
- [x] `POST /v1/auth/verify`: consume challenge + invite, issue session.
- [x] Opaque access/refresh tokens, hashed at rest, correct Unix-second expiry.
- [x] `POST /v1/auth/refresh`: rotation + reuse detection.
- [x] `POST /v1/auth/logout`: revoke access and refresh.
- [x] Session auth plugin: bearer → workspace + permissions.
- [x] Rate limits on challenge/verify/invite paths.
- [ ] Tests: replay, expiry, wrong audience, wrong workspace, revoked member.

Exit criteria:

- Console connects to a self-hosted instance end to end.
- Replayed or expired challenges fail with `401`.
- Cross-workspace sessions cannot be minted.

## Phase 2 — Backup ingest and status (v1 complete)

Goal: the service is a compatible backend for the existing client.

- [x] `POST /v1/events` with signature verification and kind allowlist.
- [x] Encryption envelope validation matching `queue.ts`.
- [x] Workspace binding from session; reject mismatched `organization` tags.
- [x] Idempotent insert (`on conflict do nothing`) and accepted/duplicates/rejected
      response.
- [x] Batch handling up to 100 events; body and event size caps.
- [x] Update `workspace_backup_state.last_event_received_at`.
- [x] `GET /v1/status` with `connection.serverTime` and nested `backup`.
- [x] `restoreStatus` returns `false`/`null` until a verified restore exists.
- [ ] Integration tests covering the client queue semantics.
- [ ] Load test: sustained ingest with duplicates and retries.

Exit criteria:

- Console shows connected, queue drains to zero, status reflects freshness.
- Duplicate uploads are acknowledged, not duplicated.
- Server rejects plaintext in private mode.

This is the first shippable milestone.

## Phase 3 — Relay backfill/indexer

Goal: reconstruct and mirror history from relays.

- [x] Relay subscription config table and admin workflow.
- [x] Outbound NIP-01 WebSocket client with reconnect/backoff.
- [x] Filters per workspace: kinds, authors, `#organization`, `since` cursor.
- [x] Verify and dedupe into the same ingest pipeline.
- [x] Cursor persistence; relay errors recorded per subscription.
- [ ] Relay lag metric (cursor age / last fetch time).
- [x] Worker process, separately scalable, disabled by default.
- [x] Backpressure and bounded batch writes.
- [ ] Tests against a local relay fixture.

Exit criteria:

- Disabling client push and running the indexer still backfills events.
- Cursor advances only after durable persistence.
- Indexer lag is observable.

## Phase 4 — Reporting

Goal: fast snapshot-based reports.

- [ ] Add `report.snapshot` to `@bitos/bnos-core` (type + kind), publish it.
- [ ] Client produces signed aggregate snapshots (coordinate with client teams).
- [x] `POST /v1/reports/snapshots`: verify, membership, schema, idempotency.
- [x] Rollup job for week/month; deterministic re-runs.
- [x] `GET /v1/reports/summary` with range, granularity, location, currency.
- [x] Snapshot labeling, watermark, gaps (no fabricated completeness).
- [x] Cache/ETag for repeated dashboard queries.
- [x] Report query caps and rate limits.
- [ ] Committed integration tests: cross-tenant isolation, idempotency, rollup correctness, gaps (verified manually with a DB-backed smoke run).

Exit criteria:

- Dashboard summary loads from snapshots without reading raw events.
- Cross-workspace queries are impossible.
- Reports are clearly labeled as snapshots.

## Phase 5 — Plaintext mirror (optional) and decryption research

Goal: searchable public catalog and, separately, evaluate opt-in decryption.

- [ ] Public-event ingest path gated by kind allowlist and explicit flag.
- [ ] Projections for public catalog/marketplace records.
- [ ] Backfill projections from stored events.
- [ ] Design doc for opt-in server decryption: consent, KMS, access, retention,
      deletion, audit, incident response.
- [ ] Security review; no implementation until approved.
- [ ] `ENABLE_SERVER_DECRYPTION` remains `false`.

Exit criteria:

- Public catalog search works for opted-in deployments.
- Decryption design reviewed and either approved with controls or rejected.

## Phase 6 — Cloud operations

Goal: a commercial multi-tenant offering.

- [ ] Plan/entitlement model and quota enforcement that never discards accepted
      events or blocks checkout.
- [ ] Usage metering (`workspace_usage`) and billing integration.
- [ ] Managed PostgreSQL, PgBouncer, read replica topology.
- [ ] Encrypted WAL/object-storage backups and automated restore drills.
- [ ] Centralized logs, metrics, tracing, alerting.
- [ ] Per-tenant rate limits and abuse controls.
- [ ] Data deletion and export workflows with audit evidence.
- [ ] Runbooks: incident, restore, key compromise, tenant offboarding.

Exit criteria:

- Two tenants and multiple branches remain isolated under load.
- Backups restore within the documented objective.
- Quota limits degrade gracefully.

## Cross-cutting work (all phases)

- [ ] Security checklist in [`SECURITY.md`](SECURITY.md) kept green.
- [ ] Protocol compatibility tests mirroring `protocol.ts` parsing rules.
- [ ] Migration tests against a restored database.
- [ ] Documentation kept current with behavior.
- [ ] No secrets in logs, errors, or responses.

## Dependencies and coordination

| Dependency | Owner | Needed by |
| --- | --- | --- |
| Protocol v1 stability | BNOS console + bdGo OS | Phase 2 |
| `report.snapshot` type/kind | `@bitos/bnos-core` + clients | Phase 4 |
| Client snapshot producer | console/bdGo OS | Phase 4 |
| Decryption privacy review | security + product | Phase 5 |
| Cloud infra + billing | operations | Phase 6 |

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Protocol drift | Client cannot connect | Freeze v1; contract tests |
| Reporting expectations vs. encryption | Wrong promise | Ship snapshots + labeling; document limits |
| Relay indexer duplicates | Bad metrics | Strong idempotency; dedupe by event id |
| Snapshot PII | Privacy incident | Strict schema, review, reject unknown keys |
| Cloud quota mistakes | Data loss | Never discard accepted events; soft limits |
| Restore never tested | False assurance | Gate `restoreStatus` on a real drill |

## Definition of done (v1)

- [ ] Self-hosted instance connects a real console workspace.
- [ ] Encrypted events ingest idempotently and are readable back for audit.
- [ ] Status shows backup freshness; restore evidence is honest.
- [ ] Checkout and relay sync work with the service offline.
- [ ] Two workspaces cannot see each other's data.
- [ ] Token/invite/challenge lifecycle resists replay and reuse.
