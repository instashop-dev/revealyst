# 0051 — Workspace switching: `org_members.last_active_at` (amends ADR 0004)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Platform-admin team-workspace unblock workstream (adversarial
  review finding #1 on the `p4-admin-team-org` build), coordinator-directed.

## Context

ADR 0004 set the active-org resolution rule — *most-recent membership wins*
(`orgContextForUser` orders by `org_members.created_at` DESC) — and explicitly
deferred an org switcher ("An org switcher is future work"). The platform-admin
team-workspace unblock ships that switcher. Its first cut reused the rule
verbatim by **rewriting `created_at`** on the chosen membership.

Adversarial review rejected that reuse as an invariant-(b) violation:
`created_at` is rendered as the **"Joined"** date in Settings → People
(`orgMembersList`, `src/db/invites.ts`) and as membership recency in the
platform-admin user views (`src/db/admin.ts`). Rewriting it on every switch
turns a rendered claim ("joined 3 months ago") false and reshuffles the
roster's join order. A rendered date is a claim surface, exactly like a
rendered number.

`drizzle/**` is frozen, so the column addition requires this ADR (rule 1).

## Decision

- **New nullable column** `org_members.last_active_at timestamptz`
  (`src/db/auth-schema.ts`, migration **0041** — a single additive
  `ALTER TABLE ... ADD COLUMN`, no backfill, no index: the resolver scans one
  user's memberships, a per-user handful of rows already served by
  `org_members_user_id_idx`).
- **Resolution rule (amends ADR 0004):** the active org is the membership with
  the greatest `coalesce(last_active_at, created_at)`, ordered DESC, **with a
  deterministic `org_id` DESC tiebreak** (timestamps can tie; an unstable
  active org across requests would flap the whole app shell). Both resolvers
  (`orgContextForUser`, `orgContextForSessionToken`) and the switcher's
  `membershipsForUser` listing use the same expression, so list order and
  resolution can never disagree.
- **`created_at` is immutable** — it is the join-date record. The switcher
  (`switchActiveOrg`) writes `last_active_at = now()` only.
- **Invite acceptance is unchanged and needs no write here:** a fresh
  `org_members` row has `last_active_at NULL` and a brand-new `created_at`, so
  `coalesce` still lands the invited user in the inviting org on next load —
  ADR 0004's behavioral contract holds byte-for-byte for single-switch-free
  users (all rows NULL ⇒ ordering identical to the old rule).
- The frozen `membershipForUser` (`org-scope.ts`) keeps its earliest-first
  order and remains only the bootstrap existence check inside `ensureOrgOfOne`
  — `org-scope.ts` is NOT modified. Call sites that need the ACTIVE org must
  use the `orgContextForUser` seam (the agent-token route was migrated to it
  in this same build).

## Contracts affected

- `src/db/auth-schema.ts` (`org_members` + one nullable column) and
  `drizzle/0041_org-members-last-active.sql` — additive only.
- No API contract change: `/api/org/workspaces` (non-frozen, colocated schema)
  is the only writer; `/api/me` shape untouched.
- No new table ⇒ no tenant-isolation/purge registration (three-registration
  law applies to tables, not columns; `org_members` cascades on user delete
  already).

## Workstreams to re-sync

None building against `org_members` today besides this one; the admin
list/detail views read `created_at` for membership recency, which stays
truthful ("joined") under this decision.
