# 0007 — `benchmarks` table (additive)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Founder (W2-I kickoff plan approval)

## Context
W2-I's charter (execution plan, Wave 2) requires seeding a published-data
benchmark table (Copilot acceptance norms, Worklytics/Section adoption
benchmarks) with citations, so score panels can render "you vs. published
industry data" — the product spec calls benchmarks load-bearing (§8 L4). No
such table existed at the W0-C freeze because no score presets existed yet
either. `src/db/schema.ts` and `drizzle/**` are frozen paths, so even this
charter-mandated, purely additive table requires an ADR in the same PR
(rule 1 / CI `frozen-contracts` job).

## Decision
Purely **additive** — no existing shape is modified:

1. **`benchmarks` table** (migration `0012_benchmarks.sql` + seed migration
   `0013_seed-benchmarks.sql`): one row per published benchmark figure,
   keyed loosely to a `score_slug` (+ optional `component_key`, e.g.
   `fluency`/`effectiveness` for a Copilot acceptance-rate citation) and a
   `segment` (free text, e.g. `overall`/`enterprise`). Carries either a point
   `value` or a `range_low`/`range_high`, a `value_unit` enum
   (`normalized_0_100 | percent | raw`) so a raw published percentage is
   never silently conflated with our normalized 0-100 score scale, source
   attribution (`source_name`, `source_url`), and a `status` enum
   (`draft | verified | retired`) defaulting to `draft`. Consuming UIs (later
   W2-H/W2-L work) must filter to `status = 'verified'` before presenting a
   figure as authoritative — seeded rows start as `draft` with a `notes`
   caveat until the founder confirms the primary source.
2. **No `org_id` column.** Benchmarks are global reference data, not tenant
   data — same documented exception as `metric_catalog`. No new
   `forOrg`/`org-scope.ts` namespace is added; a plain query module
   (`src/db/benchmarks.ts`, PR2 of this workstream) reads the table directly,
   so `src/db/org-scope.ts` — itself a separately-gated frozen path — is
   untouched by this ADR.
3. Three seed rows land in `0013_seed-benchmarks.sql`, all `status='draft'`:
   a Copilot suggestion-acceptance-rate citation (tagged to `fluency`'s
   `effectiveness` component), a general weekly-adoption range, and an
   enterprise-segment adoption range (exercising the `segment` column).

## Contracts affected
- `src/db/schema.ts` + `drizzle/0012_benchmarks.sql` +
  `drizzle/0013_seed-benchmarks.sql` — new table and seed data only.
- `src/db/org-scope.ts`, `src/contracts/**`, `src/lib/credentials.ts`,
  fixture shapes: untouched.

## Workstreams to re-sync
None yet: additive surface with no consumer in this PR chain. W2-H and W2-L
will later query `listBenchmarks` (PR2) to render benchmark panels — noted
here so they build against this shape rather than reinventing a table.

## Consequences
- The tenant-isolation completeness sweep requires no new entry: `benchmarks`
  genuinely has no `org_id` column, so it's naturally skipped by the same
  `"orgId" in getTableColumns(table)` check that already skips `metric_catalog`.
- Seeded figures are provisional (`status='draft'`) until the founder
  verifies a primary source; `docs/score-definitions.md` (PR4) must surface
  that caveat rather than presenting draft numbers as settled fact.
- If a future benchmark needs richer structure (e.g. per-percentile
  distributions instead of point/range), that is a new ADR, not a widening
  of this one.
