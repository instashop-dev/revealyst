# 0062 — Initiatives: executable recommendations with named participants

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Team Manager Dashboard workstream (TMD Phase P2); founder-signed
  privacy posture **on the ADR-0038 mold**, unblocked by ratified **D-TCI-1**
  (managers may see named per-person data for people they manage).
- **Builds on:** **ADR 0038** (the self-view-only exposure-log mold — the shape a
  privacy-sensitive surface must take), **ADR 0045** (manager per-person
  capability visibility — the crossing-the-wall precedent + its authz matrix),
  **ADR 0053** (manager notes — the manager-scoped, author-attributed,
  purge-before-people table pattern), and **ADR 0061** (team goals).

## Context

The Team Manager Dashboard is completing the manager loop: **goal → diagnosis →
recommended action → EXECUTION → measured outcome**. P1 gave the page a goal; the
missing middle is **execution** — turning a recommendation into a tracked effort
with an owner, named participants, a baseline/target, a review date, and (P3) a
measured before/after.

This is a genuinely new entity. Missions (ADR 0037) are the closest existing
pattern but are **single-person, self-view-only, opt-in, click-free** — they do
not cross the self-view wall. An **initiative** does: it names participants **to
their manager** and rolls their participation up to a manager-visible card. Per
D-TCI-1 that wall-crossing is authorized, but D-TCI-1 is explicit that the build
still requires the **ADR-0038 mold**: consent posture in the visibility
framework, per-surface identity registration, a manager-vs-member-vs-admin authz
test matrix, and purge/tenant registrations.

**This ADR (P2a) covers the data layer**: two tables, the org-scoped namespace,
and the coded initiative library. The **named-participant read is NOT yet
exposed** — P2a stores ids and provides only count-only / uuid-only reads. The
manager-authorized *named* read (with its `MANAGER_AUTHORIZED_IDENTITY_SURFACES`
registration and authz matrix) ships in **P2b**, under this ADR's posture.

## Decision

Add two org-scoped tables (migration 0049):

1. **`initiatives`** — org-scoped, optional `team_id` (NULL = org-wide, the common
   case), mirroring `team_goals`/`team_insights`: `owner_user_id` (the manager),
   `title`, `template_slug` (a coded-library key, no DB FK), `capability_slug` /
   `score_slug` (both nullable closed unions — never free-form; at least one set),
   nullable `baseline` (invariant b — never a fabricated starting number),
   `target`, `review_date`, `status` (`draft`/`active`/`in_review`/`completed`/
   `stopped`), nullable `outcome` (`improved`/`unchanged`/`worsened`/
   `inconclusive`, set only at review — never a causal claim, P3), timestamps. A
   composite tenant FK `(org_id, team_id) → teams(org_id, id)` (MATCH SIMPLE) and
   a `(org_id, id)` unique target for the child FK below.

2. **`initiative_participants`** — the wall-crossing join: `(initiative_id,
   person_id)` PK, `org_id`, with composite tenant FKs to BOTH
   `initiatives(org_id, id)` and `people(org_id, id)` (a participant can never
   reference a cross-org initiative or person). Purged before both `initiatives`
   and `people`.

3. **Initiative library** (`src/lib/initiative-library.ts`) — the §8 starter
   templates as a **CODED registry** (the `capability-curriculum.ts` pattern), NOT
   a DB table: no migration, no stored-prose claim surface (W3-N). Each template
   binds to a real capability/score slug (a test pins this).

4. **Anti-gamification (R3 / Spec V4 §8.4)** — deliberately NO `xp`/`streak`/
   `league`/`points`/`level`/`badge` column and no gamified copy; a schema-shape
   test + a banned-phrasing sweep pin it, exactly as missions does.

## Privacy / consent constraints that make the wall-crossing acceptable

- **Named participants are a SEPARATE manager-authorized surface**, not the
  private-mode team view. When P2b exposes the named read it registers in
  `MANAGER_AUTHORIZED_IDENTITY_SURFACES` (src/lib/visibility.ts) and is gated on
  a `team_managers` grant for the initiative's team (+ managed/full mode for the
  named read), authorization proven by a manager-vs-member-vs-admin authz matrix
  — never by `assertTeamOnlyPseudonymized` (ADR 0045's rule).
- **Members see their OWN participation**, never the roster's private coaching.
  **Admins do not get per-person reads** by role — an admin must self-assign an
  audited `team_managers` grant (ADR 0045).
- **The self-view tables stay self-view-only FOREVER** (V4 NOT-list):
  `rec_interaction_state`, `recommendation_exposure`, personal coaching, and
  mission state are never widened. The P3 initiative decision log will be a
  *separate* manager-scoped record, not an extension of those.
- **Count-only by default**: the dashboard card shows participation as an
  aggregate count (`N of M`); the named roster is opened deliberately by an
  authorized manager, never rendered by default.

## Contracts affected

- **`src/db/schema/initiatives.ts`** (new) — `initiatives` +
  `initiative_participants` + the `initiative_status` / `initiative_outcome`
  enums; exported from the `src/db/schema.ts` barrel after `goals` (frozen-path
  change → this ADR).
- **`src/db/org-scope.ts`** (frozen public API) — additive `forOrg().initiatives`
  namespace (`src/db/org-scope/initiatives.ts`): create / list / get /
  addParticipants / participantsForOrg (uuid-only sweep read) / participantCounts
  (count-only) / setStatus / setOutcome / removeParticipant. **No named read yet.**
- **`src/lib/initiative-library.ts`** (new) — the coded template registry.
- **Three registrations, ×2 tables:** `tests/tenant-isolation.test.ts`
  (`initiatives.list` + `initiatives.participantsForOrg` SCOPED_READS entries, each
  with a non-vacuous B-org seed) · `src/db/account-deletion.ts` (`initiativeParticipants`
  then `initiatives` in `PURGE_TABLES`, ordered before `people`/`teams`) · this ADR.

## Non-goals / what stays for P2b + P3

- **P2b:** the launch flow from a priority (`POST /api/initiatives`), the
  manager-authorized **named** participant read + its
  `MANAGER_AUTHORIZED_IDENTITY_SURFACES` registration + authz matrix, and the
  active-initiatives card (count-only unless a manager opens the roster).
- **P3:** initiative outcome review (measured before/after, no causal claim), the
  manager decision log, and capability depth/spread aggregates.

## Workstreams to re-sync

Team Manager Dashboard P2b (consumes `forOrg().initiatives` + adds the named read)
and P3 (outcome review + decision log). No other workstream reads these tables.
