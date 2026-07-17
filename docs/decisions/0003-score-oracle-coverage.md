# 0003 — fluency + efficiency oracle rows in team-30d score-results fixture (additive)

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Founder (W1-F adversarial pre-review)

## Context
W1-F's adversarial pre-review required the recompute engine to be pinned against
an independently-derived golden oracle for **every** shipped score preset, not
just `adoption`. The only place a team/core/30-day expected result for the
`fluency` and `efficiency` presets can live is the existing
`fixtures/score-results/team-30d.json` — the test loads that whole file
(`tests/scoring-recompute.test.ts`, `tests/contracts.test.ts`) and iterates its
`results` array. `fixtures/**` is a frozen path, and the CI `frozen-contracts`
job treats *modifying* an existing fixture file (diff-filter `MDR`) as a contract
change even when the edit only appends rows — so this coverage addition requires
an ADR in the same PR (rule 1).

## Decision
Purely **additive** — no existing oracle row changes:

1. Append two expected-result entries to `fixtures/score-results/team-30d.json`
   for the `core` team over 2026-06 (month grain): `fluency` (v1) and
   `efficiency` (v1). Each carries the full component breakdown (raw /
   normalized / weight / contribution), the final `value`, the resolved
   `attribution`, and a `_derivation` string that hand-computes every figure
   from the frozen `fixtures/metric-records/team-30d.json` inputs — arithmetic verified
   **outside** the engine so the fixture is a true oracle, not an engine echo.
2. The existing `adoption` oracle row is untouched; team semantics are unchanged.

The recompute engine reproduces both new rows to exact parity (golden test green:
20/20 in `scoring-recompute` + `contracts`).

## Contracts affected
- `fixtures/score-results/team-30d.json` — two rows appended; no existing row's
  shape or value changes. The `score_results`/`ScoreResult` zod shapes,
  `CANONICAL_METRICS`, the attribution ladder, and all other frozen contracts:
  untouched.

## Workstreams to re-sync
None. The fixture is consumed only by W1-F's own golden tests and the W1-S
tenant-isolation/contract sweeps, which read the file generically and gain
coverage automatically. No downstream built against a narrower version.

## Consequences
- The recompute engine is now oracle-pinned for all three presets shipped in
  W1-F (`adoption`, `fluency`, `efficiency`), closing the pre-review gap.
- The `round4` persistence contract is exercised end-to-end by the new rows
  (normalized/contribution derive from **unrounded** predecessors, each field
  independently rounded half-away-from-zero); `contracts.test.ts` relaxes its
  oracle-consistency tolerance 6→3 digits to admit that documented contract —
  flagged for W1-S in the PR, not widened here.
- Any future preset needs its own oracle row + a follow-up ADR, by the same
  file-level gate.
