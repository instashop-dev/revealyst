# 0063 — Initiative decision log

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Team Manager Dashboard plan, phase P3 tail T3.2
  (`docs/Revealyst_Team_Manager_Dashboard_Execution_Plan.md`). Founder
  kickoff decision (this session): "new table" for the decision log.
- **Implemented:** branch `tmd-p3-tail` — migration **0050**
  (`initiative_decisions` in `src/db/schema/initiatives.ts`), the decision
  methods on the existing `forOrg().initiatives` namespace
  (`src/db/org-scope/initiatives.ts` — org-scope frozen path, this ADR is the
  required same-PR change), the api-impl surface (`readInitiativeDecisionLog` +
  `addInitiativeDecision`, plus auto-record in
  `launchInitiative`/`recordInitiativeOutcome`/`stopInitiative`), the
  `GET`/`POST /api/initiatives/:id/decisions` route, and the
  `InitiativeDecisionLog` component embedded in the review drawer.

## Context

The manager loop (goal → initiative → measured outcome) shipped in TMD P1–P3
(#325–#330). The loop can record WHAT an initiative aimed at and its measured
before/after, but not the manager's own account of WHAT WAS DECIDED and WHY
along the way — the "decision log" of analysis §14. Today
`initiatives.status_changed_at` stamps only WHEN status last changed; who
changed it and their reasoning are lost.

The plan (T3.2) floated two shapes: reuse `manager_notes`, or a dedicated
event/status trail on `initiatives`. `manager_notes` is keyed on `person_id`
(a coaching journal ABOUT a person); a decision log is keyed on `initiative_id`
(a record ABOUT an effort). Reusing the person-scoped table would force an
initiative record into a person row it does not describe. So this ADR adds a new
table — the founder's kickoff decision.

A decision log is a **management artifact**, not telemetry: like `manager_notes`
it is neither a metric input nor derived from one, and the honesty invariants
apply to the fixed UI copy around it, not to a note body a manager typed.

## Decision

Add `initiative_decisions` (migration 0050): `id`, `org_id`, `initiative_id`,
`author_user_id`, `event` (enum), `note` (nullable text), `created_at`.

### Append-only — an audit trail, not a mutable document

There is **no `updated_at` and no edit/delete flow**. This is a deliberate
contrast with `manager_notes` (which allows an author-delete): those are a
private coaching journal a manager curates; this is a factual record of what
happened to a shared effort. To correct a note, a manager adds a follow-up
`noted` entry — the trail stays honest about what was recorded when. Append-only
also means the lifecycle events (launched/completed/stopped) can never be edited
away, so the log always agrees with the initiative's real history.

### The `event` enum — closed, four values

`launched` / `noted` / `completed` / `stopped`. Three are **auto-recorded** by
the existing write paths (`launchInitiative`, `recordInitiativeOutcome`,
`stopInitiative`) with a null note — the event IS the meaning, and the outcome
of a `completed` initiative lives on `initiatives.outcome`, never duplicated
here. `noted` is the only manager-entered event; its `note` holds the manager's
own words. A closed enum (not free-form text) keeps the log structured and is
the anti-gamification posture below.

### Author is a plain text id — no FK to `user` (survives departure)

`author_user_id` is a plain `text` auth-user id with **no foreign key to
`user`**, exactly like `initiatives.owner_user_id` and `team_goals.owner_user_id`.
`manager_notes` cascades a note away when its author's account is deleted (a note
is a personal opinion). A decision log is different: a hard author cascade would
erase lifecycle rows like `launched` the moment the launching manager deleted
their account — silently losing the initiative's history. Keeping a plain id
preserves the trail; a departed author's name simply resolves to a neutral
fallback ("A former manager") at read. This matches the initiatives posture,
where an owner id likewise survives its owner's account deletion.

### Authorization — owner-OR-admin, both read and write

The read (`readInitiativeDecisionLog`) and the note write
(`addInitiativeDecision`) both require the caller to be the initiative's **owner
or an org admin** — the SAME authz as the P3 review (`recordInitiativeOutcome`).
A missing/other-org initiative is 404; a non-owner non-admin manager is 403.
This deliberately mirrors the review route rather than the roster's owner-only
404-collapse: the count-only initiatives card already reveals that initiatives
exist, so a 403 confirms nothing new, and an admin needs the log for support.

### Impersonated writes blocked (403)

A platform admin impersonating a user (ADR 0016) may READ (support), but
CREATING a note while impersonating would mint a persistent, author-attributed
record in the user's name that the user never wrote — the same reasoning that
blocks impersonated reviews and workspace creation. The POST route throws 403
`forbidden while impersonating` before any authorization work.

### Never feeds scoring

The table + its namespace methods are structurally isolated from every metric
path — no scoring / `deriveAttention` / capability-state module imports them,
pinned by `tests/initiative-decisions-scoring-isolation.test.ts` (a
decision-specific import grep, the `manager_notes` isolation pattern). The
schema comment states it; the test enforces it.

### Anti-gamification (R3)

No points/xp/streak/league/level/badge column — a decision is a record, not a
score. Pinned by the existing initiatives schema-shape sweep
(`tests/initiatives.test.ts`), extended to `initiative_decisions`.

### Rendered on demand, off the hot path

The log is fetched by the review drawer via `GET` when it opens — it is NOT
folded into the count-only `readDashboardView` batch, so the dashboard's query
budget and the count-only team surface are unchanged. Author names are resolved
route-side from `orgMembersList` (auth users / org members — never a §7 tracked
person), the manager-notes-page pattern.

## Registrations (the org-scoped-table triple)

1. `tests/tenant-isolation.test.ts` `SCOPED_READS` (`initiatives.decisionsForOrg`)
   with a non-vacuous B-org seed decision.
2. This ADR.
3. `src/db/account-deletion.ts` `PURGE_TABLES`, ordered BEFORE `initiatives`
   (the composite tenant FK edge `initiative_decisions → initiatives`); the
   FK-order anti-vacuity floor in `tests/account-deletion.test.ts` bumps 25 → 26.

## Consequences

- A manager gets a durable who/why trail per initiative; it is never on the
  count-only team view, never feeds a score, and cannot be edited to rewrite
  history.
- Append-only means correcting a note = add a follow-up. Acceptable for v1
  (notes are short); an edit/delete flow would need an ADR revising the
  no-`updated_at`, no-delete decision.
- The author fallback ("A former manager") is only reached when the auth user is
  no longer an org member; the byline is honest about what it can resolve.
- Notes are free text; like `manager_notes.body` they are deliberately NOT swept
  by the banned-phrasing copy tests (user content) — only the fixed UI strings
  are.
