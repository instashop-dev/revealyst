# Revealyst — Product Specification V4 Gap Analysis

**Date:** 2026-07-15 · **Spec analyzed:** [Product Spec V4](../Revealyst_Product_Spec_V4.md) (v4.1, ground truth per CLAUDE.md)
**Repo baseline:** `main` at `82c2cd1` (post-Wave-7; migrations 0000–0034, ADRs 0000–0039)
**Method:** an 18-domain parallel specialist fan-out (read-only agents: product architecture, UX/UI, frontend/screens, backend, database, auth, AI/recommendation, sync/integrations, billing, admin, notifications, mobile, accessibility, security, infrastructure, testing/CI, documentation, team intelligence/reporting) traced all 160 registry requirements to repository evidence; the orchestrator reconciled conflicts and validated ledgers independently. Every status below cites code, not documentation prose.

**Companion artifacts:**
- [requirements.csv](requirements.csv) — the normalized Requirements Registry (160 atomic requirements, stable IDs)
- [traceability.csv](traceability.csv) — per-requirement status + repository evidence (the traceability matrix)
- [implementation-roadmap.md](implementation-roadmap.md) — the phased execution roadmap

---

## 1. Executive Summary

**The repository substantially implements Spec V4.** Of 160 atomic requirements: **142 Implemented (89%)**, **10 Partially Implemented**, **6 Blocked on named, deliberate gates**, **2 Missing**. Zero requirements landed as *Incorrect Implementation*, *UX Mismatch*, *Conflicting*, or *Obsolete*, and none were *Cannot Verify*.

This is an unusual gap-analysis result and it has a specific cause: the spec text was grounded at commit `4c11be5` (2026-07-13), and the repo has since shipped Waves 5–7 (Personal Companion, roles, recommendation catalog, capability graph + mastery state, utility ranker, missions, exposure log, OTel measured tier). Most of what the spec's own prose calls "unbuilt" now exists — **the spec's status claims are stale, the code is ahead of the document**. The single largest category of "gap" is therefore *documentation drift*, not missing product.

The real gaps cluster into five groups:

1. **The one structural product gap is deliberately gated, not forgotten.** Companion-in-Team-orgs (WF-001/POP-001/POP-007/MET-004 — the spec's own "#1 structural gap") is blocked on the §9.4 sub-case-C ADR, which is in turn gated on the ~6-week founder dogfood clock (W6-A, running since 2026-07-14). Notably, **two of the ADR's three technical prerequisites already exist in code** (the generalized audit predicate in `src/lib/visibility.ts`; dual-source dedup via `rowsForSubjects` in `src/scoring/preview.ts`) — when the gate clears, the remaining work is the ADR itself plus a conditional widening of one branch (`src/app/(app)/dashboard/page.tsx:266`).
2. **Two V1 features are genuinely missing:** GJ-007 learning-path content (only inert schema columns exist: `capabilities.learning_path`, `recommendation_catalog.learningResources` — stored, never rendered) and TEL-012 context-usage signal (no signal at any layer; correctly unbuilt single-source, but unscheduled).
3. **Instrumentation last-mile gaps.** The §14 leading indicators have their data substrates fully captured but four derivations/surfaces are unbuilt: sync-cadence distribution (MET-003), rec-engagement ratio (MET-005), an isolated opt-in-rate metric (PRIV-007), and — highest product risk — **the weekly digest has no companion-return CTA**, so the MVP exit-gate metric currently measures footer-settings clicks, a weak proxy for the voluntary-return bet the whole MVP exists to test.
4. **Defense-in-depth items:** `assertTeamOnlyPseudonymized` is test-only, never invoked at runtime; `POST /v1/logs` accepts unauthenticated bodies; Paddle lifecycle events and account purges write no audit rows; the utility ranker's fatigue/novelty terms are inert (the exposure log that should drive them shipped, but no call site wires it).
5. **Governance/docs hygiene:** two ADR number collisions (0014×2, 0037×2), a stale "KMS" claim in an active plan doc (a PRIN-008 violation of the exact kind W3-N warns about), the OQ-008 sign-off provenance overclaim, and spec-vs-code drift (26→29 metric keys, "latest migration 0023"→0034, the two-tier API-contract convention).

**Architectural verdict: no rewrites required anywhere in the core.** The one-engine/three-lenses factoring is real in code, the frozen contracts are intact, and every V4 feature landed as an extension of a named module (PRIN-009 verified). The only structural refactor recommended is splitting the 1,749-line `schema.ts` monolith (the unfinished half of ARCH-005) before the next table lands.

---

## 2. Scope, Assumptions & Flagged Ambiguities

- **No specification document was attached to the analysis request.** The task text says "the attached Revealyst Product Specification"; the analysis uses the repo's canonical [docs/Revealyst_Product_Spec_V4.md](../Revealyst_Product_Spec_V4.md), which CLAUDE.md declares product ground truth. If a different/newer spec was intended, the Requirements Registry must be re-derived.
- **The spec is stale relative to the repo by design of its own grounding** (`4c11be5`, pre-W6/W7). Where spec prose says a thing is unbuilt but code proves it shipped, the requirement is scored against the *normative intent*, with the prose drift recorded (§13, §16).
- **Spec silence is treated as a finding, not an invented requirement:** Spec V4 says nothing about mobile/responsive targets, accessibility standards, or search. Those subsystems are analyzed descriptively (§11, §12) and their spec-silence flagged for a product decision.
- Requirement statuses use exactly one of: Implemented / Partially Implemented / Incorrect Implementation / UX Mismatch / Missing / Blocked / Conflicting / Obsolete / Cannot Verify. "Blocked" is reserved for items the spec itself gates (named gate cited in evidence).

---

## 3. Requirements Registry

160 atomic requirements in [requirements.csv](requirements.csv), with stable IDs by family:

| Family | Count | Covers | Spec sections |
|---|---|---|---|
| VIS | 3 | Vision/positioning made testable | §2 |
| PRIN | 9 | The nine product principles | §4 |
| WF | 9 | Core workflows (individual, manager, exec) | §5 |
| TEL | 17 | Telemetry, channels, signal tiers, kills | §6 |
| ENT | 8 | Net-new entities (roles→missions) | §6.4 |
| SCORE | 9 | Scoring/insights/benchmark lanes | §7 |
| COACH | 9 | Coaching engine + catalog + ranker | §8.1–8.3 |
| GJ | 8 | Growth Journey composition | §8.4 |
| POP | 7 | Individual/team/shared-account scope | §9 |
| SYNC | 7 | Manual Sync UX law | §10 |
| MVP / V1 | 6 + 2 | Feature-scope tables | §11.2–11.3 |
| NOT | 19 | The NOT-list (verified as absences) | §11.5 |
| BILL | 3 | Pricing/metering/free band | §11.5/§14/§15.2 |
| UX | 9 | Surface consolidation + copy discipline | §12 |
| PRIV | 8 | Privacy & security commitments | §13 |
| MET | 7 | Success-metric instrumentation | §14 |
| ARCH | 11 | Architecture laws + sequencing | §15 |
| OQ | 9 | Open questions (status-tracked) | §16 |

---

## 4. Current Architecture (verified inventory)

One Cloudflare Worker (Next.js via OpenNext, custom entry `src/worker.ts` layering host-split 308s, §15 launch metrics, ALS request timing, six cron branches, queue consumer + DLQ drain) · two custom domains enforced from `src/lib/domains.ts` · Neon Postgres via Hyperdrive (`src/db/client.ts`: per-request connection, `prepare:false`, `fetch_types:false`) · Drizzle migrations 0000–0034 · Better Auth per-request (`src/lib/auth.ts`: cookieCache OFF with tripwire, fail-closed admin-plugin allowlist, admin-on-admin/self-lockout guards, audited mutations) · Paddle MoR · SES v2 via aws4fetch (`src/lib/email.ts`) · Smart Placement OFF (documented incident).

**Tenancy:** `forOrg` (`src/db/org-scope.ts`) is a thin composition root over 24 namespace factories in `src/db/org-scope/*` (ADR 0027 split, public API byte-identical); composite tenant FKs make cross-org references unrepresentable; `scripts/check-org-scope.mjs` + the tenant-isolation completeness tripwire enforce it in CI. Cross-org reads live only in `src/db/system.ts` / `src/db/admin.ts`, driven from cron/queue/admin seams. `src/db/schema.ts` remains a **1,749-line monolith of 45 tables** — every W6/W7 table was appended (see ARCH-005).

**Data plane:** frozen fact tables `metric_records` (natural PK `org_id, subject_id, metric_key, day, dim`; ON CONFLICT DO UPDATE) + `subject_day_signals` (24-slot histogram, NULL when the vendor lacks grain) · `CANONICAL_METRICS` now **29 keys / 11 families** (spec says 26/10 — stale; additive ADRs 0022 agentic + 0039 markers), mirror-pinned to the seeded `metric_catalog` by `tests/contracts.test.ts` · identity graph `subjects ↔ identities ↔ people` with manual `/reconcile` · three ingestion channels: 4 vendor connectors (`src/connectors/*` — pure `normalize()`, honesty gaps first-class; Copilot code-complete but founder-gated off the live surface via `NLV_PENDING_VENDORS`), Manual Sync (`@revealyst/agent` CLI → `POST /api/agent/ingest`, on-device allowlist, delete-then-upsert window restatement), and the OTel OTLP receiver (`POST /v1/metrics` + `/v1/logs` → pure decoder `src/lib/otel-ingest.ts`, tested against real captured fixtures; markers drive the capability engine's `measured` tier at ≥2 corroborating markers).

**Recommendation engine (one engine, three lenses — verified):** a single `deriveAttention` (`src/lib/score-insights.ts:661`) consumes the seeded `recommendation_catalog` via ONE per-org batched read, evaluates a closed comparator vocabulary per person in memory, ranks by the deterministic `computeUtility` (named exported weights, output-equivalence guard), applies opt-in role/tool + fails-closed prereq eligibility, dedupes by signalGroup, caps at 2 (digest 3). Personal dashboard, team overview, and weekly digest all call this same function (shared-source test-pinned); the exec memo wraps `composeNarrative`. Capability layer: `src/scoring/capability-state.ts` (pure) runs as a parallel reducer in the poller's score-recompute step with org-batched reads (query count independent of person count, perf-test-pinned).

**Surfaces:** `/dashboard` branches at `page.tsx:266` — org-of-one → PersonalSelfView (Growth Journey, Milestone, DailyNudge, Coaching, CapabilityProfile, Mission, DataConfidence cards + raw scores demoted behind a collapsed expander); team org → TeamOverview (exactly 5 audience-scoped card sections). `/maturity` = the 8-board-number model with confidence tiers, QoQ `notComparable`, plateau, refusal list. Exec one-pager = email (monthly cron, CAS opt-in) + `/api/exec-report` download from one shared `readExecReport`. Nav (`src/components/app-sidebar.tsx`): Overview, AI maturity, Connections, Account + admin items; `/people`, `/teams`, `/methodology`, `/indexes`, `/playbook` retired from nav but still routable. Onboarding is companion-pitch-first. All user-facing prose in 13 glossary/copy constant modules; the landing "Connects" strip derives from the connector registry.

**Email:** four lanes (weekly digest, budget alerts, renewal reminders, monthly exec memo), each `isEmailConfigured → CAS-claim → per-recipient try/catch`; digest carries RFC-8058 one-click unsubscribe; return instrumentation is server-side click-through (`digest_return`, `companion_revisit` at the worker seam — deliberately no open pixel).

**Testing & CI:** ~150 test files; the guard layer is unusually strong — tenant-isolation completeness tripwire, purge completeness tripwire, migration/output equivalence guards (catalog===retired-static-map; ranker-reduces-to-weakest-first), perf query-count tests, anti-gamification schema-shape + banned-phrasing tests, OTel decoder vs real fixtures, allowlist byte-identical mirror test. CI: check (build/typecheck/org-scope guard/test) + frozen-contracts ADR guard (PR-only) + preview-deploy.

---

## 5. Target Architecture

The spec's own verdict — **EVOLVE, not rewrite** — is confirmed by evidence; the target architecture equals the current architecture plus the following deltas (full rationale in §14 and the roadmap):

1. **Widen, don't fork, the self-view** for Companion-in-Team-orgs: when the sub-case-C ADR lands, the `org.kind` branch becomes "personal org → PersonalSelfView; team org member → PersonalSelfView(person-scoped) + TeamOverview(admin)", reusing the existing card set and digest personal lane. No parallel system. Runtime-invoke `assertTeamOnlyPseudonymized` on the composed team view as the defense-in-depth gate, and register the team-visible attention-item shape in the identity-bearing manifest *before* widening.
2. **Split `src/db/schema.ts`** into per-domain modules behind a barrel preserving the frozen import path (mirror of ADR 0027), under its own ADR, before the next table lands.
3. **Finish the measurement plane:** pure derivations `deriveSyncCadence` (over append-only `connector_runs`) and a shown→tried/dismissed engagement ratio (`recommendation_exposure × rec_interaction_state`, founder-only aggregate); a prominent digest→companion CTA tagged for `digest_return`; a named opt-in-rate figure; a committed Analytics Engine query for the MVP exit gate once OQ-001 is signed.
4. **Activate the dormant ranker inputs:** feed `triedRecIds` as `fatigueRecIds` and derive novelty from the shipped exposure log (both anticipated in code comments; currently inert), keeping the output-equivalence guard green.
5. **Content model for learning paths (GJ-007):** a pure, band-keyed static curriculum module sequencing the existing catalog (glossary-style; explicitly NOT an LMS — NOT-019), rendering the already-stored `learningResources`/`learning_path` columns.
6. **Harden edges:** device-token auth on `/v1/logs`; explicit `/v1/` branch in `domains.ts`; audit rows for Paddle lifecycle + account purge; purge-order test; ADR-number-uniqueness CI check.
7. **Rollout strategy:** all deltas are additive and independently shippable except #1 (ADR-gated) and #2 (frozen-contract ADR); nothing requires downtime, data migration beyond additive DDL, or a second engine of any kind.

---

## 6. Traceability Matrix

Full matrix: [traceability.csv](traceability.csv) (id → section, tier, domain, status, evidence). Rollup:

| Status | Count | IDs |
|---|---|---|
| Implemented | 142 | everything not listed below — including all 19 NOT-list absences, all 8 ENT entities, all frozen contracts (TEL-001..007, PRIV-001..006, PRIV-008, BILL-001..003), the full COACH pipeline, GJ-001..006/008, UX-001..009, and 8 of 9 PRIN |
| Partially Implemented | 10 | ARCH-004, ARCH-005, SYNC-003, TEL-016, MET-003, MET-005, PRIV-007, OQ-001, OQ-006, OQ-008 |
| Blocked (named gates) | 6 | WF-001, POP-001, POP-007, MET-004 (all: sub-case-C ADR / W6-A dogfood) · OQ-003 (M365/Workspace research) · OQ-004 (conversation-structure scope) |
| Missing | 2 | GJ-007 (learning-path content model) · TEL-012 (context-usage signal) |

Notable adjudications: OQ-002 (Custom Index Builder demotion) scored Implemented — the code matches the spec default (sidebar demotion, route intact) with the sign-off itself tracked as an open question. WF-007 scored Implemented — the cold-start path is honest ("invite more of the team", floor-gated, never a falsely-low chart); whether a literal computed "invite N more" count is required is an open question. GJ-008/NOT-017 verified as *test-enforced absences*, not just absences.

---

## 7. Screen-by-Screen Gap Analysis

Every routable screen, its V4 surface assignment, and its gap state:

| Screen | V4 surface | Status vs spec |
|---|---|---|
| `/` (marketing) | Marketing host | OK; registry-derived "Connects" strip; **founder-promo "$1/50% off" copy is not derived from any enforced constant** — verify against the actual Paddle price (claim-surface risk) |
| `/sign-in`, `/reset-password`, `/invite/[token]` | Auth | OK; invite-by-link shipped (WF-007) |
| `/onboarding` | Companion | OK — companion pitch renders *before* the connect wizard (WF-002); `FIRST_SYNC_AHA_COPY` is a dead constant (delete or wire) |
| `/dashboard` (personal org) | **Personal Companion** | OK on content (GJ-001..006, SCORE-003/004, COACH-006/009 all verified) — but the surface has accreted **~10 stacked cards**, in tension with §11.2 "one card, not a dashboard"; consolidation/progressive disclosure needs a product call |
| `/dashboard` (team org) | **Team Intelligence** | OK — exactly 5 audience-scoped sections (MVP-003); correlations folded into the narrative, anomalies into attention alerts (UX-004); capability coverage count-only + floored (POP-005); "People & teams" card links out to still-standalone rosters (fold is nav-level, not inline) |
| `/maturity` | Team/Exec | OK — 8 numbers + tiers + refusal list + CSV export (WF-008, MVP-005, SCORE-006) |
| Exec one-pager | **Executive** | OK as email + `/api/exec-report` download; deliberately no in-app page — confirm §12.1 "surface" intent (open question) |
| `/connections` | Settings-tier | OK — poll-vs-CLI copy split (SYNC-005), transparency panel (SYNC-004), staleness banner; **SYNC-003 same-click reward is split across two screens** (counts on /connections, positive nudge on companion) instead of one reward moment |
| `/settings` | Settings | OK — team/role management, visibility control (audited), custom-index link |
| `/spend`, `/billing`, `/compliance`, `/account`, `/reconcile`, `/members` | Settings/ops tier | OK; spend folded into dashboard/exec as a line (UX-002) |
| `/indexes` | Demoted | OK — out of nav, route intact, server-gated (UX-005/OQ-002) |
| `/people`, `/teams` | Legacy (deprecate-keep-shipping) | Reachable from dashboard/Settings links; acceptable per UX-003, full inline consolidation optional |
| `/methodology`, `/playbook` | Legacy | **`/playbook` is orphaned** — no nav entry, no Settings link, reachable only by URL; its planned fold into `capabilities.learning_path` is unbuilt (GJ-007) |
| `/legal/*` incl. `what-we-collect` | Public | OK — PRIV-006 page renders the actual allowlist constants, byte-pinned to the agent parser mirror |
| `/admin/*` | Platform admin | OK — two choke points, fail-closed plugin allowlist, credential-free views; no org-detail/audit-browse surface (nice-to-have) |

---

## 8. System Gap Analysis

Per required area; **only areas with findings are elaborated** — areas listed as "clean" had all their requirements verified Implemented with evidence in [traceability.csv](traceability.csv).

- **Navigation:** clean (UX-003/004/005 verified) except the orphaned `/playbook` route.
- **Onboarding:** clean (WF-002/003); one dead copy constant.
- **Authentication:** clean; POP-003 verified — `visibilityMode` gates names only, never recs; "permanent default" = new-org default + admin-audited loosening (confirm wording, open question).
- **Home / Growth Companion:** GJ-007 Missing (learning paths); card-sprawl tension (~10 cards vs "one card"); GJ-004 persistent next-step card verified Implemented.
- **Recommendations / AI Experience:** COACH-001..009 all verified; **fatigue/novelty terms inert** (exposure log shipped but unwired — `novelty` hard-coded 1 at `score-insights.ts:932`, `fatigueRecIds` never passed); role-eligibility gate live but structurally inert until role-specific catalog content exists (empty `applicable_roles` seed — by design per ARCH-008); `suggestedActionType` stored but never drives UI affordances.
- **Missions:** clean (ENT-008, GJ-006) — measured-crossing completion, opt-in-only write, anti-gamification test-enforced.
- **Insights:** clean (SCORE-008 taxonomy incl. milestone kind; SCORE-009 segments aggregate-only).
- **Team Management:** clean (WF-007, POP-004/005); cold-start copy could carry a computed invite-count (open question).
- **Admin:** no assigned requirement gaps; extra findings — **Paddle lifecycle + seat-metering mutations write no audit rows**; account purge deletes the org's own audit trail with no system-org record; no platform-admin roster view.
- **Shared Accounts / Identity Matching:** clean (POP-006, TEL-006); unresolved-subject count is computed and excluded from billing, but verify a user-visible "surfaced" rendering exists on the billing surface (flagged, minor).
- **Spend Analytics:** clean (folded per UX-002; budgets + alerts shipped).
- **Data Confidence:** TEL-016 partial — coverage computed, disclosed per-rec ("Based on N connected sources"), team aggregate shown; but `SignalCoverageBadge` is built+tested **dead code**, and a person with no surfaced recs sees no coverage signal at all.
- **Reporting:** clean (WF-008/009, MVP-005, UX-002); exec memo has the capability-coverage line with the same floor.
- **Notifications:** WF-004/006, MVP-004/006, V1-002, NOT-016 verified; **budget/renewal lanes have no opt-out or List-Unsubscribe** (product decision needed); digest's only tagged link is the footer settings link (see §16 Risks — this is the MVP-bet measurement risk); MET-001/002 wording says "open rate" while the implementation deliberately measures click-through (honest substitute — confirm).
- **Billing:** clean (BILL-001..003, TEL-007, NOT-014 — CAS-before-PATCH verified "textbook"); `allowOverFreeBand` opt-outs have legitimately widened beyond the spec's "upgrade/portal only" (privacy/account routes must never be paywalled — update spec, not code).
- **Settings:** clean.
- **Search:** no spec requirement exists; no search surface exists; nothing to reconcile (flagged as spec silence, no action).
- **Mobile:** see §11. **Accessibility:** see §12. **Security:** see §10. **Performance / Infrastructure:** see below. **Design System:** clean (UX-008 — base-nova/Base UI conformance verified). **Testing:** see §15.
- **Infrastructure:** ARCH-001/002 verified exactly (incl. Smart Placement OFF, DLQ, depth-1 Promise.all law on every post-spec surface); `/v1/*` OTel routes are only *incidentally* neutral-path (catch-all, not explicit) and excluded from request timing; DLQ is log-and-ack with no push alert (spec-satisfying, optional hardening).

---

## 9. Data Model Analysis

45 tables; every org-scoped table carries the three registrations (tenant-isolation SCOPED_READS with non-vacuous B-org seeds, account-deletion purge registration, ADR) — **the three-registration law held through all seven W6/W7 tables** (verified individually: `rec_interaction_state` 0024, `role_assignments` 0026, `recommendation_catalog` 0029, `user_capability_state` 0031, `mission_progress` 0032, `recommendation_exposure` 0033). Global reference tables (roles, capability graph, missions, metric/score catalogs) correctly org-less and seed-migrated. ENT-004 Outcomes correctly does **not** exist (the hollow-table invariant-(b) trap avoided). Purge ordering (children before `people`) is hand-maintained and correct today but **not order-asserted by the completeness tripwire** — add a dependency-walking test. Inert content columns (`capabilities.learning_path`, `recommendation_catalog.learningResources`) await GJ-007. `schema.ts` monolith: see ARCH-005 (the one structural refactor).

## 10. Security Analysis

All 15 security-domain requirements verified except PRIV-007 (partial) and POP-007 (gated). The three no-prompt-content enforcement points are real and independent (allowlist parser reads block *type* only; `MAX_DIM_LENGTH=128` + control-char rejection server-side; OTel decoder extracts only the three marker metrics). Credentials: AES-256-GCM DEK wrapped by versioned Worker-secret KEK, AAD-bound — and no "KMS" claim in shipped copy (one stale claim survives in an internal doc, §13). Retention/purge verified (90-day raw payloads; CI-enforced purge completeness). Named reveal is admin-gated + audited.

Defense-in-depth findings (none currently exploitable):
1. **`assertTeamOnlyPseudonymized` is never invoked at runtime** — the throwing predicate + completeness tripwire exist but run only in tests; team-view privacy currently rests on structural wiring (toPersonRef nulling, per-person data never passed to the team path). Either invoke it at the end of `readDashboardView` or re-document it as a test-time invariant. Must be resolved *before* the sub-case-C widening.
2. **`POST /v1/logs` is unauthenticated** — parses up to 10MB JSON and 200s without checking the bearer (contrast `/v1/metrics`); nothing is persisted, so exposure is discard-only compute, but V1-001's "reuses the device-token scheme" doesn't hold for this endpoint yet. Verify the token before the documented log-marker follow-up starts persisting.
3. The identity-bearing manifest covers exactly 3 surfaces; team-visible attention items carry no identity today but aren't manifest-registered — register the shape so a future change can't leak silently.
4. No step-up/MFA on platform-admin powers (impersonation is 1h-bounded, audited, admin-on-admin-blocked); spec-silent — founder call.

## 11. Mobile & Responsive Analysis

**Spec V4 is entirely silent on mobile — that silence is the finding.** The actual state is healthy: uniform fluid layout (Tailwind breakpoints, no hard-coded page widths), off-canvas Sheet sidebar at <768px, every table in an `overflow-x-auto` wrapper, single-column card stacking, responsive marketing/onboarding/sign-in. Latent traps: dialogs lack `max-h`/vertical scroll (clips on short viewports — one-line shared-primitive fix); fixed `p-6` shell padding on phones; zero responsive assertions in the test suite; `color-scheme: light dark` declared but no app dark-mode toggle. Decide whether mobile is a supported surface; if yes, one spec line + a viewport smoke test suffices — do not invent more than that.

## 12. Accessibility Analysis

**Spec V4 and the registry are silent on a11y — strong today by author discipline, ungoverned and unguarded.** Base UI primitives supply focus/ARIA/keyboard correctly; hand-rolled patterns are reference-quality (roving-tabindex radiogroup, InfoTip, role=img chart summaries, role=meter scores, no click-handlers on divs, no missing-alt surface). Gaps: no WCAG target stated; no automated a11y test (no axe anywhere); no skip-to-content link; sidebar nav is a `<div>` without a landmark or `aria-current`; no global `prefers-reduced-motion` reset; light-mode `--muted-foreground` on small text is borderline ~4.5:1 (measure). Recommended: adopt WCAG 2.1 AA as a principle, add jest-axe smoke tests over key flows, land the three small structural fixes.

## 13. Documentation & Claim-Surface Analysis

- **Spec drift (update the spec, not the code):** 26→29 canonical keys / 10→11 families; "latest migration 0023"→0034; "OTel receiver unbuilt"→shipped (`/v1/*`, ADR 0039); §15.2 "routes typed in api.ts"→the evolved two-tier convention (~20 non-frozen routes with colocated Zod schemas, all still behind `handleApi`/forOrg/402); §15.2 `allowOverFreeBand` "upgrade/portal only"→the ADR-backed wider set; §5.2's shared-assembly citation (`digest-content.ts`)→the true shared module is `deriveAttention`; §16.8's "~30–40 capability seed"→9 shipped deliberately (ADR 0035 rejected the larger seed as fabrication risk).
- **Claim-surface violations (PRIN-008):** `docs/Revealyst_Execution_Plan.md:66` still says "KMS wiring" (there is no KMS — the exact overclaim W3-N caught in copy, surviving in an active internal doc); **OQ-008's "founder sign-off received" is contradicted by ADR 0036's own "engineering assumption… executed autonomously" note** (the genuine W7 sign-off was missions/ADR 0037 — different item); the landing-page $1-promo copy is unverifiable against the enforced Paddle price.
- **ADR ledger:** collisions 0014×2 (bannered) and 0037×2 (un-bannered); README is a how-to, not an index; recommend renumbering the non-schema 0037 (cause-chain note) to 0040, adding an index table, and a duplicate-prefix CI check.
- **Cleanup candidates:** `docs/ai-capability-implementation-gap-analysis.md` (point-in-time audit, now fully shipped, no supersession banner) — banner or move to legacy; dead `FIRST_SYNC_AHA_COPY` constant.

## 14. Architecture Review — Reuse / Refactor / Rewrite / Remove

Consolidated verdicts from all 18 specialists (unanimous where overlapping):

**Reuse (no change):** org-scope factory system · frozen fact tables · deriveAttention + computeUtility + capability engine · handleApi/computeAccess/metering (CAS-before-PATCH "textbook") · admin choke points + fail-closed plugin hooks · four email lanes (deliberate, safety-preserving duplication) · worker entry seam + wrangler topology · Base UI primitive wrappers · companion card set + glossary modules · TeamOverview 5-card consolidation · exec compose path · MIN_PEOPLE floor plumbing.

**Refactor:** `src/db/schema.ts` split (ARCH-005's unfinished half — the one structural item) · `dashboard/page.tsx` (~1,400 lines holding both audience surfaces; extract PersonalSelfView/TeamOverview modules to make the POP-001 widening tractable) · runtime-invoke `assertTeamOnlyPseudonymized` + manifest extension · `/v1/logs` auth + explicit `/v1/` domains branch · ranker fatigue/novelty activation · §14 derivations (deriveSyncCadence, engagement ratio) · digest return CTA · ADR renumbering + CI uniqueness check · dialog max-height, shell padding, skip link, nav landmark, reduced-motion.

**Rewrite (net-new build, nothing to extend):** GJ-007 learning-path content model (pure band-keyed static curriculum — the only greenfield item) · jest-axe regression guard.

**Remove:** `FIRST_SYNC_AHA_COPY` dead constant · `SignalCoverageBadge` (or wire it — either, not limbo) · `docs/ai-capability-implementation-gap-analysis.md` to legacy/banner · `/playbook` once GJ-007 lands (or relink it until then).

**No rewrites of any shipped subsystem are warranted.** Legacy architecture is not being preserved out of inertia; every "keep" verdict above is evidence-based (guards, equivalence tests, honesty rules verified live).

## 15. Testing Analysis

The invariant-pinning culture is the repo's standout strength: tenancy completeness, purge completeness, migration/output equivalence, anti-gamification schema-shape + banned-phrasing, allowlist byte-mirror, OTel-fixtures-only decoding, perf query-count ceilings, shared-rec-source parity — all present and CI-wired. Unpinned invariants worth adding: purge *ordering*; ADR-number uniqueness; frozen-contracts guard requires only that *some* docs/decisions path changed (strengthen to require a NEW ADR file, or accept human review as backstop); the shared-source test pins the recommendation-kind prefix, not full cross-kind order; zero a11y and zero viewport assertions; the MVP exit-gate query itself is not committed anywhere. Known flakes (Windows fork crash, pseudonym collision) already documented in CLAUDE.md.

## 16. Risks

1. **MVP-bet measurement risk (highest):** the §14 exit gate rides on digest→companion returns, but the digest's only tagged link is a footer settings link — the gate may read falsely low and trigger a wrong no-go on the whole voluntary-return bet. Cheap fix, disproportionate consequence.
2. **Premature sub-case-C widening** would leak person-level data to manager surfaces at the exact moment of the flywheel's conversion; conversely the dormant runtime predicate means the current safety is structural-only. Sequence: predicate-at-runtime + manifest extension *first*, then the ADR, then the branch.
3. **Frozen-monolith merge contention:** every future table PR touches the 1,749-line schema.ts; the ADR ledger has already collided twice under parallel fan-out.
4. **Claim-surface drift compounding:** stale spec counts + the KMS remnant + the OQ-008 provenance overclaim are individually small but erode the "prose is a claim surface" discipline the product markets.
5. **Inert-by-default features masking regressions:** dead badge component, inert ranker terms, unrendered action taxonomy — each invites silent drift because nothing fails when they break.

## 17. Open Questions (consolidated; full list per-domain in traceability evidence)

**Founder sign-offs pending:** OQ-001 exit-gate N/threshold (instrumented, default 6 weeks, unratified) · OQ-002 Custom Index demotion ratification · OQ-008 third-ladder provenance (confirm or reword the sign-off claim) · companion card-count vs "one card, not a dashboard" · budget/renewal email opt-out policy · mobile-supported? · WCAG target? · billing events in audit_log? · account-purge accountability record (privacy-vs-accountability ADR) · exec memo in-app or email/export-only? · "open rate" wording vs click-through measurement.

**Engineering decisions pending:** runtime vs test-only privacy predicate · two-tier API contract convention (bless in spec vs contracts index) · schema.ts split scheduling · fatigue/novelty activation now that P7 shipped · `/v1/logs` auth timing · which 0037 ADR renumbers · MET-003/MET-005 derivations now vs volume-gated · TEL-012 scheduling (formally Future?) · SignalCoverageBadge wire-or-delete.

**Named gates (do not force):** sub-case-C ADR / W6-A dogfood clock · OQ-003 M365/Workspace research before any role expansion · OQ-004 conversation-structure scope before any design.

## 18. Prioritized Roadmap

See [implementation-roadmap.md](implementation-roadmap.md) — 6 phases: P0 governance/doc hygiene (parallel-safe, immediate) → P1 measurement-plane closure (protects the MVP bet) → P2 defense-in-depth hardening → P3 ranker/UX completion → P4 V1 remainder (GJ-007, TEL-012) → P5 gated work (sub-case-C companion-in-team, schema split ADR), with explicit parallelism, dependencies, and completion gates per phase.
