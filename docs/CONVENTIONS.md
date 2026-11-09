# Code conventions

Clean code is a project rule, not a preference. The primary principle is
**Single Responsibility**: every module, file, class, and function should have
one reason to change. Apply the rest of SOLID where it reduces coupling, but do
not add abstraction for its own sake.

## 1. Single Responsibility Principle (SRP)

A unit of code should do one thing. A function that validates a request **and**
queries the database **and** formats a response has three reasons to change and
must be split.

Rules:

- One primary concern per file. Routes validate and delegate; they do not contain
  business logic or SQL.
- One purpose per function. If its name needs "and" or "or", split it.
- A function should have a single level of abstraction. Do not mix HTTP parsing
  with cryptography inside the same function.
- Separate **policy** (what is allowed) from **mechanism** (how it is done) and
  from **I/O** (database, clock, network, randomness).
- Prefer many small, named functions over one large function with comments
  explaining sections.
- If a module changes for two different business reasons, it is two modules.

## 2. Layering and dependency direction

```text
routes/  ──▶  ingest/ reports/  ──▶  domain/  ──▶  (pure data + errors)
   │                  │
   └──────────────▶  db/  (queries, migrations)
```

- `domain/` is pure: no Fastify, no Kysely, no `process.env`, no `Date.now()`
  unless injected.
- `ingest/` and `reports/` orchestrate; they may call `domain/` and `db/`.
- `routes/` validate input, call an orchestrator, and shape the HTTP response.
- `plugins/` wire infrastructure (database, config, auth) into Fastify.
- Dependencies point inward. Pure modules never import outer layers.
- `app.ts` is the composition root. No hidden singletons with side effects.

## 3. Function rules

- Do one thing and return one result. Prefer a pure function when possible.
- Keep functions small. Target under ~40 lines; split by intent, not by arbitrary
  line count.
- Use at most three positional parameters; beyond that, take a typed object.
- No boolean flag parameters that switch behavior. Use two functions or a
  discriminated union.
- Prefer early returns over deep nesting. Maximum two levels of nested blocks.
- Give exported functions explicit return types.
- Inject side effects (`clock`, `ids`, `db`) so behavior is testable and
  deterministic.
- Avoid mutating inputs. Return new values.

## 4. File and module rules

- One public concern per file; a small number of closely related exports is fine.
- Name files by their responsibility: `verify-event.ts`, `snapshot-rollup.ts`,
  not `utils.ts` or `helpers.ts` (a dumping ground is an anti-pattern).
- Keep files focused. If a file grows past roughly 300 lines or starts needing
  section comments, split it.
- No circular imports. If two modules need each other, extract the shared concept.
- Barrel files only at intentional API boundaries. Do not hide dependency cycles.

## 5. Naming

- Functions are verbs (`verifyEvent`, `insertEvents`), data is nouns
  (`EventBatch`, `Session`), booleans read as predicates (`isExpired`,
  `hasPermission`, `canRefresh`).
- Names describe intent, not implementation (`persistAcceptedEvents`, not
  `doInsert`).
- Avoid abbreviations and vague names (`data`, `info`, `tmp`, `handle2`).
- Match protocol names exactly at the HTTP boundary (`accepted`, `duplicates`,
  `rejected`) and use domain names internally.

## 6. Error handling

- Define typed domain errors. Map them to HTTP status codes once, at the boundary.
- Never swallow an error silently. If a failure is intentionally ignored, log it
  with context and comment why.
- Do not use exceptions for expected control flow.
- Retryable failures are `5xx`; invalid input is `4xx`. This is also a protocol
  rule: the client retries `5xx` and keeps rejected events queued.
- Error messages are safe to return and never contain secrets or decrypted data.

## 7. Validation and trust boundaries

- Validate at the edge (route schema, TypeBox). Once inside the domain, inputs are
  already validated and typed; do not re-validate everywhere.
- Authorization is not validation: check the session workspace separately and
  always.
- Keep the encryption-envelope validator in one place; routes and workers reuse
  it rather than reimplementing checks.

## 8. Side effects and time

- Isolate clock, random ids, crypto, database, and network access at the edges.
- Pass `now` explicitly to functions that need time; default to `Date.now()` only
  in the outer layer.
- One transaction per logical unit of work. Do not span HTTP handlers and
  background jobs in the same abstraction.

## 9. Comments and documentation

- Comment **why**, not **what**. The code should explain what it does.
- No commented-out code. Use version control.
- Update `docs/` and `docs/ROADMAP.md` when behavior or contracts change.
- Public modules get a short header explaining responsibility and invariants.

## 10. Tests

- One behavior per test; arrange–act–assert.
- Test pure domain functions directly; use integration tests for routes, auth,
  and ingest against a real PostgreSQL.
- Every rule in `docs/SECURITY.md` has a test.
- Tests must not depend on execution order or shared mutable state.
- Name tests by behavior: `rejects replayed challenge`, not `test auth 2`.

## 11. Examples

Bad — one function with three responsibilities and hidden I/O:

```ts
async function handleEvents(request: any, reply: any) {
	const workspace = request.body.workspaceId;
	const events = request.body.events.map((e: any) => {
		const valid = verifySignature(e); // domain
		return { ...e, workspace, valid }; // transform
	});
	await db.insertInto('events').values(events).execute(); // SQL in route
	return reply.send({ accepted: events.map((e: any) => e.id) });
}
```

Good — each unit has one responsibility:

```ts
// routes/events.ts — boundary only
export const eventsRoute = async (app: FastifyInstance) => {
	app.post('/v1/events', { schema }, async (request) => {
		const session = requireSession(request);
		return ingestEvents({ db: app.db, session, events: request.body.events });
	});
};

// ingest/pipeline.ts — orchestration
export async function ingestEvents(input: IngestInput): Promise<IngestResult> {
	const verified = input.events.map((event) => verifyEvent(event, input.session));
	const valid = verified.filter(isAccepted);
	return persistEvents(input.db, input.session.workspaceId, valid);
}

// domain/nostr.ts — pure policy
export function verifyEvent(event: SignedEvent, session: Session): Verified {
	// id, signature, kind, workspace, clock checks; no I/O
}

// db/events.ts — persistence only
export async function persistEvents(db, workspaceId, events): Promise<IngestResult> {
	// parameterized `on conflict do nothing`; returns accepted/duplicates
}
```

## 12. Review checklist

Reject or refactor when you see:

- [ ] A function or file whose name needs "and".
- [ ] HTTP, SQL, and business rules in the same unit.
- [ ] Boolean parameters that switch behavior.
- [ ] A `utils.ts` dumping ground.
- [ ] Deep nesting instead of early returns.
- [ ] Duplicated validation or envelope checks.
- [ ] Hidden I/O in pure-looking functions.
- [ ] Silent error swallowing.
- [ ] One test asserting many behaviors.
- [ ] An abstraction with a single trivial caller and no clear boundary.
