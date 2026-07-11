# 0025 — OpenAI admin-key scopes erratum + two-scope validateAuth probe

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Founder (via OpenAI sync-failure debugging session)

## Context

Debugging a live OpenAI sync failure produced hard evidence that contradicts a
frozen `docs/connector-facts.md` §4 claim. The fact file said admin keys have
"**No scopes — all-or-nothing**". Live calls (2026-07-11) show the org admin
surface enforces **per-endpoint scopes, gated separately**:

- `GET /v1/organization/users` → 403 "Missing scopes: **api.management.read**"
- `GET /v1/organization/usage/completions` and `/v1/organization/costs` →
  403 "Missing scopes: **api.usage.read**"

and the vendor's own 403 body references "restricted API key … necessary
scopes". Consequence for the connector: `checkAdminKey` probed ONLY
`/organization/users`, so a restricted key holding `api.management.read` but
not `api.usage.read` passed validate-on-save, then **every poll 403'd
permanently** — the connection bricked with a raw vendor JSON as its error.
A second, related defect: `checkAdminKey` swallowed transient failures
(429/5xx/timeout, `RetryableConnectorError`) into `{ok:false}`, which
`putConnectionCredential` treats as a definitive rejection — a vendor blip at
save time errored the connection and 400'd a perfectly valid key, even though
`api-impl` already documents that a THROW from `validateAuth` means
"inconclusive, keep the key".

## Decision

- Correct `docs/connector-facts.md` §4 Auth with an erratum: per-endpoint
  scopes exist (`api.management.read` for org listing, `api.usage.read` for
  usage/costs); mark **NLV-O2 resolved** (project-key rejection = HTTP 403,
  `error` is a bare string, not the `{error:{message}}` envelope).
- `checkAdminKey` (OpenAI) probes **both** scopes: `/organization/users`
  (limit 1) then `/organization/costs` (one 1d bucket, same param shape as
  `fetchCosts` so a probe-only 400 can't false-reject a key the real poll
  accepts).
- `checkAdminKey` **rethrows** `RetryableConnectorError` instead of folding it
  into `{ok:false}` — transient means inconclusive, never rejection. Applied
  to the anthropic and cursor siblings too (same swallowed-transient flaw;
  CLAUDE.md sibling-guard pattern).
- 401/403 error text from the OpenAI client now appends an actionable hint
  (org admin key, both scopes, project keys can't read the surface, keys can
  expire/be revoked) — this string is what lands in `connections.lastError`
  and the credential-save 400.

## Contracts affected

- `docs/connector-facts.md` §4 (Auth claim corrected, NLV-O2 closed). No typed
  interface, schema, or tenancy change; `AuthCheckResult` is unchanged —
  throwing on transients was already part of the `validateAuth` calling
  contract in `api-impl`.

## Workstreams to re-sync

- W2-J (connectors): OpenAI org-admin onboarding copy should mention both
  scopes when describing the admin key.
- W1-S (seams): when recorded real payloads land, include the 403
  bare-string-`error` rejection body as a fixture.

## Consequences

- Credential save for OpenAI now costs two vendor calls instead of one
  (sequential, no spacing sleep; worst case two 15s timeouts).
- Usage-blind restricted keys are rejected at onboarding with an actionable
  message instead of passing validation and failing every sync.
- Vendor blips during save no longer brick connections for openai, anthropic,
  or cursor.
- The fact file's "all-or-nothing" claim is superseded; anything downstream
  that repeated it (marketing/legal prose) should be re-checked against the
  erratum (W3-N content rule).
