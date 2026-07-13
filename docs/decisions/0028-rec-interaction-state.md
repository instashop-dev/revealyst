# 0028 — Recommendation interaction state (Outcomes-loop forerunner)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W5-D (founder-directed)

## Context

W5-C gave coaching recommendations a dedicated home (the `CoachingCard`), but
they were fire-and-forget: a person could not act on one, and the weekly digest
would keep re-mailing a rec the person had already decided to ignore. Spec V4
§8.3 wants the first step of the Outcomes loop — the ability to snooze, dismiss,
or mark-tried a recommendation — with a hard privacy rule: a person's reaction
to their own coaching is **self-view only**, never on a manager-visible surface
(§8.3, the NOT-list).

Storing that reaction needs a new org-scoped table, and the write path needs a
route. Both are frozen contracts (`src/db/schema.ts` + `drizzle/**`, and
`src/contracts/api.ts`), so the addition is ADR-gated (rule 1) even though it is
purely additive.

## Decision

Add a person-scoped table **`rec_interaction_state`** (migration `0024`):

- Columns: `org_id`, `person_id`, `rec_id` (text — the STABLE static-map id from
  `src/lib/coaching-recommendations.ts`, chosen so it survives the future W6-C
  catalog migration unchanged), `state` (pg enum `rec_interaction_state`:
  `snoozed | dismissed | tried`), `acted_at`, `snooze_until` (nullable — set
  only for snoozes; the rec resurfaces once it passes), `created_at`,
  `updated_at`.
- Primary key `(org_id, person_id, rec_id)` — one state per person per rec;
  `org_id` sits IN the key so cross-org rows are unrepresentable.
- Composite tenant FK `(org_id, person_id) → people(org_id, id)` `ON DELETE
  CASCADE` — a person from another org is unrepresentable; state is torn down
  with the person.

Reads go through a new `forOrg` namespace `recInteractions`
(`src/db/org-scope/rec-interactions.ts`): `list(personId)`,
`statesForUser(authUserId)` (resolves the caller's own person by
`people.auth_user_id`, the self-view fold-in for the companion page),
`dismissedRecIdsForOrg()` (digest-only, personal lane), and `set(...)` (upsert
on the PK).

Add ONE frozen route to `src/contracts/api.ts`: **`recInteractionSet`** —
`POST /api/recommendations/interaction`, served via `handleApi`/`appContext`
(the 402 free-band gate applies by default; NOT opted out). Self-view is
code-enforced: the handler rejects (403) unless `personId` is the caller's own
person (`people.auth_user_id === session user`), mirroring the share route. No
audit-log entry is written — audit is manager-visible, so logging "person X
dismissed rec Y" would itself be the leak this feature forbids.

Digest respect: the personal-lane digest folds `dismissedRecIdsForOrg()` into
its existing flat `Promise.all` and filters dismissed rec ids out of the
recommendation lane, so a dismissed rec never re-mails. The team lane (aggregate
recommendations, not one person's) does not read per-person dismissals.

Companion affordances: `AttentionItem` gains an optional `recId` (set only on
recommendation items), letting the `CoachingCard` attach snooze/dismiss/
mark-tried buttons — rendered only when the caller passes a `personId` (personal
self-view). Dismissed and un-expired-snoozed recs are filtered server-side
before render.

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — new enum `rec_interaction_state`, new
  table `rec_interaction_state`, migration `0024_rec-interaction-state.sql`
  (additive; no existing shape changed).
- **`src/contracts/api.ts`** — new route contract `recInteractionSet`
  (additive; no existing route changed). `AttentionItem` (in
  `src/lib/score-insights.ts`, not a frozen contract) gains an optional,
  backward-compatible `recId` field.
- Tenancy layer: new namespace on `forOrg` (`src/db/org-scope.ts`) — the public
  API grows by one member; existing members byte-for-byte unchanged.
- Not affected: `tracked_user` semantics, credential shape, metric catalog,
  `connector-facts.md`.

## Workstreams to re-sync

- **W5-C** (companion surface): `CoachingCard` gained `personId`/`triedRecIds`
  props and per-rec affordances — additive, existing call unaffected.
- **F2.2 digest** (`src/poller/digest.ts`, `src/lib/digest-content.ts`): another
  workstream also edits the digest coaching lane. The dismiss-filter is a narrow
  addition — one extra read folded into the existing `Promise.all`, one
  `.filter(...)` in `assembleDigest` gated on the new optional `dismissedRecIds`.
  Rebase the two edits independently; they do not overlap logically.
- **W6-C** (future recommendation catalog): `rec_id` is the stable static-map
  id, so a catalog migration must preserve those ids or provide a remap.

## Consequences

- The three-registration law is satisfied in this PR: `tests/tenant-isolation`
  `SCOPED_READS` (+ a non-vacuous B-org seed row), an ADR (this file), and
  `src/db/account-deletion.ts` `PURGE_TABLES` (person-scoped, FK to people →
  purged before `people`).
- `rec_interaction_state` is deliberately absent from
  `TEAM_VISIBLE_IDENTITY_SURFACES`: it is never on a manager-visible surface, so
  it is not a manager-visible identity leak to register — the self-view rule is
  enforced by the absence of any read route + the ownership check on the write
  route.
- v1 has no "un-dismiss" affordance; a dismissed rec is gone from the card until
  a future clear. Snooze expiry is the only automatic resurfacing.
