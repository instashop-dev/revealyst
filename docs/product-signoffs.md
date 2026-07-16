# Product sign-off ledger

A durable home for founder product decisions. Nothing here existed before W9 closure
T0.5 — `docs/approvals.md` covers external filings (GitHub App, Paddle, legal) only, not
product-call outcomes. Entries are added as decisions are made or defaults are applied;
"default applied" rows stand until the founder ratifies or overrides them (CLAUDE.md
rule 4 — founder judges evidence, human gates are never self-certified).

| Date | Item | Decision | Evidence link | Status |
|---|---|---|---|---|
| 2026-07-16 | OQ-001 — exit-gate N / threshold for the §14 digest-return metric | Default: 6 weeks, measured against founder-org dogfooding | `docs/Revealyst_Closure_Execution_Plan.md` §6 D1; `scripts/digest-return-rate.ts` `--weeks` flag (default 6, never a baked-in threshold) | Pending — default applied, awaiting founder ratification |
| 2026-07-16 | OQ-002 — Custom Index Builder demotion (post-V1 direction, not a V1 surface) | Default: demoted, route stays intact | `docs/Revealyst_Closure_Execution_Plan.md` §6 D2; code already matches (route live, not V1-promoted) | Pending — default applied, awaiting founder ratification; nothing blocks on it (code already matches) |
| 2026-07-16 | OQ-008 — third-ladder confirmation (capability profile card as decomposition of the one band, not a new ladder) | Default: capability profile = decomposition (per ADR 0036) | `docs/product/requirements.csv` OQ-008 row (corrected 2026-07-16, T0.3 — no longer claims founder sign-off); ADR `docs/decisions/0036-user-capability-state.md` | Pending — decided autonomously per directive (ADR 0036), awaiting founder confirmation |
| 2026-07-16 | D11 — TEL-012 (context-usage signal) scheduling: build now vs. formally move to Future | Default: move to Future | `docs/Revealyst_Closure_Execution_Plan.md` §6 D11; recorded in the Spec V4 refresh (T0.4) | Resolved by default — formally moved to Future |
| 2026-07-16 | D4 — Companion card consolidation (option 1 vs 2 vs keep) | Default: keep as-is (do not build T3.3) | `docs/Revealyst_Closure_Execution_Plan.md` §6 D4, T3.3 | Default applied — awaiting founder ratification |
| 2026-07-16 | D5 — Audit-log scope widening + permanent purge record (T2.4 ADR) | Default: do not write machine-event rows | `docs/Revealyst_Closure_Execution_Plan.md` §6 D5, T2.4 | Default applied — awaiting founder ratification |
| 2026-07-16 | D7 — Budget/renewal email opt-out policy | Default: transactional, no opt-out (status quo) | `docs/Revealyst_Closure_Execution_Plan.md` §6 D7, T3.5b | Default applied — awaiting founder ratification |
| 2026-07-16 | D8 — "Invite N more" cold-start copy | Default: current honest copy stands (no new copy built) | `docs/Revealyst_Closure_Execution_Plan.md` §6 D8, T3.5a | Default applied — awaiting founder ratification |
| 2026-07-16 | D9 — Mobile-supported statement + WCAG 2.1 AA target line in Spec V4 | Default: spec stays silent | `docs/Revealyst_Closure_Execution_Plan.md` §6 D9, T0.4 | Default applied — awaiting founder ratification |
| 2026-07-16 | D10 — `--muted-foreground` contrast-token darken (visual pass) | Default: token unchanged | `docs/Revealyst_Closure_Execution_Plan.md` §6 D10, T2.6 item 6 | Default applied — awaiting founder ratification |
| 2026-07-16 | T2.5 — Frozen-contracts guard semantics (option A vs B) | Default: option A — keep current guard, human review as backstop (recorded here; guard comment in `ci.yml`) | `docs/Revealyst_Closure_Execution_Plan.md` §6 D6, T2.5 | Default applied — awaiting founder ratification; option B (registration checker) recommended as a follow-up |
| 2026-07-16 | D12 — Exec memo: in-app page vs email + export only | Default: email + export only (status quo) | `docs/Revealyst_Closure_Execution_Plan.md` §6 D12; code already matches (`/api/exec-report` export + monthly email, no in-app page) | Default applied — awaiting founder ratification; nothing blocks on it (code already matches) |

## Notes

- "Default applied" means the plan's documented fallback is what the code/docs currently
  reflect — no new work was withheld waiting on the founder, but the decision is not yet
  formally ratified.
- "Pending" (OQ-001/002/008) means no default behavior change has shipped beyond what the
  code already does; the row exists so the open question has one citable home instead of
  being re-derived every wave.
- When the founder ratifies or overrides a row, update its Status column in place (do not
  delete the row — it is the record of what was decided and when) and cross-link the
  ratifying conversation/PR if one exists.
