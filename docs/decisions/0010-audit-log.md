# 0010 — Basic audit log (W3-O hardening)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Deciders:** Founder (W3-O kickoff: "table + read API, no UI")

## Context

W3-O's scope includes a "basic audit log". Actor tracking today is piecemeal,
embedded in domain tables (`identities.created_by_user_id`,
`invites.invited_by/accepted_by`, `share_links.created_by_user_id`), and
several sensitive mutations leave **no user-attributed trace at all**:
identity **unlink** is a hard delete, team create / membership changes,
connection create, credential entry, manual poll triggers, and consent
toggles record nothing about who did them. A CTO buying a monitoring tool
for their org reasonably expects "who changed what" to be answerable, and
the W3-N compliance content (DPIA guidance) is more credible when the
product itself keeps an accountability trail.

Adding a table changes the frozen `src/db/schema.ts` + `drizzle/**`, hence
this ADR (rule 1). The change is purely **additive** — no existing table,
column, or contract type is modified.

## Decision

1. **One append-only `audit_log` table**, following the standard org-scoped
   shape (composite tenant-FK anchor, like `connector_runs`):
   - `id`, `org_id` (+ `unique(org_id, id)` anchor), `actor_user_id`
     (`text references user.id on delete set null` — the
     `identities`/`share_links` convention; null = actor account deleted),
     `action` (text, dot-namespaced verb e.g. `identity.unlink`,
     `connection.create`, `team.set_members`), `target_kind` + `target_id`
     (text; loose reference by design — an audit row must OUTLIVE its
     target, so no FK to the target and no cascade from it), `metadata`
     jsonb (small, non-sensitive detail: e.g. the unlinked subject/person
     pair), `created_at`; index on `(org_id, created_at)` for the read path.
   - **Append-only:** the repository exposes `record` + `list` only — no
     update, no delete. Rows survive target deletion.
   - **Never store secrets or payloads** in `metadata`: ids, enum-ish
     strings, and short labels only. Credential values, tokens, and vendor
     payloads are banned (same posture as the encrypted-credential
     contract).
2. **Repository:** a new `auditLog` sub-repo inside `forOrg` (org-scope.ts)
   — additive; no existing public method changes. Writes happen in the same
   request as the mutation they describe (no queue hop for a basic log).
3. **Write path:** the ~14 user-initiated mutations wire a `record()` call
   at the route/impl layer where `ctx.user.id` is in scope. Machine actions
   (poller, agent ingest) are NOT audited here — they already have
   `connector_runs` as their per-attempt log.
4. **Read path:** `GET /api/audit` — org-scoped, **admin-only**, paginated,
   newest-first. No UI in V1 (founder decision); the endpoint is the
   evidence surface.

## Contracts affected

- `src/db/schema.ts` + `drizzle/0016_audit-log.sql` — additive table only.
- `src/db/org-scope.ts` — additive `auditLog` sub-repo on the existing
  `forOrg` return object. No signature or semantic change to any existing
  method.
- No `src/contracts/**` change: the audit log is an ops/product surface,
  not a scoring/connector contract. Route shape lives with the route.

## Workstreams to re-sync

- **W1-S (seams):** `tests/tenant-isolation.test.ts` completeness tripwire
  picks the new table up in the same PR (sweep entry added).
- **W2-L (team dashboard):** none — no UI in V1; a later admin view can
  read `/api/audit`.

## Consequences

- Audit rows accumulate unboundedly for now (same posture as
  `connector_runs` / `poll_heartbeats`); retention is a documented ops
  follow-up, not a launch blocker at V1 write volume (user-initiated
  actions only — a few rows per admin session, not per poll).
- `target_id` is a loose text reference: consumers must tolerate targets
  that no longer exist. That is the point — the trail outlives the object.
- Actions added later must remember the write. The tenant-isolation sweep
  guards the table's scoping, and the review invariant "diff a new call
  site against its siblings" (CLAUDE.md) covers new mutations; a mechanical
  completeness check is out of scope for a *basic* log.
