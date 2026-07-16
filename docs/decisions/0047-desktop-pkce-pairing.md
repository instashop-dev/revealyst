# 0047 — Desktop-agent PKCE pairing (`desktop_pairing_codes` + `/api/desktop/auth/*`)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Desktop Agent execution plan (T2.2, Wave M2); founder decision
  **D-DA-1** (resident-collector go) signed; **D-DA-2** (Personal-orgs-only)
  default applied

## Context

The desktop agent (Tauri, `desktop-agent/`) needs to obtain the EXISTING
`rva1.<orgId>.<connectionId>.<secret>` device token (ADR 0002) without ever
showing a password form in the desktop UI (spec §8). Today the only pairing
path is `POST /api/connections/:id/agent-token` — a session-cookie route the
CLI user drives from the dashboard, useless to a native app that has no
session. The gap analysis (§4) resolves this as **browser-session pairing**:
the human authenticates via the existing web session in the system browser,
approves the device on a consent screen, and the agent completes an OAuth
Authorization Code + PKCE-shaped exchange. There is deliberately **no OAuth
server**: no refresh tokens, no client registration, no scopes — the output is
the same static device token the CLI already uses (D-DA-4 records that
deviation until T7.2).

A new org-scoped table plus routes touch frozen contracts (`src/db/schema/**`,
`drizzle/**`, the `forOrg` public API), so this ADR covers the whole surface.

## Decision

### Flow (three steps, one new table)

1. **`POST /api/desktop/auth/start`** — unauthenticated and **stateless**.
   The agent submits its S256 `codeChallenge` (RFC 7636, 43–128 base64url),
   an opaque `state`, and device metadata (`deviceDisplayName`, `platform`
   macos|windows, `architecture` arm64|x64, `agentVersion`, `installationId`
   uuid). The server zod-validates, mints a random 128-bit `pairingId`, and
   returns `{pairingId, browserUrl, expiresAt}` — writing **nothing**.

   *Why stateless:* the table is org-scoped and at start time no org exists
   (the user hasn't consented). Creating rows pre-consent would require either
   an unscoped write path (a tenancy-rule breach) or a fake org binding.
   Statelessness also removes the unauthenticated-write flood surface
   entirely: the row is created only by an authenticated consent. The cost is
   that the browser URL carries the payload in query params — acceptable
   because nothing in it is secret (the challenge is already a hash; the
   state is agent-chosen CSRF material the agent itself validates) and the
   consent handler re-validates every field. A forged URL buys an attacker
   nothing: the one-time code minted at consent travels only via the
   `revealyst://` deep link on the consenting user's own machine, and the
   exchange additionally demands the PKCE verifier that never leaves the
   agent. The `issued` timestamp in the URL is a **soft freshness bound**
   (honest "link expired" UX); it is client-forgeable, and forging it only
   widens the forger's own pre-consent window — the security TTL is the
   server-stamped `expires_at` below.

2. **`GET /desktop/connect` (session page) → `POST /api/desktop/auth/consent`
   (session route)** — the signed-in user sees the device metadata + the
   workspace it will join and approves via a plain HTML form. The consent
   handler (session + explicit Origin CSRF check, mirroring the agent-token
   route) creates the **org-scoped `desktop_pairing_codes` row**: challenge
   as-is, SHA-256 of a fresh random 256-bit one-time code (the code itself is
   never stored), consenting user, device metadata, `expires_at = now + 10
   min`. It then 303-redirects to
   `revealyst://desktop-auth/callback?code=…&state=…&pairing=…`.

   **D-DA-2 (Personal orgs only):** a Team org gets an honest "not available
   for team workspaces yet" state on the page AND a refusal in the handler —
   no mint path exists. Enforced in code, not schema, so the future
   sub-case-C ADR lifts it without a migration.

3. **`POST /api/desktop/auth/exchange`** — unauthenticated; possession of the
   one-time code AND the PKCE verifier is the credential. Looks up the row by
   `pairingId` (**required**, a deliberate tightening of the plan's optional
   sketch: the indexed unique handle is the lookup key, so the secret code is
   only ever *compared* against its hash, never used as a key), verifies
   hash/verifier/expiry with timing-safe comparison, then **single-use claims
   `used_at` via compare-and-set** (the `budget_alert_state` pattern) —
   exactly one of two racing exchanges wins. The winner mints the device
   `connections` row + envelope-encrypted `device_token` credential and
   returns the composed token **once**, plus `deviceId` (= connectionId) and
   `orgId`. A crash after the claim under-delivers (user restarts pairing),
   never double-mints. Error semantics: unknown handle → 404; expired /
   reused / wrong code / verifier mismatch → 400.

### `desktop_pairing_codes` (migration 0037)

Org-scoped, in the `connections` schema domain module. Columns: `id`,
`org_id` (→ orgs, **cascade**), `pairing_id` (globally unique — the pre-auth
lookup key and the consent-replay guard), `code_challenge`, `code_hash`,
`consented_user_id` (→ user, cascade), `device_display_name`, `platform`,
`architecture`, `agent_version`, `installation_id`, `connection_id` (nullable
until exchange; composite tenant FK `(org_id, connection_id)` →
`connections(org_id, id)` cascade — cross-org minting unrepresentable),
`expires_at`, `used_at`, `created_at`, plus the D1a `(org_id, id)` anchor.

The three registrations:

1. **Tenant isolation:** `desktopPairing.get(B)` in `SCOPED_READS` with a
   non-vacuous B-org seed — the handle is globally unique, so probing B's
   handle through A's scope isolates the org filter itself.
2. **This ADR.**
3. **Account deletion:** `PURGE_EXEMPT_TABLES` — the direct cascade-to-orgs
   FK removes leftovers at the final `orgs` delete; exchanged rows go earlier
   with the explicit `connections` delete via the composite FK.

The pre-auth lookup `findDesktopPairingByPairingId` lives in
`src/db/system.ts` (the sanctioned bounded cross-org read); every write goes
back through `forOrg(row.orgId).desktopPairing`.

### Ownership: member-level, self-owned, structural

`connections` has no owner column and this ADR does **not** add one. The
consenting member is recorded on the pairing row (`consented_user_id`) and
stamped into the minted connection's non-secret `config.pairedByUserId`. The
consent surface takes the **session user only** — no request field can name
another user, so "minting a device for someone else" is unrepresentable
rather than 403'd (a test pins the shape). This is the research-§5.5 gate
1(c) authz change: a plain member may mint a device token, but only for a
device they themselves approved, landing in their own org. Under D-DA-2
(Personal orgs) the consenting member is the workspace anyway; the
`config.pairedByUserId` stamp is what T2.4's per-user device list will filter
on if Team orgs ever arrive.

### Reuse — zero new frozen enum values

- Vendor `claude_code_local` and authKind/credential kind `device_token` are
  reused **verbatim** (they exist since ADR 0002); the push-based connection
  is invisible to the poll dispatcher exactly like the CLI's (no registry
  entry for the vendor).
- Token format, minting (`generateAgentSecret`/`composeAgentToken`), envelope
  storage (`storeCredential`), and verification (`authenticateDeviceToken`)
  are the existing machinery, untouched. Revocation = pause connection
  (existing `paused → 403` path).
- The routes follow the blessed **two-tier route-typing convention**: they are
  device-facing and session-free like `/v1/metrics` + `/v1/logs`, so their zod
  schemas are colocated in `src/lib/desktop-pairing.ts` and NOT added to the
  frozen `apiRoutes` registry in `src/contracts/api.ts` (which stays
  untouched).

### Free-band note

The two device-facing endpoints use `getApiContext` (no session), so the
`handleApi` 402 choke deliberately does not apply — same posture as
`/api/agent/ingest` and `/v1/*`. The consent **page** is session-gated and
rides the `(app)` layout's paywall gate; the consent POST mirrors the
agent-token route's session + Origin discipline.

### Deep-link scheme

`revealyst://desktop-auth/callback` is the fixed callback (spec §8.2). The
server echoes the agent's `state` through untouched; the AGENT validates
state, single-fire, and source path (T2.3). Scheme registration is the
desktop app's job (`tauri-plugin-deep-link`).

## Consequences

- Full PKCE dance is executable with curl + a browser:
  1. `curl -X POST https://<host>/api/desktop/auth/start -H 'content-type:
     application/json' -d '{"codeChallenge":"<S256(verifier)>","state":"<s>",
     "deviceDisplayName":"My Mac","platform":"macos","architecture":"arm64",
     "agentVersion":"0.1.0","installationId":"<uuid>"}'` → open `browserUrl`
     signed-in, approve; capture `code` from the `revealyst://` redirect.
  2. `curl -X POST https://<host>/api/desktop/auth/exchange -H 'content-type:
     application/json' -d '{"pairingId":"<id>","code":"<code>",
     "codeVerifier":"<verifier>"}'` → `{token, deviceId, orgId}`.
- Audit rows on consent (`desktop.pairing_consent`, actor = user) and
  exchange (`desktop.pairing_exchange`, actor honestly null — the device
  acts, authorized by the recorded consent; the consenting user rides
  metadata). Codes, hashes, and tokens never appear in audit rows or logs.
- Expired/unused rows are inert (≤10-min TTL, hashes only) and cascade away
  with their org; no garbage-collection job is needed at this volume — a
  retention sweep can ride `purgeExpiredRetention` later if rows ever matter.
- Workstreams to re-sync: T2.3 (agent client — consumes these routes), T2.4
  (device list/revoke — reads `config.pairedByUserId`), W1-S contract tests.

## Contracts affected

- `src/db/schema.ts` (barrel unchanged; `src/db/schema/connections.ts` gains
  `desktop_pairing_codes`) + `drizzle/0037_desktop-pairing-codes.sql`.
- `src/db/org-scope.ts` public API: additive `desktopPairing` namespace
  (`src/db/org-scope/desktop-pairing.ts`).
- `src/contracts/**`: **untouched** (two-tier convention; vendor/authKind
  values reused, not extended).
