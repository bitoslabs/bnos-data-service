# Protocol

This document specifies the HTTP contract between BNOS clients and the data
service. Version 1 is **already implemented** in
`bnos-svelte/src/lib/data-service/` and must be treated as fixed. Report
endpoints are a backward-compatible v1.1 extension negotiated through the
capabilities document.

## 1. Transport rules

- HTTPS is required for remote hosts. Plain HTTP is accepted only on loopback
  hosts during development (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`).
- The service URL may contain a path prefix, for example
  `https://data.example.com/bnos`. All paths below are resolved relative to that
  prefix.
- Requests are JSON. Responses must be `application/json` (or an empty body for
  `204`). The client rejects other content types.
- The client never follows redirects. The server must never return `3xx`.
- No cookies. Authentication uses `Authorization: Bearer <token>`.
- The client sends `credentials: 'omit'`, `cache: 'no-store'`.
- Client timeouts: capabilities/verify/ingest 8–15 s, status 10 s, refresh 10 s,
  logout 3 s. Responses must be fast; ingest is batched.

## 2. Errors

Return a JSON body shaped so the client can extract a message:

```json
{ "error": { "code": "unauthorized", "message": "Session expired" } }
```

The client only reads `error.message` (or a top-level `message`) and maps status
codes:

| Status | Client error code | Meaning |
| --- | --- | --- |
| `401` | `unauthorized` | Missing/expired/revoked token, failed challenge |
| `403` | `forbidden` | Valid identity, insufficient permission |
| other 4xx/5xx | `http` | Generic failure |

Never leak tokens, invite codes, or decrypted content in error messages. Keep
messages short; the client truncates rejection reasons to 256 characters.

## 3. Identity and authentication model

- Identity is a Nostr public key (`pubkey`, 64 lowercase hex).
- A workspace is the GLO `organizationId`. The client sends it as `workspaceId`.
- The **first** connect uses a one-time **invite/setup code** created
  out-of-band by the service admin CLI, bound to a workspace (and optionally to
  a pubkey), with a TTL.
- Additional staff authenticate with their own keys. The server checks current
  workspace membership; staff never share the owner's credential.
- Access tokens are short-lived. Refresh tokens are longer-lived, rotating, and
  revocable.

## 4. Endpoints

Paths are relative to the service base URL.

### 4.1 `GET /v1/capabilities`

Public. No auth.

```json
{
  "protocol": 1,
  "service": { "id": "bnos-data-service", "name": "BNOS Data Service" },
  "auth": { "challenge": "nostr-event", "kind": 27235, "audience": "https://data.example.com" },
  "capabilities": {
    "backup": true,
    "status": true,
    "reporting": true,
    "restoreStatus": false
  }
}
```

Rules:

- `protocol` must equal `1`.
- `auth.challenge` must be `"nostr-event"`.
- `auth.audience` must be a non-empty stable string; it is bound into the signed
  challenge.
- Advertise `restoreStatus: true` only after a verified restore drill exists.

### 4.2 `POST /v1/auth/challenge`

```json
{ "invite": "<one-time setup code>", "pubkey": "<64 hex>", "workspaceId": "<organization id>" }
```

Response:

```json
{
  "challengeId": "chl_...",
  "nonce": "<random, single use>",
  "audience": "https://data.example.com",
  "expiresAt": 1760000300,
  "serviceId": "bnos-data-service",
  "kind": 27235
}
```

Rules:

- `expiresAt` is **Unix seconds** and must be in the future.
- Validate the invite (hash match, not used, not expired, workspace match).
- Validate that `pubkey` is a current member of `workspaceId`, or that the
  invite is bound to that pubkey.
- Persist the challenge with nonce, audience, workspace, pubkey, expiry, and
  single-use state. Challenge TTL should be 5 minutes or less.
- Do not consume the invite yet; consume it on successful verify.

### 4.3 Signed auth event

The client builds and signs this event. The server must verify it:

```json
{
  "kind": 27235,
  "created_at": 1760000000,
  "tags": [
    ["u", "https://data.example.com/v1/auth/verify"],
    ["method", "POST"],
    ["challenge", "<nonce>"],
    ["audience", "https://data.example.com"],
    ["workspace", "<workspaceId>"]
  ],
  "content": ""
}
```

Verification checklist:

1. `kind === 27235`.
2. `id` equals the canonical hash of the serialized event.
3. Schnorr signature is valid for `pubkey`.
4. `u` equals the exact verify endpoint the client used.
5. `method` is `POST`.
6. `challenge` equals the stored nonce for `challengeId`.
7. `audience` equals the service audience.
8. `workspace` equals the challenge workspace.
9. `created_at` is within a small skew window.
10. Challenge is unexpired, unused, and belongs to the same `pubkey`/workspace.

Reject replay by atomically marking the challenge used before issuing tokens.

### 4.4 `POST /v1/auth/verify`

```json
{ "challengeId": "chl_...", "event": { /* signed kind 27235 event */ } }
```

Response (session):

```json
{
  "token": "<opaque access token>",
  "expiresAt": 1760000900,
  "user": { "pubkey": "<64 hex>" },
  "workspace": { "id": "<workspaceId>", "name": "My Shop" },
  "permissions": ["backup.write", "status.read", "reports.read"],
  "refreshToken": "<opaque refresh token>",
  "refreshExpiresAt": 1762592000
}
```

Rules:

- `expiresAt` and `refreshExpiresAt` are Unix seconds.
- `user.pubkey` must equal the pubkey that signed the challenge.
- `workspace.id` must equal the challenge workspace.
- `permissions` is a string array; it may be empty.
- Store only hashes of `token` and `refreshToken`.
- Consume the invite on success.

### 4.5 `POST /v1/auth/refresh`

```json
{ "refreshToken": "<opaque refresh token>" }
```

Response: same session shape as verify, with a freshly rotated refresh token.

Rules:

- Atomic rotation: the presented refresh token is invalidated.
- Reuse of an old refresh token revokes the whole session family and returns
  `401`.
- Re-check membership; a revoked member cannot refresh.

### 4.6 `POST /v1/auth/logout`

Requires `Authorization: Bearer <access token>`. Optional body:

```json
{ "refreshToken": "<opaque refresh token>" }
```

Rules:

- Revoke the access session and, when supplied, the refresh token.
- Return `204`. Failures to revoke are logged but do not block local cleanup.

### 4.7 `POST /v1/events`

Requires bearer auth. This is the authoritative client-push ingest path.

```json
{ "events": [ { "id": "...", "pubkey": "...", "created_at": 1760000000, "kind": 30200, "tags": [], "content": "...", "sig": "..." } ] }
```

Response:

```json
{
  "accepted": ["<event id>"],
  "duplicates": ["<event id>"],
  "rejected": [{ "id": "<event id>", "reason": "invalid-signature" }]
}
```

Semantics:

- `accepted`: newly persisted and durable.
- `duplicates`: already present; the client acknowledges and removes them.
- `rejected`: not stored; the client keeps them queued and retries later.
  Do not use `rejected` for retryable server failures — return `5xx` instead so
  the client marks a failed attempt without dropping the event.

Server validation per event:

1. `id`, `pubkey`, `sig` are well formed; `id` matches the canonical hash.
2. Schnorr signature verifies.
3. `kind` is in the allowed set for this deployment.
4. `created_at` is not absurdly in the future (allow historical backfill).
5. Event size is within limits; batch is `<= 100`.
6. The workspace is taken from the session. If the event carries an
   `organization` tag that differs, reject with `workspace-mismatch`.
7. In private mode, `content` must parse as a recognized encryption envelope:
   AES-256-GCM, version 1, canonical base64url `nonce` (12 bytes) and
   `ciphertext`, keys restricted to `v, encrypted, scheme, alg, kid, nonce,
   ciphertext, aad`, `aad` containing at most `recordId`.
8. Do not attempt to decrypt.

Persistence must be idempotent:

```sql
insert into events (...) values (...)
on conflict (id) do nothing;
```

Rows that conflict are reported as `duplicates`.

### 4.8 `GET /v1/status`

Requires bearer auth.

```json
{
  "workspace": { "id": "<workspaceId>", "name": "My Shop" },
  "connection": { "serverTime": 1760000000 },
  "backup": {
    "lastBackupAt": 1759999000,
    "lastVerifiedRestoreAt": null,
    "state": "current"
  }
}
```

Rules:

- `connection.serverTime` is Unix seconds.
- `backup.state` is one of `unknown`, `current`, `stale`, `failed`.
- If `workspace` is present and does not match the session, the client treats
  the connection as unauthorized.
- `lastVerifiedRestoreAt` must be `null` until a real restore drill has
  succeeded. An online server is not proof of recoverability.

## 5. Reporting extension (v1.1, proposed)

v1 exposes a `reporting` capability flag but defines no report routes. The
following extension is backward compatible and should be agreed with the bdGo OS
team before implementation.

### 5.1 Snapshot ingestion

`POST /v1/reports/snapshots` (bearer)

```json
{
  "snapshot": {
    "kind": 30970,
    "created_at": 1760000000,
    "tags": [
      ["d", "org.bitos.glo:v1:report.snapshot:<id>"],
      ["organization", "<workspaceId>"],
      ["location", "<locationId>"],
      ["granularity", "day"],
      ["period-start", "1760000000"],
      ["period-end", "1760086400"],
      ["currency", "USD"]
    ],
    "content": "{\"gross\":123400,\"orders\":42,\"payments\":{\"cash\":80000,\"lightning\":43400}}",
    "pubkey": "<member pubkey>",
    "id": "...",
    "sig": "..."
  }
}
```

Rules:

- Verify id, signature, and current workspace membership.
- Require `organization` tag to equal the session workspace.
- Aggregates only. No customer identifiers, no line-item plaintext, no secrets.
- Snapshots are sent to the service over authenticated HTTPS and are **not**
  published to relays.
- Idempotent by event `id`.

Response: `{ "accepted": ["<id>"], "duplicates": [], "rejected": [] }`.

### 5.2 Report queries

`GET /v1/reports/summary?from=<unix>&to=<unix>&granularity=day|week|month&location=<id>`

Response:

```json
{
  "snapshot": true,
  "generatedAt": 1760000000,
  "range": { "from": 1759913600, "to": 1760000000, "granularity": "day", "locationId": null },
  "currency": "USD",
  "buckets": [
    {
      "start": 1759913600,
      "end": 1760000000,
      "locationId": null,
      "currency": "USD",
      "grossMinor": 123400,
      "ordersCount": 42,
      "completeness": "snapshot",
      "payload": { "grossMinor": 123400, "ordersCount": 42 }
    }
  ],
  "watermark": 1759999000
}
```

Rules:

- Tenant scope comes from the session.
- Reports are explicitly labeled as snapshots, not authoritative totals.
- Missing periods are gaps, not zeros. Never fabricate completeness.
- Use keyset pagination for large bucket lists.

### 5.3 Negotiation

Clients discover the extension through `capabilities.reporting`. A future
protocol bump may add `reporting.version` and `reporting.schemas`. Do not break
v1 clients when adding fields.

## 6. Compatibility checklist

- [ ] Path prefix preserved and served.
- [ ] `protocol: 1` and all capability fields present.
- [ ] `expiresAt` values are Unix seconds.
- [ ] `workspace.id` echoes the requested workspace.
- [ ] `user.pubkey` echoes the authenticated identity.
- [ ] Ingest returns all three result arrays.
- [ ] Status includes `connection.serverTime` and nested `backup`.
- [ ] No redirects, no cookies, JSON content type.
- [ ] `401`/`403` used so the client can distinguish auth from permission.
