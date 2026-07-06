# 0004 — Invite flow: invites table, membership org-resolution rule

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Founder (via W1-G session)

## Context

W1-G's charter includes "invite flow, roles (admin/member)". The frozen
schema has `org_members` with the role enum, but nothing that represents a
*pending* invitation, and the frozen `api.ts` deliberately shipped no invite
routes (the W0-C contract covered dashboard read surfaces; membership
provisioning was left to the workstream that owns it). Two gaps force a
post-freeze change:

1. **No invites table.** An invite must outlive the admin's session, be
   revocable, expire, and be auditable — that's a row, not a signed link.
   Adding a table means touching the frozen `src/db/schema.ts` +
   `drizzle/**` paths (rule 1 → this ADR).
2. **Multi-membership was unrepresentable in behavior.** Every signup gets
   a personal org (org-of-one); accepting an invite adds a second
   membership. `membershipForUser` (frozen `org-scope.ts`) picks the
   *earliest* membership, which would pin an invited user to their personal
   org forever — the invite would appear to do nothing.

## Decision

- **New `invites` table** (schema + migration 0011): `id`, `org_id` (FK),
  `email` (lowercased addressing hint), `role` (`admin|member`),
  `token_hash` (SHA-256 of a random secret; plaintext returned exactly once
  at creation), `invited_by_user_id`, `expires_at` (14-day default),
  `accepted_at` / `accepted_by_user_id`, `revoked_at`, `created_at`.
  At most one *pending* invite per (org, email) via partial unique index.
- **Token possession redeems the invite.** The email field addresses the
  invite; it is not an acceptance precondition (V1 has no email delivery —
  admins copy the link). `accepted_by_user_id` records who actually
  redeemed. Acceptance is idempotent per user and creates the
  `org_members` row with the invite's role.
- **Org-resolution rule: most-recent membership wins.** The app resolves a
  user's active org via `orgContextForUser` (src/db/org-context.ts, the
  non-frozen companion introduced in W1-G PR 1), which now orders by
  membership `created_at` DESC. Accepting an invite therefore lands the
  user in the inviting org on next load. The frozen `membershipForUser`
  keeps its earliest-first order — it remains only the bootstrap existence
  check inside `ensureOrgOfOne` (any membership suppresses re-bootstrap),
  so `org-scope.ts` is NOT modified. An org switcher is future work; until
  then the personal org of an invited user is dormant, not deleted.
- **Invite operations live in `src/db/invites.ts`** (new module in the
  schema zone), not in frozen `forOrg`: `invitesForOrg(db, orgId)` →
  create/list/revoke, plus pre-scope `acceptInvite(db, token, user)` and
  `orgMembersList(db, orgId)`. Folding these into `forOrg` can ride the
  next org-scope ADR; keeping frozen-file churn at zero was preferred here.
- **New app routes** (additive, not part of frozen `api.ts`):
  `GET/POST /api/org/invites`, `DELETE /api/org/invites/:id` (admin-only),
  `GET /api/org/members`, `POST /api/invites/accept`, and the
  `/invite/[token]` accept page.

## Contracts affected

- `src/db/schema.ts` + `drizzle/0011_*` — **additive** `invites` table.
  No existing table, column, index, or upsert key changes.
- `src/db/org-scope.ts` — untouched.
- `src/contracts/api.ts` — untouched (new routes are app-level; if W2
  dashboards need them they graduate into the contract then).
- `tracked_user` semantics — untouched (invites concern *auth users*, not
  tracked people; billing is unaffected).

## Workstreams to re-sync

- **W1-S** — done in this PR: `invites` registered in the isolation-sweep
  registry (tests/tenant-isolation.test.ts) and `invites.token_hash` added
  as a documented digest exemption to the credential-shape invariant
  (tests/credentials.test.ts). Fixture graphs may want invite rows later.
- **W2-H onboarding** — signup → accept-invite path exists now; the
  onboarding flow should link through `/invite/[token]` semantics rather
  than invent its own.
- W1-D/W1-E/W1-F — no impact (no connector, ingest, or scoring surface
  changes).

## Consequences

- Invited users hold two memberships; "most recent wins" is a stopgap that
  an org switcher (W2+) will supersede. Documented trade-off: after
  accepting, a user's personal-org data is temporarily unreachable in the
  UI (still intact in the DB).
- Anyone holding an unexpired invite link can join the org — acceptable
  V1 posture given links are copied by admins into private channels;
  revocation + 14-day expiry bound the exposure. Revisit if/when invite
  emails ship.
- One more pre-scope query surface (`src/db/invites.ts`) beside
  `org-context.ts`; both are schema-zone modules reviewed under the same
  tenancy rules as `org-scope.ts`.
