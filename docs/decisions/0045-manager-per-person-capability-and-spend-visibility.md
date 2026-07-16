# 0045 — Manager visibility of named per-person capability and spend data

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team Capability Intelligence roadmap, Phase 2 (founder-signed
  decisions **D-TCI-1** and **D-TCI-2**, `docs/product-signoffs.md`) — a
  **founder-signed privacy reversal** on the ADR-0038 mold.
- **Implemented (team_settings): PR `p2e-team-settings`** — the `team_settings`
  table sketched in "Consent / visibility machinery" below shipped as plumbing
  only (migration `0039_team-settings`, `src/db/schema/core.ts`, the
  `forOrg().teamSettings` `get`/`set` namespace, and the three registrations).
  This ADR is that build's governing document — no new ADR number was minted (the
  sketch's "under its own ADR" line is read as "under this ADR's authority"). The
  admin toggle UI and the manager spend-read consumer ship in a later workstream;
  no inert control renders from this PR.
- **Implemented (capability half):** P3-A, branch `p3a-manager-drill-in` (PR
  pending). Ships the manager per-person capability drill-in only: the new
  manager-scoped read `mastery.forManagedPerson` (org-scope frozen path — this
  ADR is that PR's required same-PR change), the `/team` roster + `/team/[personId]`
  drill-in surfaces (managed/full only; `notFound()` in private mode and for any
  non-manager, incl. admins-without-a-grant), a manager-only entry card on the
  team dashboard (the count-only 5-card fold is untouched, D-TCI-5), and the
  manager-authorized identity-surface registry in `src/lib/visibility.ts`. The
  **spend half** (D-TCI-2, the `team_settings` toggle) and its table stay a
  separate later workstream — no schema/migration in this build. The self-view-
  only rec/coaching/exposure/mission surfaces are untouched (V4 NOT-list).

## Context

Per-person capability mastery is **self-view-only** today, by signed decision:
`user_capability_state` has no manager/other-person read route
(`src/db/org-scope/mastery.ts:6-15`, ADR 0036), it is structurally excluded from
the team-visible view (ADR 0038 constraint 2), team surfaces are aggregate and
count-only with a `MIN_PEOPLE` floor, and in `private` visibility mode identity
is pseudonymized for everyone (`assertTeamOnlyPseudonymized`,
`src/lib/visibility.ts`). Spend is aggregate/org-level only
(`src/lib/spend-governance.ts`). The `team_managers` manager tier (ADR 0044)
exists but confers **no** per-person data visibility.

The TCI roadmap's manager surfaces (member capability profile, cohort→named
coaching drill-in, per-member spend) all assume a manager reads an individual's
capability and spend **by name**. That reverses a load-bearing, founder-signed
stance — the self-view-only boundary is the product's stated mechanism for
voluntary individual adoption (the V4 bottom-up bet). A reversal therefore needs
a founder-signed ADR before any surface exists, exactly as ADR 0038 did. The
founder signed the two governing rows on 2026-07-16:

> **D-TCI-1 — Ratified (override) 2026-07-16 — Founder: YES**, managers may see
> named per-person capability data. Build still requires the ADR-0038-mold ADR
> first (consent machinery in the visibility framework, per-surface identity
> registration, manager-vs-member authz test matrix, purge/tenant
> registrations) — the sign-off unblocks scheduling, the ADR governs the how.

> **D-TCI-2 — Ratified (override) 2026-07-16 — Founder: YES**, managers may see
> named per-person spend — behind the TCI §10 admin visibility toggle, default
> OFF, honestly labeled with allocation confidence (per-model dollar splits stay
> excluded: no vendor reports them, invariant b).

This ADR is that governing document. It **authorizes** the later build PRs; it
ships **no schema or code** itself.

## Decision

### What becomes manager-readable

A **manager** (an org member with a `team_managers` row for the team, ADR 0044),
scoped to **their own teams' members only**, may read, as a drill-in surface
separate from the count-only team dashboard:

1. **Per-person capability mastery / profile** — the `user_capability_state`
   read surface (`mastery` namespace) for a person on a team the caller manages:
   mastery band, confidence tier, evidence count, per-signal components,
   next-focus. A NEW manager read method (e.g. `mastery.forManagedPerson`)
   authorizes on `(org, person ∈ managedTeamMembers)`; the existing self-view
   `forPerson`/`forUser` methods are unchanged.
2. **Per-person spend** — a person's spend facts (from `metric_records` /
   `spend-governance`), aggregated to the person, for a managed-team member —
   **only** when the per-team admin toggle is ON (below).

### What stays self-view-only FOREVER

The V4 NOT-list line remains in force, quoted exactly from
`docs/Revealyst_Product_Spec_V4.md:641-642`:

> No manager visibility into any individual recommendation, coaching content, or
> interaction state (code-enforced).

Concretely, **no** manager read is ever added for: `rec_interaction_state`
(ADR 0028/0043), `recommendation_exposure` (ADR 0038), or coaching interaction
state. This ADR reverses the stance for **mastery and spend only** — the
recommendation/coaching/interaction surfaces are explicitly out of scope and
their self-view-only tests must stay green.

### Who counts as a manager — and admins do NOT get per-person reads

- A manager is derived per ADR 0044 (`team_managers` row → `managedTeamIds`
  seam, `src/lib/api-context.ts:90`), scoped to **their teams' members only** —
  never org-wide, never another manager's teams.
- **Admins do not automatically gain per-person capability/spend reads.** The
  minimal, defensible surface is *managers-of-that-team only*. An admin who needs
  a person's per-person view assigns themselves a `team_managers` grant (an
  audited action, ADR 0044) — making the access explicit and revocable rather
  than an ambient super-power. This keeps the identity-bearing surface as small
  as the product allows (minimal-by-default) and means "who can see person X's
  mastery" is answerable by listing X's team's managers.

### Consent / visibility machinery

Routes through the existing visibility framework (`src/lib/visibility.ts`,
`src/lib/visibility-playbook.ts`):

- **`private` mode stays pseudonymized/count-only** — manager per-person reads
  are **UNAVAILABLE** in private mode (the EU-safe default;
  `assertTeamOnlyPseudonymized` still holds). A manager per-person read requires
  the org to be in `managed` or `full` mode, in which real names already surface
  workspace-wide (not selectively — the playbook deliberately claims no
  managed/full data-layer difference, invariant b).
- **Spend additionally requires the per-team admin toggle** — capability reads
  need only manager + managed/full; **spend** needs manager + managed/full **AND**
  `managers_see_individual_cost = true` for that team. Default **OFF**.

The toggle lives in a **future `team_settings` table** (TCI-DATA-007,
TCI-PRIV-005) that a later P2-E build ships under its own ADR + three
registrations. Minimal contract sketch so that build has a target:

```
team_settings
  org_id                        uuid    (tenant)
  team_id                       uuid    -- UNIQUE(org_id, team_id)
  managers_see_individual_cost  boolean NOT NULL DEFAULT false
  created_at / updated_at
  composite tenant FK (org_id, team_id) -> teams(org_id, id) ON DELETE CASCADE
```

**Every new identity-bearing surface must register** in the
`TEAM_VISIBLE_IDENTITY_SURFACES` / `IDENTITY_BEARING_MANIFEST` registry
(`src/lib/visibility.ts`) if it can ever reach the team-visible view. The manager
drill-in is a **separate** authorized surface (not the private-mode team view),
so it is not gated by `assertTeamOnlyPseudonymized` — but any field of it that
could fold back into `TeamVisibleView` must be manifest-registered, and the
manager-read authorization is proven by the authz test matrix (below), not by
the pseudonymization predicate.

### Honesty constraints for spend (invariant b)

- **Allocation confidence is always shown** — a per-person spend number carries
  its allocation method + confidence; unallocatable spend is disclosed as an
  **unallocated bucket**, never silently dropped or spread.
- **Per-model dollars are never rendered.** No connected vendor reports per-model
  spend; the model drill-down is token volume, "explicitly NOT a dollar split"
  (`src/lib/spend-governance.ts:15,317`). Rendering per-model dollars would
  fabricate a number (invariant b). This exclusion stands even behind the toggle.
- Cost is never folded into a capability score (existing law, TCI-MET-001).

## Contracts affected

- **`src/db/org-scope.ts` public API** — a new **manager-scoped** read method on
  the `mastery` namespace (and a spend equivalent); the existing self-view
  methods are unchanged. Frozen path → this ADR is the required same-PR change
  (rule 1) for the build.
- **`src/db/schema/**` + `drizzle/**`** — the future `team_settings` table
  (its own migration + ADR-linked registrations at build time; sketched here,
  not created).
- **`src/lib/visibility.ts`** — the identity-surface registry gains an entry only
  if a manager-read field can reach `TeamVisibleView`.
- Not affected: `tracked_user` semantics, credential shape, `connector-facts.md`,
  the frozen score engine, and the self-view-only rec/coaching/exposure surfaces
  (unchanged — this reversal is scoped to mastery + spend).

## Workstreams to re-sync

- **TCI Phase 2/3** manager-surface builds (member profile, cohort→named coaching
  drill-in, per-member cost) — build against this ADR's authorization rule.
- **Privacy/tenancy seam owner (W1-S)** — the authz test matrix + identity-surface
  registry changes land with the build PR.
- **W6-A gate holders** — see the interaction note below; per-person **manager
  read** surfaces are unblocked, the **member companion-in-team-orgs** experience
  is not.

## Required guard rails BEFORE any surface ships

1. **Manager-vs-member-vs-admin authorization test matrix** — extend
   `tests/team-managers-api.test.ts` (the seed; it already proves admin
   succeeds / member 403 / non-admin manager 403 on *assignment*). The extension
   must prove, per new read surface: a manager reads **only** their managed
   team's members; a manager cannot read a member of a team they don't manage;
   a plain member cannot read any peer; an admin (without a grant) cannot read
   per-person mastery/spend; a person's own self-view is unchanged.
2. **Self-view tests stay green.** `tests/exposures.test.ts` and the rec/coaching
   self-view tests must **not** change — those surfaces are not reversed.
   `tests/dashboard-privacy.test.ts` adapts **only** to assert that `private`
   mode still throws on names and that the new manager drill-in is unreachable in
   private mode; its core assertion — the private-mode team view leaks no
   identity — must NOT be weakened.
3. **Purge/tenant registrations** for any new table (`team_settings`): a
   `tests/tenant-isolation.test.ts` `SCOPED_READS` entry with a non-vacuous
   B-org seed, this ADR's successor row, and a `src/db/account-deletion.ts`
   `PURGE_TABLES`/`PURGE_EXEMPT_TABLES` registration.
4. **Banned-phrasing sweeps** extended over all new manager copy (no
   ranking/leaderboard/performance-verdict language; anti-deficiency framing).
5. **Per-person numbers NEVER appear on the count-only team dashboard cards**
   (D-TCI-5). The 5-card team view stays aggregate + `MIN_PEOPLE`-floored; the
   manager per-person read is a **separate drill-in surface**, not a change to
   the 5-card fold.

## W6-A interaction

Specifying this now, and building the manager **READ** surfaces, is allowed
**pre-gate**: it is a *manager lens over already-computed data*, not the
member-facing companion. The **member companion-in-team-orgs** experience stays
gated on the ~6-week dogfood clock (running since 2026-07-14, matures
~2026-08-25) and its own §9.4 sub-case-C ADR. This ADR does not touch that gate.

## Consequences

- A manager can see a managed-team member's capability profile (always) and spend
  (behind an admin toggle, default off), with confidence/allocation disclosed and
  per-model dollars still excluded — without exposing any recommendation,
  coaching, or interaction state, and without per-person numbers reaching the
  count-only team dashboard.
- **Trust risk (named — gap analysis §10, "privacy-model whiplash").** This
  reverses the product's central self-view-only trust promise for two data
  classes. The mitigation is structural: the decision gate (these signed rows),
  the authorization matrix as a merge precondition, admins-need-a-grant (no
  ambient super-read), and private-mode remaining fully pseudonymized. If the
  member-adoption bet suffers, the reversal is bounded to mastery + spend and can
  be re-scoped without touching the rec/coaching surfaces it left untouched.
- The bypass named in ADR 0038 (audited, time-boxed platform-staff
  impersonation) is unchanged and is not what this ADR adds — this adds a
  *manager* read path, governed by the toggle and the team grant.
