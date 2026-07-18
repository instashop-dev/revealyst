# 0058 — Desktop-agent token rotation (short-lived access tokens + `/api/desktop/auth/refresh`)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Desktop Agent execution plan (T7.2, Wave M7); retires deviation
  **D-DA-4** (long-lived static device token)

## Context

Today the desktop agent authenticates **every** request — analytics ingest,
signed config fetch, diagnostics, and the OTLP receiver — with its long-lived
`rva1.<orgId>.<connectionId>.<secret>` **device token** (`src/lib/agent-token.ts`,
verified by `authenticateDeviceToken` in `src/lib/device-token.ts`). That is the
recorded **D-DA-4** deviation: a static, powerful, long-lived bearer credential
sent on the wire on every call. If it is captured in flight or at rest it grants
full ingest access for the connection until an operator pauses it.

T7.2 (spec §26.4, "token-rotation hardening") narrows that blast radius: the
device token becomes a **refresh credential only**, and ordinary calls use a
**short-lived signed access token** minted from it.

The change must be **strictly backward-compatible** — a real fleet of already
paired agents is in the field. A hard cutover (server stops accepting device
tokens) would break every un-updated agent. So the server must accept **either**
credential during rollout.

This touches the frozen route-contract registry (`src/contracts/api.ts` — a new
route entry) and the device-token auth seam, so per rule 1 this ADR travels with
the PR (the frozen-contracts CI guard fires on the `src/contracts/` change).

## Decision

### The access token — a short-lived HMAC-SHA256 JWT (`src/lib/desktop-access-token.ts`)

A compact JWT with tightly bound claims:

- `iss` = `revealyst-desktop`, `aud` = `revealyst-desktop-api` — both re-checked
  on verify, so a token minted for any other surface, or without the desktop
  audience, is refused.
- `sub` = connectionId, `org` = orgId — the device/org identity.
- `iat` / `exp` — **15-minute** expiry (`DESKTOP_ACCESS_TOKEN_TTL_SECONDS`), with
  a 30-second clock-skew leeway on verify.
- header `alg` = `HS256`, `kid` = signing-key version.

**Why symmetric HMAC, not Ed25519 like the config signature (ADR 0049)?** The
config signature is **asymmetric on purpose** — the *agent* verifies it against a
baked-in public key, so the private key must stay server-only. The access token
is the opposite: it is verified **only by the server that minted it** (the same
Worker). The agent treats it as an **opaque string** — it never decodes or
verifies it. So there is no public key to distribute and no asymmetric pair to
manage; one Worker secret both signs and verifies. Pure WebCrypto (`crypto.subtle`
HMAC), the same primitive `src/lib/github-app-config.ts` already uses — **no new
dependency**.

**Forgery/replay defenses baked into `verifyDesktopAccessToken`:** the header
`alg` must be exactly `HS256` (closes the classic `alg:none`/alg-confusion hole —
we choose the algorithm, the token does not); the signature is recomputed and
**constant-time** compared under every configured key (we never branch on the
attacker-controllable `kid` to select a key); claims are parsed **only after**
the signature verifies; `iss`/`aud`/`exp`/UUID-shaped `sub`+`org` are all
enforced; any failure collapses to an indistinguishable `{ ok: false }` and the
function never throws.

### Endpoint — `POST /api/desktop/auth/refresh` (`src/lib/desktop-refresh.ts` + route)

Bearer-authenticated by the **device token only** over the session-free
`getApiContext` path (like `/api/desktop/heartbeat`, `/api/agent/ingest`). It
authenticates via `authenticateDeviceToken` (which only accepts the `rva1.`
prefix), then mints an access token for the same (org, connection). Same failure
semantics as every device-token route: 401 for a missing/malformed/wrong token,
403 for a paused (revoked) connection.

**Only the device token may refresh** — an access token lacks the `rva1.` prefix,
so it can never authenticate here to extend itself. This is what bounds a stolen
access token to its 15-minute TTL: it cannot be self-renewed past a device
revocation.

**Backward-compatible "not configured" behavior:** if the access-token signing
key is absent (CI/dev, or a deploy that has not enabled rotation yet), `/refresh`
returns a **benign 503** with a `console.warn` — never a fake token, and never a
500 outage. The agent reads the 503 and keeps using its device token directly.
This is the honest-absent-secret pattern (like SES / the Copilot App config),
*not* the fail-closed 500 the config signer uses (that one 500s because the agent
would otherwise trust an unsigned config; here there is nothing to trust).

### Server acceptance — `authenticateDesktopBearer` (backward-compatible)

A new acceptor in `src/lib/device-token.ts` replaces `authenticateDeviceToken` at
every authenticated desktop endpoint (agent ingest, desktop config, diagnostics,
`/v1/metrics`, `/v1/logs`). It routes by **credential shape**, not a guess: a
device token is exactly `rva1.<uuid>.<uuid>.<secret>` (4 dot-parts, `rva1`
prefix); an access token is a 3-part JWT — so the two verification paths never
overlap.

- `rva1.` prefix → the existing `authenticateDeviceToken` (byte-identical legacy
  path).
- otherwise → `verifyDesktopAccessToken`; on success, **re-fetch the connection
  row** via `forOrg(orgId).connections.get(connectionId)` and re-run the same
  post-auth checks (exists, `authKind === "device_token"`, not paused). This is
  deliberate: even a still-unexpired access token is rejected the instant its
  connection is deleted, changes kind, or is paused — the operator's revocation
  gesture is honored immediately, not only after the token's short TTL lapses.

Both paths return the identical `DeviceTokenAuthResult`, so all downstream
ingest/config/diagnostics/OTLP logic is untouched (same 401 for any failure, 403
only for authenticated-but-paused).

### Signing key — `DESKTOP_ACCESS_TOKEN_SIGNING_KEY` (new Worker secret)

Format `v<N>:<base64 of ≥32 random bytes>`, e.g. `v1:3q2+7w…` — the same
versioned convention as `CREDENTIAL_KEK_*` and `DESKTOP_CONFIG_SIGNING_KEY`, but a
**distinct** key. Declared as a local structural type (`DesktopAccessTokenEnv`),
never added to the generated `cloudflare-env.d.ts` (it is a secret). Synced by the
`deploy.yml` "Sync Worker secrets" step; **never** exposed to PR/CI workflows
(spec §29). Tests inject their own throwaway key — **the suite never requires the
real secret**.

**Rotation (zero-downtime, no agent release):** because the server both signs and
verifies, an optional `DESKTOP_ACCESS_TOKEN_SIGNING_KEY_PREVIOUS` lets verify
accept the previous key while new tokens sign under the current key. To rotate:
set `_PREVIOUS` to the outgoing key, flip `_SIGNING_KEY` to the new one; after one
TTL window (minutes) all outstanding tokens have expired, then drop `_PREVIOUS`.
No public key is distributed and the agent is never involved (it holds no key).

### Desktop client (`desktop-agent/src-tauri`)

The agent obtains an access token from `/refresh` and uses it as the bearer for
its authenticated calls, **falling back to the device token** whenever refresh is
unavailable (an old server → 404, a not-configured server → 503, or any network
failure). The device token stays **only in the OS keychain**; the access token
lives **in memory only** and is never persisted and never exposed to the
frontend (no Tauri command returns it — the UI still only sees the `is_signed_in`
boolean). No new Rust crate is needed: the token is opaque to the agent, so it is
never decoded; the `expiresIn` seconds from `/refresh` drive early refresh
without parsing the JWT.

## Consequences

- **Target state:** device token = refresh credential; access token = what the
  agent presents on every ordinary call. During rollout the server accepts both;
  a future ADR may retire device-token acceptance on the ingest paths once the
  fleet has updated (not done now — would break un-updated agents).
- **No migration, no new table.** The design is stateless: a signed, 15-minute
  JWT needs no server-side session store. Revocation is already covered by the
  connection `paused` check (honored on every acceptance) plus the short TTL, so
  no revocation table is warranted.
- **Blast radius:** a captured access token is useless after ~15 minutes and
  cannot mint successors; the long-lived device token now travels only to
  `/refresh`.
- If `DESKTOP_ACCESS_TOKEN_SIGNING_KEY` is unset, rotation is simply inactive:
  `/refresh` 503s benignly and agents keep using device tokens — CI and any
  un-provisioned deploy stay green.
- Workstreams to re-sync: W1-S contract tests (new `desktopAuthRefresh` entry);
  the desktop client (consumes `/refresh`); `deploy.yml` secret sync when the
  founder provisions the production key.

## Contracts affected

- **Frozen — `src/contracts/api.ts`:** additive `desktopAuthRefresh` route entry
  (POST, no request body, `{ accessToken, tokenType, expiresIn, audience }`
  response). No schema/`org-scope`/`credentials`/`drizzle` change.
- New: `src/lib/desktop-access-token.ts`, `src/lib/desktop-refresh.ts`,
  `src/app/api/desktop/auth/refresh/route.ts`; `authenticateDesktopBearer` added
  to `src/lib/device-token.ts` and re-exported from `src/lib/otel-receiver.ts`;
  the five acceptance routes/libs swapped to it. New Worker secret
  `DESKTOP_ACCESS_TOKEN_SIGNING_KEY` (+ optional `_PREVIOUS`). Desktop client:
  the in-memory access-token cache + refresh path.
