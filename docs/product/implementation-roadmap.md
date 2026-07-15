# Revealyst — Spec V4 Implementation Roadmap

**Date:** 2026-07-15 · Companion to the [gap analysis](revealyst-gap-analysis.md) ([requirements](requirements.csv) · [traceability](traceability.csv)).
**Baseline:** `main` at `82c2cd1` — 142/160 requirements Implemented. This roadmap covers only the remaining 18 (10 Partial, 6 Blocked, 2 Missing) plus the evidence-backed hardening/hygiene items from the specialist fan-out. Effort grades reuse the spec's scale (S = lib/UI PR · M = new surface · L = table+ADR+registrations · XL = multi-surface).

**Sequencing law (from §15.3, reaffirmed by findings):** P0–P3 are independently shippable and heavily parallel; P4 items are independent of each other; P5 is gate-controlled and must not be forced. Nothing here requires a rewrite, downtime, or a non-additive migration.

---

## Phase 0 — Governance & claim-surface hygiene (immediate, fully parallel, docs-only + CI)

**Objective:** restore the "prose is a claim surface" discipline and the ADR ledger's citability before any further parallel fan-out.
**Requirements covered:** OQ-001, OQ-002, OQ-006, OQ-008 (recording), ARCH-004 (spec-side), PRIN-008 remnants.
**Dependencies:** none. **Risk:** trivial (doc/CI only).

Deliverables:
1. Renumber `docs/decisions/0037-org-scope-unique-violation-cause-chain.md` → `0040` (keep the schema-bearing missions ADR at 0037); add collision banners where absent; add an index table to `docs/decisions/README.md`; add a CI duplicate-prefix check.
2. Fix `docs/Revealyst_Execution_Plan.md:66` "KMS wiring" → "versioned Worker-secret KEK envelope".
3. Correct OQ-008 wording everywhere it claims "founder sign-off received" for the third-ladder line → "decided autonomously per directive (ADR 0036), awaiting founder confirmation", or obtain the real confirmation.
4. Spec V4 refresh PR: 29 keys/11 families; migration ledger 0034; OTel receiver shipped; bless (or reject) the two-tier API-contract convention in §15.2; widen the documented `allowOverFreeBand` set; correct the §5.2 shared-assembly citation to `deriveAttention`; note the 9-capability seed decision in §16.8.
5. Record founder sign-offs (or standing defaults) for OQ-001 (N=6 weeks + threshold) and OQ-002; banner/move `docs/ai-capability-implementation-gap-analysis.md` to legacy.
6. Verify the landing-page $1-promo against the configured Paddle price; drive the copy from a dated constant.

**Acceptance / completion gate:** ADR prefixes unique in CI; zero "KMS" matches outside `credentials.ts` comments; Spec V4 contains no implementation-status claim contradicted by code at the refresh commit; sign-off ledger entries exist (or explicitly deferred) for OQ-001/002/008. *Human gate: founder reviews the sign-off recordings (rule 4).*

---

## Phase 1 — Measurement-plane closure (protects the §14 MVP bet; parallel-safe; all S)

**Objective:** make the MVP exit gate and the §14 leading indicators actually measure what they claim, before the 6-week dogfood clock matures.
**Requirements covered:** MET-003, MET-005, PRIV-007, TEL-016, SYNC-003; supports MET-001/MET-002 signal quality.
**Dependencies:** none (all data substrates already captured). **Risk:** low — pure derivations + copy/composition; the one privacy constraint is that MET-005 stays an aggregate, founder-only read (never a manager route).

Deliverables:
1. **Digest companion-return CTA** (top risk item): a prominent body link to `/dashboard` tagged via `appendDigestUtm`, so `digest_return` measures companion returns, not footer-settings clicks.
2. `deriveSyncCadence()` — pure inter-sync-interval distribution over append-only `connector_runs(kind='agent_ingest')`, reported via `scripts/launch-metrics.ts`; confirm the retention window covers the cadence window.
3. Rec-engagement ratio — server-side aggregate join of `recommendation_exposure` × `rec_interaction_state` per (org, rec, period): shown/tried/dismissed counts, founder analysis path only.
4. Named opt-in-rate figure (agent/companion opt-in from existing connection + revisit rows); Team-org variant deferred to P5.
5. Wire `SignalCoverageBadge` into the self-view (or Data Confidence card) so coverage is visible independent of a rec being surfaced — or delete it deliberately.
6. Compose the SYNC-003 same-click reward: LastSyncFacts counts + `buildDailyNudge` headline in one place post-sync.
7. Commit the Analytics Engine query (or script) that computes the N-week digest-return rate once OQ-001's numbers are signed.

**Acceptance / completion gate:** each §14 leading indicator is a tested pure derivation or a committed query, not an ad-hoc dashboard glance; a digest click can be related to a companion revisit; a 1-source vs 3-source person is visibly distinguishable on the self-view.

---

## Phase 2 — Defense-in-depth hardening (parallel-safe; S each)

**Objective:** convert documented-but-dormant safety invariants into enforced ones, ahead of the P5 privacy-critical widening.
**Requirements covered:** ARCH-006 (runtime half), V1-001 (logs-endpoint auth), PRIV-005 (ordering assertion); plus admin/billing accountability extra-gaps.
**Dependencies:** none. **Risk:** low; the runtime predicate call must be verified zero-throw on current production shapes before merging (it should be — the team view carries no identity today).

Deliverables:
1. Invoke `assertTeamOnlyPseudonymized` at the end of `readDashboardView` (runtime, throwing); register the team-visible attention-item shape in `IDENTITY_BEARING_MANIFEST`.
2. Device-token verification on `POST /v1/logs` (401 on failure) + an explicit `/v1/` branch in `domains.ts`; include `/v1/*` in request timing.
3. Purge-ORDER test: walk FK dependencies and assert every people/connections/teams-referencing table precedes its parent in `PURGE_TABLES`.
4. Audit rows for Paddle lifecycle + seat-metering CAS (`billing.subscription_status`, `billing.seat_quantity_set`) and a SYSTEM-org `account.purge` record before the deletion cascade (needs a short privacy-vs-accountability decision note/ADR).
5. Strengthen the frozen-contracts guard to require a NEW `docs/decisions/` file on frozen-path change (or record the decision to keep human review as the backstop).
6. A11y structural trio: skip-to-content link, `<nav aria-label="Primary">` + `aria-current`, global `prefers-reduced-motion` reset; dialog `max-h + overflow-y-auto`; `p-4 md:p-6` shells. Adopt WCAG 2.1 AA as a stated principle; add a jest-axe smoke test over onboarding/companion/dashboard.

**Acceptance / completion gate:** a synthetic identity-bearing team view throws at runtime in a test; unauthenticated `/v1/logs` POST returns 401; purge-order test green; a plan change and a purge each produce an audit row; axe smoke suite green.

---

## Phase 3 — Ranker & companion completion (product decisions + S/M builds)

**Objective:** activate the shipped-but-inert recommendation machinery and resolve the companion-surface tension.
**Requirements covered:** COACH-004 (fatigue/novelty terms), COACH-008 (action-type affordances), UX-001/§11.2 tension.
**Dependencies:** P7 exposure log (shipped); founder calls on card consolidation + rotation behavior. **Risk:** medium-low — ranking changes need the output-equivalence guard extended, not bypassed.

Deliverables:
1. Feed `triedRecIds` → `fatigueRecIds` in both dashboard and digest call sites; derive `novelty` from `recommendation_exposure` recency; extend the equivalence guard to pin the no-history case unchanged.
2. Surface `suggestedActionType` as distinct affordances (link-out vs in-product vs vendor deep-link) or record it as data-only.
3. Companion card consolidation per founder decision (fold Milestone/DailyNudge into Growth Journey, progressive-disclose secondary cards) — keep the §11.2 "one card, not a dashboard" spirit.
4. Extract PersonalSelfView/TeamOverview from `dashboard/page.tsx` into modules (pure re-factor, preserves the flat-batch perf law) — this also de-risks P5's widening.
5. Optional (product call): count-bearing cold-start invite copy ("invite N more"); budget/renewal List-Unsubscribe header → settings preference.

**Acceptance / completion gate:** a tried rec visibly rotates next period; equivalence guards green; dashboard file split with byte-identical rendered output (component tests).

---

## Phase 4 — V1 remainder (independent; M each)

**Objective:** close the two genuinely Missing requirements.
**Requirements covered:** GJ-007, TEL-012.

1. **GJ-007 learning paths (M):** pure, band-keyed static curriculum content model (glossary-style module) sequencing the existing catalog; render the stored `learningResources`/`learning_path`; fold or retire `/playbook`. Tripwire: static content only — no LMS/courses/certification (NOT-019). Acceptance: a band-keyed ordered path renders; content in a sweepable copy module; banned-mechanic tests still green.
2. **TEL-012 context-usage (M, keep OTel-gated):** add the canonical metric key (contract ADR), an OTel context marker + optionally the Anthropic `context_window` group_by harvest as the second corroborating source; renders directional, never from a single source (≥2-signal rule pinned by test). If not scheduled, formally move to Future in the spec (P0 refresh).

---

## Phase 5 — Gated work (do NOT force; sequence exactly)

**Objective:** the spec's #1 structural gap, opened only by its named gates.
**Requirements covered:** WF-001, POP-001, POP-007, MET-004; ARCH-005 (schema split); OQ-003/OQ-004 research gates.

1. **Sub-case-C ADR → Companion-in-Team-orgs (M–L)** — after the W6-A dogfood outcome (clock started 2026-07-14):
   - Precondition: P2.1 (runtime predicate + manifest) merged.
   - The ADR lands all three legs: (a) provable exclusion predicate with test-enforced completeness (built — cite it), (b) dual-source dedup (helper `rowsForSubjects` exists — extend coverage to the self-view read path with a test), (c) surfaced-not-billed (frozen contract — cite it).
   - Then widen `dashboard/page.tsx` so a team-org member gets the person-scoped PersonalSelfView + digest personal lane; instrument the opt-in event (MET-004); tenant-isolation + exclusion tests prove no team-rollup/billing reach.
   - **Completion gate (human, rule 4):** founder judges the evidence pack — predicate throws on synthetic leak, dedup test, billing unchanged, opt-in metric live.
2. **`schema.ts` split ADR (S–M mechanical, frozen-contract):** per-domain modules behind a barrel; byte-identical `drizzle-kit generate` output as the acceptance test. Land BEFORE the next table-bearing workstream.
3. **Role expansion / conversation-structure:** remain closed until OQ-003 (M365/Workspace research doc) and OQ-004 (scope decision) exist. No implementation work is permitted ahead of these gates (NOT-015, no-prompt-content).

---

## Parallelism map

- P0, P1, P2 can all start now, concurrently (disjoint files; P0 is docs/CI, P1 is lib/poller/scripts, P2 is lib/routes/tests). Within each phase every numbered item is independent.
- P3 needs founder input on items 3/5 only; items 1/2/4 can start now.
- P4's two items are independent of everything except their own gates (TEL-012's OTel marker).
- P5 strictly after its gates; P5.2 whenever a quiet window exists (before the next migration-bearing PR).
- Standing constraint from W6's lesson: **serialize the BUILDS of any two workstreams that both touch `schema.ts`/migrations** until P5.2 lands.
