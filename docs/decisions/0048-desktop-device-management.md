# 0048 — Desktop device management (heartbeat + Settings revoke/rename)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Desktop Agent execution plan (T2.4, Wave M2); founder decision
  **D-DA-2** (Personal-orgs-only) default applied

## Context

T2.2 (ADR 0047) mints a desktop **device** as a `connections` row
(`vendor: claude_code_local`, `authKind: device_token`,
`config.pairedByUserId = <consenting member>`). T2.4 (spec §24.2) is the
management surface for it: a signed-in member lists their own enrolled devices
(name, platform, agent version, last heartbeat, enrolled date), renames one,
and revokes one; and each running agent posts a lightweight **heartbeat**
(`POST /api/desktop/heartbeat` — spec §24 lists this exact route) carrying its
current version and a queue-depth count.

This needs three things the frozen `forOrg` public API does not yet provide:
(1) a place to store per-device heartbeat state, (2) a writer for it, and (3) a
credential-delete for revoke. Because `src/db/org-scope/**` is a frozen
contract, the additive methods are recorded here. **No schema migration is
required** — see below.

## Decision

### Heartbeat storage — reuse `connections.config` jsonb, no migration

The heartbeat's three fields — `lastHeartbeatAt` (ISO), the refreshed
`agentVersion` (the agent may self-update after pairing), and `queueDepth` (a
diagnostic **count**, never content) — are merged into the **existing**
`connections.config` jsonb column. Considered and rejected:

- **A new `last_heartbeat_at` column (migration):** a frozen-schema change for
  data that is display-only and already has a natural home. The config column
  exists, is org-scoped, cascades on delete, and already holds the sibling
  pairing-time device metadata (`platform`, `installationId`, `pairedByUserId`).
- **Reusing `last_polled_at` / `last_success_at` (markPolled/markSynced):** a
  heartbeat is a **liveness ping, not a data sync**. Folding it into the poll
  timestamps would make "last heartbeat" and "last successful sync"
  indistinguishable (the ingest path stamps the same fields), and would not
  refresh `agentVersion`. Kept distinct.

The merge is a jsonb `||` shallow-merge of the three keys, preserving every
pairing-time key. The timestamp rides as an ISO string **inside** the JSON, so
no bare JS `Date` crosses the `sql` boundary (that path 500s on
postgres.js/Hyperdrive — an established gotcha).

### `forOrg` additive methods (the frozen-contract change this ADR covers)

Added to the `connections` namespace (`src/db/org-scope/connections.ts`),
public API otherwise unchanged:

- **`recordDeviceHeartbeat(id, { agentVersion, queueDepth, now? })`** — merges
  the three fields into config; org-guarded and `ne(status, 'paused')` (a
  revoked device never records, matching `markPolled`/`markSynced`).
- **`deleteCredential(connectionId, kind)`** — deletes a stored credential row,
  org-guarded on the credential's own `org_id`; idempotent; write-only.

No new table ⇒ no new tenant-isolation / account-deletion / purge registration
(the `connections` graph is already registered; the credential row cascades
with its connection). No `metric_records`/score semantics change.

### Routes

- **`POST /api/desktop/heartbeat`** — device-token-authed (the shared T2.1
  `authenticateDeviceToken` verifier, `getApiContext` pattern, no web session);
  strict zod body (`agentVersion` bounded string, `queueDepth` non-negative
  int); restricted to `claude_code_local`. Auth **before** body parse, so a
  revoked/paused device is rejected (403 paused / 401 credential-gone) before
  any work. Logic in `src/lib/desktop-heartbeat.ts` (PGlite-unit-testable).
- **`PATCH /api/desktop/devices/:id`** (rename) and
  **`POST /api/desktop/devices/:id/revoke`** — session-authed via `handleApi`,
  **not** admin-only (a member manages their own devices), `allowOverFreeBand`
  (self-service device management, like the /settings paywall exemption).
  Ownership (`config.pairedByUserId === session user`) is re-checked
  server-side; a foreign/unknown device is a `404`. These use **local zod
  schemas**, not the frozen `apiRoutes` contract (no `src/contracts` change).

### Revoke semantics

Revoke **pauses** the connection **and destroys** its `device_token`
credential — a clean-slate revocation: the old token can never re-authenticate,
and re-enrolling requires a fresh pairing (not an un-pause). Pausing alone
would answer the old token `403`; deleting the credential makes the next auth a
`401` (credential gone) — a **stronger** rejection than the plan's sketched
`403`, and the honest one for "this device is gone." Per **spec §27.4**,
pausing touches only this connection, so every other enrolled device keeps
authenticating (proven by test).

### Settings surface

A new **Devices** tab under `/settings/devices` — an **everyone** tab
(`adminOnly: false`), because every member owns their own device list. The
count-only cross-member admin summary the plan sketches is **not built**:
pairing is Personal-orgs-only today (D-DA-2), a personal org is an org of one,
so there is no other member whose devices could appear; team-org devices are
gated on T5.1. The self-view filter (`config.pairedByUserId`) is the structural
boundary if that gate later opens.

## Consequences

- No migration; latest migration stays **0037**.
- `forOrg` gains two additive methods (`recordDeviceHeartbeat`,
  `deleteCredential`), each covered by its own unit test.
- Heartbeat data lives in `config` — anything reading `config` must treat the
  heartbeat keys as display-only counts, never identity or content.

## Alternatives considered

- **`last_heartbeat_at` column** — rejected (migration for display-only data
  that has a home).
- **Revoke = pause only** — rejected; leaves a live credential and only a
  reversible pause, weaker than "device removed."
- **Revoke = delete the whole connection** — rejected; loses the device record
  (and cascades its pairing row), so the list can't show "removed."
