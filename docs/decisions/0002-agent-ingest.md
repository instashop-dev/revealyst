# 0002 — Revealyst Agent device-token ingest (W1-E, additive)

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Founder (W1-E plan approval)

## Context
W1-E ships the sanctioned local-ingest path (spec §10): a CLI on the user's
machine reads Claude Code session logs, summarizes them **locally** into
normalized metric records (never raw prompt content — rule-7 tripwire), and
pushes them to the app. The frozen W0-C contracts anticipated this
(`claude_code_local` vendor, `device_token` auth kind and credential kind)
but did not define (a) an ingest route, (b) a token-issuance route, or (c) a
way for the ingest path to stamp a connection's sync state. All three are
**additive** — no existing shape, column, or route changes.

## Decision

1. **Two new route contracts in `src/contracts/api.ts`:**
   - `connectionAgentTokenCreate` — `POST /api/connections/:id/agent-token`
     (session-authed). Server generates a random 256-bit secret, stores it as
     the connection's `device_token` credential through the existing encrypted
     envelope (`storeCredential`), and returns the composed token **once** in
     the response. This is a deliberate, narrow exception to "no response
     schema carries credential material": issuance-time display is the only
     way device pairing can work (same model as any PAT). The credential
     remains write-only/read-never *after* issuance; re-issuing rotates it.
   - `agentIngest` — `POST /api/agent/ingest` (Bearer device token). Body is a
     locally-normalized batch: subject descriptors + `metricRecordInput[]` +
     `subjectDaySignalInput[]` + honesty gaps — the exact frozen
     `NormalizedBatch` shapes. The server never receives log lines, prompt
     content, file paths, or tool output; privacy is enforced **by shape**
     (the request schema only admits metric rows).

2. **Token format `rva1.<orgId>.<connectionId>.<secret>`** (dot-separated;
   UUIDs and base64url contain no dots). The server derives the org scope
   from the token itself, then verifies the secret against the stored
   `device_token` credential via `forOrg(orgId).connections.withCredential`
   with a constant-time compare. No schema change, no token-lookup column:
   the AAD binding (`orgId:connectionId:device_token`) already makes a
   cross-org token replay fail decryption.

3. **One additive method on the frozen `forOrg` surface:**
   `connections.markSynced(id)` — sets `status='active'`, stamps
   `last_polled_at`/`last_success_at`, clears `last_error` (org-guarded
   update, same pattern as `setStatus`). Needed so ingest can surface
   "last synced" without raw table access.

4. **One new entry in the `check-org-scope.mjs` createDb allowlist:**
   `src/lib/api-context.ts` — a single request-context helper
   (`getCloudflareContext` → `createDb`) that all API route handlers use,
   instead of allowlisting every route file.

## Contracts affected
- `src/contracts/api.ts` — additive routes + request/response schemas only.
- `src/db/org-scope.ts` — additive `connections.markSynced`.
- No changes to schema, migrations, credentials row format, metric catalog,
  attribution ladder, tracked_user, or any existing route/shape.

## Workstreams to re-sync
- **W1-S:** add the two new routes to contract tests; the ingest request
  schema is the new seam between the CLI package and the server.
- **W1-G / W2-H:** the connect-Claude-Code onboarding flow calls
  `connectionAgentTokenCreate` and shows the token once.

## Consequences
- The CLI (separate package, `packages/revealyst-agent`) builds against the
  frozen `metricRecordInputSchema`/`subjectDaySignalInputSchema` and this
  ingest contract; a repo-side contract test validates a recorded CLI batch
  against these zod schemas so drift fails CI.
- Re-issuing a token invalidates the previous one (credential upsert per
  connection+kind) — documented CLI behavior.
- Ingest is idempotent end-to-end: re-pushing the same window overwrites via
  the frozen `metric_records` natural upsert key.
