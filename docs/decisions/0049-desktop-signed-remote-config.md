# 0049 — Desktop-agent signed remote config (`DESKTOP_CONFIG_SIGNING_KEY` + `/api/desktop/config`)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Desktop Agent execution plan (T4.2, Wave M4); founder decision
  **D-DA-1** (resident-collector go) signed

## Context

The desktop agent (Tauri, `desktop-agent/`) needs a fleet-wide **remote
configuration** it can trust without trusting the transport (spec §17): minimum
agent version, connector enablement + poll cadence, update channel, and an
emergency shutdown flag. Two hard rules bound this feature:

- **Never silently broaden collection** (spec §16.2 + §29 + plan law 1): remote
  config may DISABLE collection but must never widen it. In Phase 1 the only
  content mode is **Analytics Only**, so `defaultContentMode` is pinned to
  `"analytics_only"`.
- **Cryptographically signed** (spec §17.2): a tampered or forged config must be
  rejected. If signature validation fails the agent keeps the last valid
  unexpired config; if none exists it uses restrictive built-in defaults.

This is a **backend-only** slice (T4.2's backend half). It adds a new route, a
new lib, and one new Worker secret — it touches **no** frozen contract
(`src/contracts/**`, `src/db/schema.ts`, `src/db/org-scope.ts`,
`src/lib/credentials.ts`, `drizzle/**`, `docs/connector-facts.md` are all
untouched), so the frozen-contracts CI guard does not fire. This ADR exists to
govern the **new production signing key** — a distinct cryptographic key with
its own rotation procedure — the way ADR-adjacent docs govern the credential
KEK. The agent-side `config.rs` verify/cache/expiry logic is a later PR.

## Decision

### Endpoint — `GET /api/desktop/config`

Device-token authed via the shared `authenticateDeviceToken` verifier (T2.1,
`src/lib/device-token.ts`) over the `getApiContext` (session-free) path, exactly
like `/api/desktop/heartbeat` and `/api/agent/ingest`: unknown/malformed token →
401, paused (revoked) connection → 403, valid → 200. The response is
**config-and-signature only** — it carries no per-user data and no counts (the
config is identical for every device in the fleet), so an authenticated device
learns nothing about anyone.

### Config composition — `src/lib/desktop-config.ts`

There is no admin UI or config table yet, so exported constants in the lib ARE
the fleet config (`DESKTOP_CONFIGURATION_VERSION` — bump on any change —
`DESKTOP_CONFIG_TTL_MS` = 7 days, `DESKTOP_MINIMUM_AGENT_VERSION`,
`DESKTOP_CLAUDE_CODE_DEFAULT`, `DESKTOP_DEFAULT_UPDATE_CHANNEL`). The signed body
matches spec §17.2 plus an additive `signingKeyVersion` (see rotation).

**Never-broaden enforced three ways:** (1) `DesktopContentMode` is the single
literal type `"analytics_only"`, so a broader value is not constructible; (2)
`composeDesktopConfig` hard-codes it and then **re-asserts** it before
returning, so a future broader union fails loudly instead of shipping a widening
config; (3) the agent applies its own `defaultContentMode ≤ local mode → else
policy_blocked` check (T4.2 agent side) — a verified-but-broader config is still
refused on-device.

### Signing — Ed25519 via WebCrypto (`crypto.subtle`), no dependency

The config's canonical JSON is signed with **Ed25519** using the runtime's
`crypto.subtle` — supported on both the Cloudflare Workers runtime and Node
24/vitest (verified). We prefer the platform primitive over `@noble/ed25519`,
so **no crypto dependency is added**. The signature is standard base64 of the
64-byte signature.

**Canonicalization (the agent must reproduce it byte-for-byte):** recursively
serialize with object keys sorted ascending by code unit, no insignificant
whitespace, arrays in given order, standard JSON string/number escaping,
`undefined`-valued keys dropped, UTF-8 bytes. The `signature` field is never
part of the signed body.

### Signing key — `DESKTOP_CONFIG_SIGNING_KEY` (new Worker secret)

Format `v<N>:<base64 of the PKCS8 DER Ed25519 private key>` — the `v<N>` version
label mirrors the credential-KEK convention but this is a **distinct key**, not
the KEK. Synced by the `deploy.yml` "Sync Worker secrets" step (idempotent
`put`; distinct from any PR/CI workflow — spec §29 "do not expose signing
secrets to pull-request workflows"). The matching **public key** (raw 32-byte
Ed25519, from `exportKey("raw", publicKey)`) is baked into the agent at build
time; the later agent-side PR verifies against it. No `wrangler.jsonc` change is
needed — Worker secrets are not declared there.

### Rotation (documented; no stored ciphertext to re-wrap)

The signed body carries `signingKeyVersion`, so the agent can hold multiple
baked public keys and pick the right one. Rotate by: (1) generate a new keypair
**offline**; (2) ship an agent release baking in the new public key *alongside*
the old; (3) only then flip `DESKTOP_CONFIG_SIGNING_KEY` to `v<N+1>:…`; (4) drop
the old public key in a later agent release. Distributing the new public key
before flipping the private key guarantees no agent ever sees a config it
cannot verify. Unlike the KEK there is nothing stored to re-encrypt — configs
are minted fresh per request.

## Consequences

- The signed config is fetchable with a device token:
  `curl -H 'authorization: Bearer rva1.<org>.<conn>.<secret>'
  https://<host>/api/desktop/config` → `{...config, signature}`.
- If `DESKTOP_CONFIG_SIGNING_KEY` is unset, `/api/desktop/config` 500s (no key
  to sign with) — a deploy-time configuration error, surfaced loudly, never a
  silently unsigned config.
- Agent-side follow-up (T4.2 output, later PR) must implement in `config.rs`:
  verify the signature against the baked public key (matched by
  `signingKeyVersion`); on invalid signature keep the last valid **unexpired**
  config; if none, use restrictive built-in defaults; assert
  `defaultContentMode ≤ local mode` (broaden attempt → `policy_blocked`, never
  applied); honor `emergencyShutdown` over per-connector `enabled`.
- Workstreams to re-sync: T4.2 agent side (consumes this route + the baked
  public key), W1-S contract tests.

## Contracts affected

- **None frozen.** New: `src/app/api/desktop/config/route.ts`,
  `src/lib/desktop-config.ts`, `.github/workflows/deploy.yml` (additive secret
  sync). `src/contracts/**`, schema, `org-scope`, `credentials`, `drizzle/**`
  all untouched (device-facing route → two-tier convention, zod colocated in
  the lib).
