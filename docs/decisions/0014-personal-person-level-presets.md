# 0014 — Person-level score presets for personal orgs

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Founder (via dashboard-scores debugging session)

## Context

A personal org's dashboard renders `PersonalSelfView`, which builds the
Adoption / Fluency / Efficiency cards **only** from score rows with
`subjectLevel === "person"` and `periodGrain === "month"`
(`src/app/(app)/dashboard/page.tsx`). But a real (non-fixture) personal org is
never given any person-level score definition:

- The only global seed, `drizzle/0009_seed-score-presets.sql`, is all three
  presets at `subject_level = 'team'`.
- The signup bootstrap `ensureOrgOfOne` seeds no score definitions.
- Person-level definitions exist only as a dev fixture
  (`fixtures/score-definitions/personal-presets.json`), loaded via
  `loadScoreDefinitions` into the fixture org only. Its own comment says these
  are placeholders and "Real calibrated person-level definitions are W2-I's
  deliverable and replace these at the W2 integration gate" — that deliverable
  never shipped to production.

Consequence: `recomputeOrg` for a personal org loads only the team-level presets,
finds no teams, and writes **zero** `score_results`; the person branch never
runs. The three cards render the "Computing from your connected data — check back
shortly." placeholder permanently, even with data connected and the nightly cron
running. Spend still shows because it is read live from `metric_records`, off the
score path. This is a shipped product gap, not a data or timing issue.

The frozen `drizzle/**` migrations and the `ensureOrgOfOne` bootstrap can't
express "personal orgs get person-level definitions" without a change; hence
this ADR (rule 1).

## Decision

Give every personal org the three person-level definitions `PersonalSelfView`
requires, as **org-scoped rows** (`org_id = the org`), by **cloning the global
team presets at `subject_level = 'person'`**. The person components are identical
to the team presets (`personal-presets.json` mirrors `0009` exactly), so cloning
keeps a single source of truth (the global presets) — no duplicated component
JSON, and person presets stay consistent with any future W2-I recalibration of
the globals.

Org-scoping (not a new global preset) is deliberate: the
`score_definitions` unique key is `(org_id, slug, version)` NULLS NOT DISTINCT,
so a same-slug/version global person row (`org_id NULL, 'adoption', 1`) would
collide with the existing global team row. Org-scoped rows carry a concrete
`org_id` and don't collide; `forOrg(...).scores.definitions()` already unions
`org_id IS NULL` with the org's own rows, so recompute picks them up unchanged.

Two seams, one clone statement:

- **Backfill** (`drizzle/0017_seed-personal-person-presets.sql`, data-only):
  `INSERT INTO score_definitions (...) SELECT o.id, d.slug, d.version, d.name,
  'person', d.components, 'active' FROM orgs o CROSS JOIN score_definitions d
  WHERE o.kind = 'personal' AND d.org_id IS NULL AND d.subject_level = 'team'
  ON CONFLICT (org_id, slug, version) DO NOTHING;` — seeds all existing personal
  orgs (idempotent, safe to re-run).
- **Signup** (`ensureOrgOfOne`, `src/db/org-scope.ts`): inside the bootstrap
  transaction, after the org + admin member are inserted, run the same clone
  scoped to the new `orgId`, `ON CONFLICT DO NOTHING`. Idempotent under the
  documented signup race and the per-request re-call from `api-context.ts`.

Only personal orgs are seeded; team orgs keep exactly the global team presets
they render today (no behavior change for teams).

## Contracts affected

- `drizzle/**` — additive data-only migration `0017` (seeds rows; no schema/DDL
  change, no snapshot change).
- `src/db/org-scope.ts` — behavioral change to the `ensureOrgOfOne` bootstrap
  (additive seeding inside the existing transaction). The frozen `forOrg` query
  surface (public API, ADR 0001) is unchanged; `scores.definitions()` already
  unions org-scoped rows.
- No `src/contracts/**` change, no `src/db/schema.ts` change, no `tracked_user`
  change, no credential change, no fixture-shape change.

## Workstreams to re-sync

None — additive. The dev fixture `personal-presets.json` becomes redundant for
production but is left in place (still used by `tests/personal-read.test.ts` and
`scripts/seed-fixtures.ts`).

## Consequences

- Personal orgs now produce person/month `score_results` **when per-user usage
  metrics exist and resolve to the person**. Seeding definitions is necessary
  but not sufficient: the three scores consume `active_day` / `feature_used` /
  `suggestions_*`, not spend. An org with only `spend_cents` (e.g. Anthropic
  Console cost report on the synthetic `account:org` subject) still shows empty
  cards — the honest "no usage data yet" state (`evaluateDefinition` omits,
  never fabricates a 0). That is correct behavior; the remaining gap there is
  per-user usage ingestion / identity resolution, tracked separately.
- Existing personal orgs need a **recompute** after backfill to populate the
  current period without waiting for the `0 2 * * *` cron (a one-off script /
  enqueued `score-recompute` ships with this change).
- Person presets are clones of v1 team presets. If W2-I later mints new team
  preset versions, the signup clone tracks them for new orgs, but already-seeded
  orgs keep their v1 person rows until re-cloned — acceptable while only v1
  exists; revisit when versioned recalibration lands.
- The clone couples person presets to the global team presets' component shapes.
  That is the intended mapping today (identical components); a future need for
  genuinely divergent person components would replace the clone with authored
  rows.
