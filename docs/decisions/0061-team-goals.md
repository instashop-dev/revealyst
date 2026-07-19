# 0061 — Team goal / review period (`team_goals`)

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** Team Manager Dashboard workstream (TMD Phase P1, T1.1); founder
  plan approval (the "Team AI Operating System" execution plan §P1).
- **Builds on:** **ADR 0050** (`team_insights`: the org-scoped, optional-`team_id`,
  composite-tenant-FK manager surface this mirrors exactly) and the frozen
  **`score_slug`** contract (the goal metric is a closed union over those slugs).

## Context

The Team Manager Dashboard is completing the manager loop: **goal → diagnosis →
recommended action → execution → measured outcome**. Phase P0 restructured the team
`/dashboard` into a conclusion-first "Command Center" but left an empty **goal slot**
at the top of the page. The page has no notion of a manager-chosen objective, so it
cannot say *which* metric matters right now or bias which priority shows first.

P1 adds that missing spine: **one manager-set objective** — a metric, a baseline, a
target, a review date, and an owner. This ADR covers **P1a, the data layer only**
(schema + migration + namespace + validation lib + the three registrations). The
setter drawer, the goal-biased priority ordering, and the header progress line are
**P1b**, a separate PR — none of them ship here.

## Decision

Add an **org-scoped `team_goals` table**, modelled exactly on `team_insights`
(ADR 0050): an optional `team_id` (NULL = the org-wide goal, the common case), a
composite tenant FK `(org_id, team_id) → teams(org_id, id) ON DELETE CASCADE`
enforced only when `team_id` is non-null (MATCH SIMPLE), and no FK from `org_id` to
`orgs` (account deletion purges these rows explicitly).

1. **Closed-enum metric, stored as text (mig 0048).** `metric_slug` is a **closed
   union** (`adoption | fluency | efficiency`) validated in code
   (`src/lib/team-goal.ts`, reusing the single source of truth `SCORE_SLUGS`), **not
   a pg enum**. This keeps the tripwire honest (no free-form/formula metric) while
   leaving a future capability-slug target additive — widen the array + guard, no
   enum migration. The goal never widens the frozen `score_slug` values.

2. **Honest, manager-set values (invariant b).** `baseline` is **nullable** — when
   the current measured value of the chosen metric is unknown we store NULL and
   withhold it, never a fabricated 0 ("no data yet" ≠ "measured zero"). `target`,
   `review_date`, and `owner_user_id` are manager-set; the P1b UI labels them as the
   manager's own input, not a Revealyst measurement or promise (the renewal-date
   "unverifiable" labeling precedent).

3. **One active goal per scope, enforced two ways.** Application: `setActive`
   archives the current active goal then inserts the new one in **one transaction**
   (`src/db/org-scope/goals.ts`, the archive-then-insert CAS, mirroring
   `budget-alert-state`'s compare-and-set posture). Database: **two partial unique
   indexes** — `WHERE status='active' AND team_id IS NOT NULL` for team-scoped goals,
   and `WHERE status='active' AND team_id IS NULL` for the org-wide goal. The two
   cases are split because `NULLS NOT DISTINCT` is unavailable on a partial unique
   index in drizzle 0.45 / this pg build, so a single `(org_id, team_id)` unique
   index would treat two NULL `team_id`s as distinct and let two org-wide active
   goals coexist. Splitting is the clean, explicit guard against a concurrent or
   redelivered double-insert.

4. **Not a self-view surface.** `team_goals` holds no per-person data beyond
   `owner_user_id` (the manager's OWN auth user id). It is a manager-scoped objective;
   it does not read or widen any self-view table (`rec_interaction_state`,
   `recommendation_exposure`, missions), which stay self-view-only forever.

## Contracts affected

- **`src/db/schema/goals.ts`** (new) — `team_goals` + the `goal_status` enum
  (`active | met | archived`); exported from the `src/db/schema.ts` barrel after
  `team-insights` (frozen-path change, hence this ADR).
- **`src/db/org-scope.ts`** (frozen public API) — additive `forOrg().goals`
  namespace (`getActive` / `list` / `setActive`), factory in
  `src/db/org-scope/goals.ts`.
- **`src/lib/team-goal.ts`** (new) — the closed-enum metric contract + zod schema +
  guard, reused by the namespace and (P1b) the setter route.
- **Three registrations:** `tests/tenant-isolation.test.ts` (`goals.list` SCOPED_READS
  entry + a non-vacuous B-org active-goal seed) · `src/db/account-deletion.ts`
  (`teamGoals` in `PURGE_TABLES`, ordered before `teams`) · this ADR.

## Non-goals / what stays for P1b

- The goal **setter drawer** (T1.2), the **goal-biased priority ordering** in
  `deriveAttention` behind an output-equivalence guard (T1.3, gated on **OQ-TMD-2** —
  ratified as *display + tie-break only, never eligibility*), and the **header/brief
  progress** line (T1.4). None touch `deriveAttention` or the perf query budget in
  this PR — P1a adds no dashboard read.

## Workstreams to re-sync

Team Manager Dashboard P1b (consumes `forOrg().goals` for the setter + header) and
P2 (initiatives reference a goal). No other workstream reads this table.
