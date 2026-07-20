# 0064 — Capability depth + spread aggregates

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Team Manager Dashboard plan, phase P3 tail T3.3
  (`docs/Revealyst_Team_Manager_Dashboard_Execution_Plan.md`). Founder kickoff
  decision (this session): persist depth/spread on `team_capability_history`
  **now** (not compute-on-read only), so the trend is available.
- **Implemented:** branch `tmd-p3-tail` — migration **0051** (two additive
  columns on `team_capability_history` in `src/db/schema/capability-graph.ts`),
  the pure `deriveDepthSpread` (`src/lib/capability-depth.ts`), the count-only
  `mastery.masteryStats()` sibling read, the writer extension
  (`src/scoring/recompute-capability-history.ts`), the `capabilityHistory`
  namespace row/upsert, the `CapabilityCoverageRow` mean/spread fields
  (`src/lib/capability-coverage.ts`), the dashboard-view batch (+1 read), and the
  coverage-card render.

## Context

The team capability-coverage card (W7-6) shows a binary split per capability:
how many people are at/above the mastery threshold (`mastered`) out of those with
any state (`total`). It cannot show **depth** (how strong the team is on average,
not just above/below a line) or **spread** (whether mastery is evenly shared or
concentrated) — the R2 "map delta" in the analysis. `team_capability_history`
(ADR 0046) already persists the count bands for trend, but not the statistics
needed for mean/spread.

ADR 0046 blessed a deliberate compute-on-read exception for the history rollup
and asked later work to "extend, don't re-litigate". This ADR extends it: the
same nightly rollup also persists the depth/spread **sufficient statistics**, so
a period-over-period trend of depth/spread becomes computable (the founder's
kickoff decision), while the LIVE dashboard card computes depth/spread on read
from the same source — so the two can never disagree.

## Decision

### Sufficient statistics, not stored means — count-only, exact

Add two additive, **nullable** columns to `team_capability_history` (migration
0051):

- `mastery_sum_bp integer` — the sum, over people-with-state, of
  `round(mastery * 10000)` ("mastery in basis points of 1"). The mastery scale is
  `round4`, so this is an **exact** integer (no float drift).
- `mastery_sum_sq_bp bigint` — the sum of that value squared.

From these plus `represented_count`, `deriveDepthSpread` reconstructs the team
**mean** (`sum / n`) and **population standard deviation**
(`sqrt(sumSq/n − mean²)`). Storing the sufficient statistics rather than a stored
mean/stddev keeps the row **count-only** (no per-person value or id — a leak stays
structurally impossible, the ADR 0046 posture) and exact, and it lets the read
derive either statistic without a second write. **Nullable**: rows written before
this migration carry null — an honest "no depth data for that period", never a
fabricated 0 mean (invariant b).

### One shared derivation — the drift guard, extended

Both the writer and the live dashboard read the same count-only
`mastery.masteryStats()` (a sibling of `coverageCounts`, one query, person-count
independent) and pass its sums through the **same pure `deriveDepthSpread`**. The
dashboard card therefore shows exactly what a trend derived from the stored row
would show — pinned by a parity test (the ADR 0046 shared-source pattern, now
covering depth/spread as well as counts).

### MIN_PEOPLE floor unchanged — still render-time

Depth/spread ride the SAME rows as the coverage counts, which are already
`MIN_PEOPLE`-floored at render (a below-floor capability is dropped entirely,
never a suppressed-but-implied number). No new suppression surface; the row prop
type (`CapabilityCoverageRow`) still carries **no person id**, so a per-person
leak remains structurally impossible. `masteryStats()` stores true, unfloored
sums (like the counts) so a later trend stays continuous.

### Rendered plainly

The card adds one line per capability: "Team average X% · evenly shared / mixed /
very uneven" — the mean as a whole percent and a plain-English band for the
spread (no "standard deviation" jargon; beginner-plain per the writing rule).
Shown only when the aggregate stats are present.

## Contracts affected

- **`src/db/schema/**` + `drizzle/**`** — two additive nullable columns on an
  existing table (no existing shape changed); migration 0051.
- **`src/db/org-scope.ts` public API** — `mastery.masteryStats()` (new
  count-only read) + the `capabilityHistory` row/upsert gain the two fields.
- Not affected: `tracked_user` semantics, credential shape, the frozen score
  engine (this reads its outputs), `connector-facts.md`. **No new table** → no
  new PURGE/SCOPED_READS registration; the existing `capabilityHistory.list`
  tenant-isolation sweep covers the widened row (its seed carries the new fields).

## Consequences

- Managers see team **depth** (average) and **spread** (how evenly shared) per
  capability, not just an above/below-line count — the R2 map delta, aggregate
  and count-only.
- Period-over-period depth/spread trend is now persisted (the founder decision);
  no current UI consumes the trend yet — the growth card wiring is a follow-up,
  and the stored statistics are ready for it.
- The compute-on-read exception (ADR 0046) is extended, not re-litigated; its
  drift risk stays contained by the single shared `deriveDepthSpread` + the
  parity test. No per-person value or id is ever stored or rendered.
