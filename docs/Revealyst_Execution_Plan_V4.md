# Revealyst — V4 Execution Plan

**Version:** 1.0 · **Date:** 2026-07-13
**Basis:** [Product Spec V4 — the pivot](Revealyst_Product_Spec_V4.md) (ground truth), verified
against `main` at `39e8625` by a **ten-domain repo-verification fan-out** (architecture ·
data model · UX surfaces · telemetry · metrics/scoring · AI coaching · performance ·
testing/seed · docs landscape · billing/email). Every implementation-status claim below was
checked against the code on 2026-07-13; file:line references are to that commit.
**Relationship to the [V1 Execution Plan](Revealyst_Execution_Plan.md):** that plan's waves
W0–W3 (and the W4/V1.5 waves in Spec V3 §16) are **complete and shipped** — it remains the
historical record and the home of orchestration rules 1–7 and the seven scope tripwires, which
**bind every workstream below verbatim**. This document is the execution plan for the V4 tiers
(Spec V4 §11): it turns MVP / V1 / Future into a dependency graph of workstreams.
**Execution model:** unchanged — parallel AI agents against frozen contracts; waves ordered by
hard dependencies only; a wave completes when its exit gate passes, not on a calendar.
**Guardrails G1–G10** ([AI Intelligence Implementation Plan](ai-intelligence-implementation-plan.md))
carry forward verbatim and are cited by number below.

---

## 0. Plan-on-a-page

| Wave | Theme | Parallel workstreams | Exit gate |
|---|---|---|---|
| **W5 — MVP: test the bet** | The §2 voluntary-return bet becomes testable: coaching content + delivery channel + measurement land together | A. Contract seams & guardrail debt · B. OTel spike · C. Personal Companion surface · D. Rec interaction state · E. Telemetry MVP · F. Milestones + digest delivery · G. Manual Sync UX · H. Team Intelligence consolidation + Exec distribution · I. Email lanes & instrumentation · S. QA & seed *(standing)* · N. Documentation *(standing)* | Companion live for personal orgs, score-first layout replaced; every §11.2 MVP row shipped; digest return-rate instrumentation **measuring** (the §14 exit-gate clock can start); no-streak decision recorded; founder dogfooding on prod |
| **W6 — V1: deepen the engine** | Catalog-as-data, identity-honest Companion in Team orgs, measured proficiency | A. Sub-case-C ADR + dual-source dedup + Companion-in-Team · B. Roles entity · C. Recommendation catalog as seeded data · D. OTel receiver (+ context-usage signal) · E. Proficiency band + learning paths · F. Monthly Exec narrative one-pager · G. Renewal reminders · S/N *(standing, continued)* | Companion renders for every member of a Team org with the audit predicate proving exclusion; catalog rows drive recs with the static map retired; OTel data lands from the founder's own Claude Code; exec one-pager emails monthly |
| **Future — gated ledger** | Nothing here is scheduled; each item has a named gate (§5) | Outcomes · role expansion · pulse panel · cross-org benchmarks · MCP server · resident agent · enterprise machinery · ChatGPT-export upload | Each item's own evidence gate (§5), never a calendar |

**The MVP boundary is a product boundary** (Spec V4 §11): W5 exists to test one sentence — an
individual will voluntarily return because the guidance is grounded in their own measured
behavior. The **§14 MVP exit gate** (default: 6 weeks of sustained weekly-digest open/return on
the founder's dogfood org) runs *after* W5 ships and **gates W6-A** (the first Team-tier
investment) — it does not gate W6-B/C/D, which serve the personal lane.

---

## 1. Gap analysis — implementation vs Spec V4

### 1.1 Status classification

**Shipped (build on, don't re-spec):** connectors ×4 · scoring engine + 3 team presets +
**person-level presets for personal orgs** (ADR `0014-personal-person-level-presets`, mig 0017 —
the substrate under "demoted to diagnostic") · identity resolution + `/reconcile` ·
shared-account detection · Paddle billing + free band (`FREE_TRACKED_USER_LIMIT = 5`,
count-based via `computeAccess` — **never** `org.kind`) · Spend Governance (in-app alerts) ·
Custom Index Builder (closed vocabulary, team/org-level only — verified no person-level leak) ·
Manual Sync Phases 1–2 (ingest returns `{subjects, records, signals}` counts already) ·
Intelligence Phases 1–2 (maturity model + `/maturity`, weekly digest with strict `isNewBest`,
RFC-8058 unsubscribe, staleness suppression) · marketing site + share cards · benchmark lanes
correctly separated (`percentile()` in-org vs `percentileFor` modeled-external).

**Partial (exists, needs V4 work):**

| Capability | What exists | The gap |
|---|---|---|
| Individual self-view | `PersonalSelfView`, inline in `dashboard/page.tsx:185`, **org-of-one only** (branch at `:174`) | Score-first layout (3 `ScoreCard`s headline); no Growth Journey framing; Team-org members get `TeamOverview` instead — the #1 structural gap (Spec §5.1) |
| Coaching | 7-entry static map, centrally gated (measured, normalized<40, weight≥0.2, cap 2, dedup by signalGroup, central disclaimer) | Renders only as generic attention `Alert`s — no dedicated card; entry type lacks all §8.2 catalog metadata; no interaction state |
| Digest | Weekly, per-org assembly, one flat `Promise.all`, honest staleness suppression | `digest-content.ts` is **email-only** — zero in-app consumers; "cap 3" slices the *whole* attention list, so a connection error can crowd out every coaching rec; no Growth-Journey content |
| Insight taxonomy | `deriveAttention` emits: connection error/paused, unresolved usage, anomaly, plateau, honesty gaps, shared accounts, score drops, coaching recs — deterministic impact order | `milestone/positive` kind missing entirely; `spend`/`agentic-transition` are retroactive labels on generic kinds, not first-class emitted values |
| Milestones | `isNewBest` computed at digest time only, strict `>`, no storage | No immediate surfacing, no milestone catalog, no storage/dedup concept |
| Narrative | `composeNarrative` (pure, template-based) renders as one team-dashboard card | Not in digest, not in maturity report, no export, no email, no monthly cadence — nowhere near a "one-pager" |
| Maturity distribution | Full model shipped (axes, L0–L4 with demotion, 8 board numbers, confidence tiers, QoQ `notComparable`, plateau, `MATURITY_NOT_SCORED`) | Zero export/CSV/print affordance anywhere under `src/components/maturity/` |
| Budget alerts | `evaluateBudgetAlert` (vendor-reported spend only), live-computed, admin-gated, in-app banner | **No email lane and no crossing/dedup state at all** — the `budgets` table has no last-alerted column; an email lane without a CAS would spam on every poll |
| Sync feedback | CLI stdout prints pushed counts; `SyncStatusBadge`/`SyncStalenessBanner` show status | No in-product "what this sync sent" transparency panel, no same-click reward, no copy split of the two sync mental models |
| Flywheel metrics | `deriveLaunchFunnel` computes invites-sent/accepted/multi-member | Consumer is a manually-run founder CLI script — not scheduled, not surfaced |
| Visibility audit | `assertTeamOnlyPseudonymized` throws on 3 surfaces in private mode | Hand-written over exactly 3 surfaces; a 4th surface passes **vacuously**; no completeness test (Spec §9.4a) |

**Missing (verified absent — zero code):** rec interaction state (no `snooze`/`dismiss`/`tried`
match anywhere) · Roles entity · recommendation-catalog table · Outcomes · OTel receiver (zero
`otel|opentelemetry|OTLP` refs) · marker-level proficiency (zero real matches) · signal-coverage
indicator (data exists per-row via `metric_records.connectionId`/`sourceConnector`; no read
surface) · milestone storage/detection beyond digest `isNewBest` · **all §14 leading-indicator
instrumentation for digest opens, in-app revisit, and companion opt-in** (no pixel, no UTM, no
session events — the MVP exit gate is unmeasurable today) · budget email lane · CSV exports ·
per-person maturity/level of any kind.

**Obsolete (kill/retire in W5):** score-first `PersonalSelfView` layout · `src/scoring/segment.ts`
`segmentTeams` path (**app-dead** — zero application callers; its sole consumer is the offline
calibration script `scripts/calibrate-scores.ts` / `npm run calibrate:scores`, which W5-A must
port or retire in the same PR; the live segmentation is a *second, divergent* `segmentFor` in
`src/lib/segments.ts`) · standalone `/people` + `/teams`
rosters as nav items · `/indexes` nav prominence · pre-pivot positioning copy (marketing page
`src/app/page.tsx:104` "segmented from Skeptics to AI Natives"; launch collateral headlined
"My AI Fluency: 78" — bannered by this plan's doc pass, rewritten in W5-H/W5-N).

**Conflicting (code contradicts a V4 principle today):**
1. **Dual-source double-count is a live defect, not a future risk** — a person visible via both
   an admin-API connector and the local agent (with `consentIdentity`) auto-links twice via
   `email_match`, and `rowsForSubjects` (`src/scoring/recompute.ts:119-141`) sums all linked
   subjects' rows with no dedup: every `sum` component (tokens, spend) double-counts.
   `tracked_user` billing is **not** affected (Set of personIds). Triggerable today; W6-A fixes
   it, W5-N documents the caveat immediately.
2. **Segment member-naming under loosened visibility** — in `managed`/`full` modes,
   `SegmentBreakdown` lists named/pseudonymous members per segment bucket
   (`src/lib/segments.ts:108-114`). Deliberate (the audit predicate documents the asymmetry),
   but stronger than §7.3's "aggregate cohort lens" — W5-H resolves per §1.2 (5).

### 1.2 Spec V4 errata & clarifications (verified; downstream agents follow THIS list)

1. **§7.3 cites the wrong segment module.** The vocabulary to audit is the *live*
   `src/lib/segments.ts` (person-level, single-signal, thresholds 25/50/75), not
   `src/scoring/segment.ts` (team-level, two-signal, app-dead — only the offline calibration
   script uses it). W5-A removes the dead path (script ported/retired with it); W5-H audits
   the live one.
2. **§11.2 onboarding inversion is M, not S.** `OnboardingWizard` is a single flat screen, not a
   step wizard — a pre-connect companion pitch is new UI structure, not a copy reorder.
3. **§6.3 "wire polled-but-unused fields" understates OpenAI.** Nine endpoint families
   (embeddings, images, audio ×2, moderations, vector stores, code-interpreter sessions,
   file/web search) are **never fetched by the client at all** — client + normalize work, not a
   normalize widening. Also: audio tokens and cost `line_item` are received-but-dropped.
4. **Two extra deliberate drops must stay dropped** (add to §6.3's protected list): Anthropic
   claude_code `model_breakdown.tokens.*` (double-counts the usage report) and Copilot
   `totals_by_ide` ("IDEs are editors, not features") — both comment-documented and test-pinned.
   "Fixing" either into emission is a regression.
5. **§7.3 "aggregate cohort lens" is default-mode-only.** Managed/full visibility deliberately
   names segment members. W5-H decision: keep segments **count-only in every mode** (the
   pivot-consistent reading — a personality label attached to a name is the thing §7.3 kills) —
   founder may override at gate review.
6. **§8.4 Growth Journey "level" is org-scoped pre-proficiency.** The only shipped level is the
   org's maturity level; identical to the person only for an org-of-one. The MVP card is
   therefore **explicitly personal-org-scoped** (which §9.4 forces anyway); the per-person scale
   arrives with W6-E's proficiency band. Two scales only: org matures, person progresses.
7. **§8.1 digest "cap 3" is not coaching-specific.** `DigestContent.recommendations` is the
   whole `deriveAttention` output sliced to 3, and the email renders every kind identically.
   W5-F gives coaching a reserved lane + kind-aware rendering.
8. **§15.2 "cross-org reads only in `system.ts`" undercounts** — `src/db/admin.ts` (ADR 0016) is
   a second sanctioned cross-org module for platform-admin reads. Both are legitimate.
9. **§7.1's "kill the blended AI Health number" is preventive** — no blended individual number
   exists to remove. It's a review guardrail, not a removal PR.
10. **§11.2 budget email alerts are M, not S** — the SES transport exists, but the crossing
    needs new persisted CAS state (`(orgId, monthKey, highest-alerted-threshold)`) or it spams
    on every re-evaluation; there is also no shared email layout/registry — each new email type
    follows the digest's render-fn + copy-module + idempotency-state pattern from scratch.
11. **ADR ledger:** next free number is **0027**; two ADRs legitimately share 0014
    (`org-scope-batch-read-methods` and `personal-person-level-presets`) — cite 0014 **by slug
    only**; both files now carry a disambiguation note. Migration sequence is at **0023** and
    independent. Claim numbers at build time (G8), re-check after final sync to main.
12. **`orgs.kind` never becomes `"team"`** — nothing sets it. Any lane logic follows
    `digest.ts`'s `memberCount > 1` pattern; branching on `kind === "team"` is a dead branch.

---

## 2. Migrate / deprecate / remove / retain

| Disposition | Item | How / when |
|---|---|---|
| **Migrate** | Score-first `PersonalSelfView` → Personal Companion surface (band + narrative + next step; 0–100 behind an expander) | W5-C, composition of shipped parts |
| **Migrate** | 7-entry static coaching map → seed rows of the catalog table (content reuses verbatim: id/slug/componentKey/signalGroup/title/body all map) | W6-C; map stays the source of truth until the catalog ADR lands |
| **Migrate** | `/people` + `/teams` rosters → Team Intelligence cards + Settings (relocate `CreateTeamDialog`/`ManageTeamMembersDialog`; pages are 67/96 lines, low risk) | W5-H |
| **Migrate** | `composeNarrative` team-dashboard card → monthly Exec one-pager (email + export) | W6-F |
| **Migrate** | Digest content assembly → shared in-app + email source (`digest-content.ts` gains its first in-app consumer) | W5-C/W5-F |
| **Deprecate (demote, keep shipping)** | Custom Index Builder out of nav prominence (`app-sidebar.tsx` `ADMIN_NAV_ITEMS`); raw 0–100 as individual headline; `SegmentBreakdown` member-naming (per §1.2 (5)); share-card "My AI Fluency: N" copy → band-first framing | W5-C/W5-H |
| **Remove** | `src/scoring/segment.ts` `segmentTeams` dead path (+ its test); reconcile the surviving vocabulary into one module | W5-A |
| **Remove** | Pre-pivot positioning claims in live marketing copy (`src/app/page.tsx:104` segment pitch) — via the derive-from-registry / fact-check discipline | W5-N |
| **Retain untouched** | Scoring engine + honesty rules · maturity model math · attribution ladder · all four connectors' normalize contracts (incl. every deliberate drop) · Manual Sync ingest path · privacy architecture (3 enforcement points) · Paddle/metering CAS · frozen contracts (4 planned ADR-gated amendments only: interaction state [W5-D], Roles [W6-B], catalog [W6-C], Outcomes [Future]) | — |
| **Retain as reference (bannered by this plan's doc pass)** | Feasibility study, marketing strategy/website plans, launch collateral (copy must be re-cut to V4 positioning before use), Architecture brief (Basis line fixed to V4) | done in this PR |

---

## 3. Wave 5 — MVP: test the bet

All workstreams parallel; W5-A items 1–2 land **before** W5-D merges (predicate + seams first).
One agent, one workstream, one PR chain; review + fixes **before** `gh pr create` (merge-race).

### W5-A. Contract seams & guardrail debt *(tech-debt workstream)*

- **Objectives:** unblock three future table-adding workstreams from bolting namespaces onto a
  1,901-line frozen monolith; make self-view privacy provable before any new self-view surface.
- **Deliverables:** (1) `src/db/org-scope.ts` split into `src/db/org-scope/<namespace>.ts`
  factories with `org-scope.ts` as a thin composition root **keeping its filename and exporting
  `forOrg`/`OrgScopedDb` unchanged**; (2) **`.github/workflows/ci.yml` frozen-contract regex
  updated in the same PR** (`^src/db/org-scope(\.ts$|/)`) — without this, post-split PRs
  silently skip the ADR gate; (3) `assertTeamOnlyPseudonymized` generalized to a
  surface-registry with a completeness tripwire (the tenant-isolation/purge tripwire pattern):
  every registered team-visible read surface must be claimed, unregistered surfaces fail the
  test; (4) delete the app-dead `segmentTeams` path — its one live consumer,
  `scripts/calibrate-scores.ts` (`npm run calibrate:scores`, the preset-calibration workflow),
  is ported to the surviving segmentation module or retired **in the same PR** (founder
  sign-off if retiring); (5) `schema.ts` **not** split (lower urgency —
  flat table appends are cheap) — reorder by domain opportunistically in the next
  table-adding PR.
- **Dependencies:** none. Items (1)+(2) before W5-D/W6-B/W6-C merge; (3) before W5-C ships and
  hard-before W6-A.
- **Technical approach:** mechanical extraction — the `forOrg` body is one object literal with
  zero cross-namespace calls (verified); each namespace closes only over `(db, orgId)`. Split
  order by size: connections (351 lines), scores (393), metrics (208), then the rest.
- **Data/telemetry changes:** none. **UX impact:** none.
- **Performance:** none (same queries, same shapes). Watch-list note: `maturity.ts` (1,053
  lines) and `api-impl.ts` (1,034) are on the same growth path — no action now.
- **Testing:** existing suites must pass unchanged (the split is refactor-only); the new
  predicate completeness test is the deliverable; `check-org-scope.mjs` still passes (its rules
  are directory-scoped, verified).
- **Risks:** the CI-regex landmine (mitigated: same-PR requirement, above); parallel workstream
  merge conflicts against org-scope.ts (mitigate: land early, orchestrator serializes).
- **Effort:** M (split) + S (predicate) + S (dead code). **ADR:** one, for the public-API-
  preserving split (claim next free number at build time).
- **Acceptance:** CI green with zero test edits outside the new predicate suite; a synthetic
  unregistered team surface fails the completeness test; `git grep segmentTeams` returns
  nothing (the calibration script ported or retired in the same PR — never left broken).

### W5-B. Claude Code OTel receiver spike *(fires immediately — blocks nothing, gates 3 of 4 missing signal families)*

- **Objectives:** answer the one open unknown — OTLP (protobuf vs JSON) ingestion viability on
  workerd within CPU/request limits — and fix the exporter auth scheme.
- **Deliverables:** spike report in `docs/research/` (dated, house supersession style); recorded
  OTel payload fixtures under `fixtures/otel/`; a go/no-go + shape decision for W6-D.
- **Dependencies:** none. **Technical approach:** `agent-ingest` is the template (device-token
  auth from token→orgId, cheap-auth-before-parse, zod contract, transactional upsert, post-
  commit recompute enqueue); the spike only de-risks the wire format + 202-accept→queue-batch
  deviation. **Data/telemetry:** none yet (fixtures only). **UX:** none.
- **Performance:** validate the 128 KB queue-message bound → raw_payload-pointer batching.
- **Testing:** fixture capture from the founder's own Claude Code with
  `CLAUDE_CODE_ENABLE_TELEMETRY=1`.
- **Risks:** OTLP/HTTP on workerd genuinely infeasible → fall back to JSON encoding or a
  pre-aggregating relay; the spike exists to find out.
- **Effort:** S (~1 week, already scoped by the Intelligence Plan). **Acceptance:** report +
  fixtures merged; W6-D can start from a decided shape.

### W5-C. Personal Companion surface + onboarding inversion *(feature workstream)*

- **Objectives:** the pivot's core surface — replace the score-first self-view with band +
  narrative + next step; sell the companion before the connect list.
- **Deliverables:** (1) Growth Journey card: maturity level (org-of-one ⇒ personally true, per
  §1.2 (6)) + ONE next step (top coaching rec) + why + benefit; (2) persistent coaching card
  (dedicated component — today recs render as generic attention alerts); (3) daily nudge card
  drawn from last-synced data — one card, never a dashboard, never a data-freshness demand
  (principle 7); (4) the three `ScoreCard`s demoted behind an expander ("diagnostic details");
  (5) `OnboardingWizard` inversion: companion pitch screen ("this is how *you* get seen — by
  yourself" + the three privacy enforcement points) before the connect cards; (6) first-sync aha:
  "You're at **Trial** — here's the one thing to try next"; (7) new `companion-glossary.ts` +
  onboarding copy moved to the `*-glossary/copy` convention.
- **Dependencies:** W5-A (3) predicate before ship; W5-F supplies digest-content's in-app reuse.
- **Technical approach:** pure composition — maturity (`readMaturityView` or folded fields),
  coaching (`deriveAttention`), digest content (`digest-content.ts` gets its first in-app
  consumer). No new storage for v0. Scoped to `org.kind === "personal"` (org-of-one) — the
  Team-org branch stays `TeamOverview` until W6-A.
- **Data/telemetry:** none (W5-I instruments the revisit events).
- **UX impact:** the headline change of the pivot. Positive-first framing in every headline
  string; deficiency language only inside expanders; honest empty/degraded states reused.
- **Performance:** ONE depth-1 flat read — either thread onto `readDashboardView` or a new
  `readCompanionView` composite; **never** `readDashboardView` + `readMaturityView`
  back-to-back (two depth-1 stages = regression). Register in the perf suite (G10).
- **Testing:** jsdom+RTL component tests asserting copy presence AND absence (no "Score N"
  headline in the default render); perf-suite registration; adversarial content fact-check on
  every new string (G7).
- **Risks:** undergraded onboarding work (§1.2 (2) — budget M); "composition" quietly becoming
  a fourth ladder (guard: level copy comes only from `maturity-glossary.ts`).
- **Effort:** M (surface) + M (onboarding). **Acceptance:** a fresh personal org sees pitch →
  connect → sync → "You're at <level>, try X" with the raw score only behind an expander;
  founder dogfoods on prod.

### W5-D. Rec interaction state *(feature workstream; the wave's one new table)*

- **Objectives:** snooze / dismiss / "mark as tried" per (org, person, rec) — the cheap
  forerunner of the Outcomes loop and the substrate of the §14 rec-engagement metric.
- **Deliverables:** table + `forOrg` namespace + typed API routes + card affordances on the
  W5-C coaching card + digest respect (a dismissed rec never re-mails).
- **Dependencies:** W5-A (1)/(2) merged first (new namespace lands in the split layout); W5-C
  for the rendering surface (API can merge first).
- **Technical approach:** small self-view-only table keyed `(org_id, person_id, rec_id, state,
  acted_at)`; `rec_id` = the static map's stable `id` (already the catalog-PK candidate —
  survives the W6-C migration unchanged). Reads join the page's existing flat `Promise.all`
  (the `connectorRuns.list` precedent: +1 query, still depth 1). Routes via
  `handleApi`/`appContext`; 402 gate applies by default.
- **Data/telemetry changes:** THE full three-registration law + ADR (Spec §15.2): (1) ADR at
  next free number; (2) `SCOPED_READS` entry with a **non-vacuous B-org seed row**; (3)
  `account-deletion.ts` registration (likely `PURGE_TABLES`); + `drizzle-kit generate`; +
  `src/contracts/api.ts` route shapes (frozen — same ADR).
- **UX impact:** recs become actionable, not just readable; self-view-only — managers never see
  interaction state (NOT-list; code-enforced via the W5-A predicate registry).
- **Performance:** +1 query into the existing batch; verified low-risk.
- **Testing:** three-registration tripwires; unit tests on state transitions (snooze expiry,
  dismissed-never-remails); component test on the card; seed-plan rows so the demo org shows a
  non-empty state (the always-empty-table visual trap).
- **Risks:** frozen-contract touch (schema + contracts/api) — the ADR is the mitigation, and CI
  enforces the pairing; number collisions under parallel fan-out (G8: claim at build time,
  re-check before merge).
- **Effort:** L. **Acceptance:** all three tripwires green; dismiss on the dashboard is honored
  by the next digest run in the same fixture.

### W5-E. Telemetry MVP *(telemetry & metrics workstream)*

- **Objectives:** wire the honest signal that's already being paid for; make coverage
  differences between people visible; zero new privacy surface.
- **Deliverables:** (1) wire polled-but-dropped fields per the verified inventory — Anthropic:
  `server_tool_use.web_search_requests`, cost `description`/`cost_type` split, claude_code
  `terminal_type`; Cursor: event-envelope flags worth emitting (`isHeadless`, `isChargeable`);
  Copilot: `loc_suggested_to_delete_sum`, `totals_by_language_feature`/`totals_by_model_feature`
  where honest — each candidate individually justified against double-count risk, not
  bulk-wired; (2) OpenAI re-scoped per §1.2 (3): fetch + normalize the endpoint families that
  serve the wedge (start: `web_search_calls`, `code_interpreter_sessions`; audio/images only if
  a score consumes them); (3) workflow diversity promoted to a first-class *surfaced* signal —
  read-time `distinct_dims(feature_used)` stat + a milestone comparator (no new metric key, no
  new storage; the middle option consistent with "no new engines"); (4) per-person
  signal-coverage indicator — pure in-memory aggregation over `identities → subjects.connectionId
  → connections` already in the dashboard batch (**zero new queries**, verified); (5)
  optimization metadata on the static rec map (impact/difficulty/confidence/action-type — type
  extension, G6-compliant, becomes catalog columns in W6-C).
- **Dependencies:** none hard; (3)'s milestone comparator feeds W5-F.
- **Technical approach:** connector `normalize()` widenings with per-field tests; **pin the
  deliberate drops** (incl. §1.2 (4)'s two additions) with explicit "stays dropped" tests so a
  future agent can't "fix" them into double-counts. New metric keys, if any survive the
  double-count audit, are ADR-gated catalog+contract additions — default to dims on existing
  keys.
- **Data/telemetry changes:** metric emission only; no new tables.
- **UX impact:** coverage badge on person rows ("3 sources" vs "1 source") — an honesty surface,
  self-view + aggregate-safe.
- **Performance:** zero new round trips (verified for (3)/(4); (1)/(2) are poller-time).
- **Testing:** recorded-fixture diffs per connector (extend `fixtures/connectors/**`);
  stays-dropped pins; coverage-indicator unit test on a two-person differing-sources fixture.
- **Risks:** double-count regressions (the pinned-drop tests are the guard); OpenAI client work
  ballooning (cut order: audio/images first).
- **Effort:** S per connector widening; M for OpenAI; S for (3)/(4)/(5).
- **Acceptance:** each newly wired field lands in `metric_records` from fixtures; coverage
  indicator renders; all stays-dropped pins green.

### W5-F. Milestones, insight taxonomy & digest as delivery vehicle *(AI-coaching workstream)*

- **Objectives:** the missing `milestone/positive` insight kind; the digest becomes the
  Growth-Journey delivery channel it's specced to be.
- **Deliverables:** (1) milestone detection (first agent session, feature-breadth threshold,
  N-week cadence, new-best) surfaced **immediately** on the Companion surface and in the
  digest; (2) the named insight-taxonomy applied: `kind` becomes first-class on
  `AttentionItem` for `spend`/`agentic-transition`/`milestone` (labels today are retroactive);
  (3) digest coaching lane fixed per §1.2 (7): reserved rec slots + kind-aware rendering
  (coaching visually distinct from a connection error); (4) digest Growth-Journey content
  extension (`DigestContent` fields + `digest-email.ts` blocks + `digest-copy.ts` prose); (5)
  the **no-streak decision recorded** in this plan: **weekly consistency with forgiveness,
  rendered as narrative copy only — no streak counter UI, no daily anything** (spec default,
  §8.4; founder may veto at gate).
- **Dependencies:** W5-C (surface), W5-E (3) (breadth comparator).
- **Technical approach:** decision rule (perf-verified): milestone detection derives **only from
  rows already in the page's flat batch** (trend rows, `agentActiveRecords`, feature dims) — if
  a milestone needs a lookback beyond the window, it moves to **poller-time precompute**, never
  a new request-time query. v0 needs no storage (recompute-on-read like `isNewBest`); if
  show-once semantics are wanted, that's a small state table under the full §15.2 law —
  default v0: badge-until-superseded, no table.
- **Data/telemetry:** none for v0 (see above).
- **UX impact:** positive-first becomes real — the surface can celebrate, not just warn.
- **Performance:** zero new request-time queries by construction (the decision rule).
- **Testing:** milestone-crossing fixtures (new); digest snapshot tests extended; kind-aware
  render component tests; strictness property (`>` never `>=`) inherited from `isNewBest` tests.
- **Risks:** milestone spam (cap + impact-order via the existing deriveAttention machinery);
  gimmick creep (the NOT-list bans XP/leagues/streak-flames — review-blocker).
- **Effort:** S–M. **Acceptance:** seeded milestone persona renders the badge same-day in-app
  and in the next digest; a digest week with a connection error still shows ≥1 coaching rec.

### W5-G. Manual Sync UX *(feature workstream)*

- **Objectives:** resolve §10's tensions honestly — reward at sync-click, transparency of what
  left the device, two mental models separated.
- **Deliverables:** (1) same-click reward: "this sync captured N records across D days — here's
  one thing you did well" composed from the ingest response counts (`{subjects, records,
  signals}` — already returned) plus the sync window the CLI already holds as a request field,
  and one positive fact from already-computed data; (2) "what this
  sync sent" transparency panel: event/day counts + the **actual allowlisted field names**
  echoed from the agent's parse allowlist; (3) `/connections` copy split: one-click connector
  poll vs run-a-CLI-command as visibly distinct sections; (4) never a sync nag — staleness
  stays a badge (G5).
- **Dependencies:** none (independent of W5-C; links into it).
- **Technical approach:** the ingest response is the raw material (verified); the field-name
  allowlist is read from `packages/revealyst-agent`'s parse contract so the panel can't drift
  from what's actually sent (the derive-from-code discipline, G7). CLI prints a link to the
  transparency view after push.
- **Data/telemetry:** none new; `connector_runs` (`agent_ingest` kind) already records per-run
  facts.
- **UX impact:** trust surface — the on-device allowlist made visible; feeds the public
  "what we collect" schema page (W5-N).
- **Performance:** reads existing rows; no new stages.
- **Testing:** unit tests on summary composition from a recorded ingest response; component
  tests; agent-CLI contract test extended for the response echo.
- **Risks:** the "one thing you did well" line fabricating positivity on thin data — reuse the
  honesty gates (no rows → no claim; `EmptyState` fallback).
- **Effort:** S. **Acceptance:** a fixture sync renders counts + field names + one honest
  positive; zero nag copy anywhere.

### W5-H. Team Intelligence consolidation + Executive distribution *(feature/UX workstream)*

- **Objectives:** dashboard-itis → three audience-scoped surfaces; the maturity model gets
  distribution, not a redesign.
- **Deliverables:** (1) `TeamOverview`'s panels — Spec §12 says ~17; recounted at `39e8625`
  it's 18–20 depending on what counts as a panel — folded into ~5 cards (Team AI Health ·
  maturity · training opportunities/plateau · benchmarks/distribution · data trust
  [honesty gaps + shared accounts + coverage]); (2) `/people` + `/teams` folded into Team
  Intelligence + Settings (dialogs relocated, pages retired from nav); (3) `/indexes` demoted in
  `app-sidebar.tsx`; (4) within-org percentile lens + board-ready **CSV export** of the 8
  maturity numbers (+ confidence tiers, sourced from `readMaturityView` — zero new queries);
  (5) Spend Governance folded into the exec view as a line; (6) segment audit per §1.2 (5):
  count-only in every visibility mode + `MIN_PEOPLE`-style floor before naming an implicit
  champion in any copy; (7) share-card copy reframed band-first.
- **Dependencies:** W5-A (3) predicate (any surface change re-registers); W5-C ships the
  personal side first or in parallel.
- **Technical approach:** curation over existing reads — `readDashboardView` fields regrouped;
  no new reader. CSV is serialization of already-fetched data (route via `handleApi`, exempt
  from nothing — 402 applies).
- **Data/telemetry:** none. **UX impact:** the manager's view becomes action-shaped; cold-start
  honesty ("invite N more") via `EmptyState`.
- **Performance:** fewer rendered panels over the same batch; no query changes; perf suite
  re-asserts ceilings.
- **Testing:** component tests per card; de-anonymization fact-check on all narrative team copy
  ("your champions are 3 people") — adversarial, non-author (G7); CSV golden-file test.
- **Risks:** silent capability loss in the fold (mitigate: card-by-card inventory mapping every
  retired panel to its new home — in the PR description); champion floor forgotten in copy
  (the fact-check owns it).
- **Effort:** S–M. **Acceptance:** nav shows the three surfaces; every retired panel's data
  reachable within 2 clicks; CSV opens in a spreadsheet with confidence tiers intact.

### W5-I. Email lanes & instrumentation *(telemetry/billing workstream)*

- **Objectives:** the §14 MVP exit gate becomes measurable; budget alerts reach inboxes.
- **Deliverables:** (1) budget-threshold **email** alerts: new crossing-state CAS
  (`(org_id, month_key, highest_alerted_threshold)` — the `claimWeekAndRotateToken` pattern),
  admin-recipient audience, digest-pattern render-fn + copy module; (2) digest **return-rate
  instrumentation**: UTM-style params (`?src=digest&wk=<isoWeek>`) on digest CTA links + a
  server-side visit event keyed to the week — **click-through, not an open pixel** (pixels
  silently fail for privacy-conscious clients — the honest-measurement choice); (3)
  Companion-surface revisit events via the `launch-events.ts` Analytics Engine pattern (no PII,
  coarse dims) extended to authenticated surfaces; (4) flywheel funnel: `deriveLaunchFunnel`
  gets a scheduled weekly run writing a founder-visible report (admin surface or email) —
  "instrumented, not aspirational" (§14); (5) companion opt-in rate instrumentation lands with
  W6-A (nothing to opt into yet — noted, not built).
- **Dependencies:** W5-C (the surface being measured); digest infra (shipped).
- **Technical approach:** every email type follows the digest precedent (render fn + `*-copy.ts`
  + idempotency state + `isEmailConfigured` guard + per-recipient try/catch). Instrumentation
  events carry event name + coarse dim only.
- **Data/telemetry changes:** one small budget-alert state table **or** column on `budgets`
  (ADR decides; if a table — full §15.2 law); Analytics Engine events (no DB rows).
- **UX impact:** minimal UI; a settings line for budget-alert email opt-out.
- **Performance:** poller/cron-time work; zero request-path cost.
- **Testing:** CAS idempotency under redelivery (the metering test pattern); email snapshot
  tests; event-emission unit tests; a replayed digest click lands the week-keyed visit event.
- **Risks:** alert spam without the CAS (the CAS is the deliverable); measurement theater —
  instrument only §14's named indicators, nothing speculative.
- **Effort:** M. **Acceptance:** threshold crossing emails exactly once per month-threshold;
  the founder can read "digest sent → clicked → in-app within 7d" for a real week.

### W5-S. QA & seed data *(standing workstream — mirrors W1-S; runs through W6)*

- **Objectives:** own the seams: fixtures, tripwires, perf registrations, the gate evidence pack.
- **Deliverables:** new fixtures (interaction-state rows; milestone-crossing series;
  signal-coverage two-person variance; OTel payloads from W5-B; catalog rows in W6);
  seed-plan extensions (milestone persona; interaction-state rows; **no**
  companion-in-team-org persona until the W6-A ADR — don't seed ahead of privacy law);
  perf-suite registrations for every new surface; banned-phrasing guard extended over all new
  copy modules; the W5 evidence pack (tests, perf table, isolation proofs, fact-check findings).
- **Dependencies:** feeds/fed-by every workstream. **Effort:** continuous, S per PR.
- **Testing strategy notes (per-item recipes live in the workstream blocks above):** component
  tests = jsdom+RTL asserting presence AND absence, pinned to the spec section they protect;
  every new table = three registrations + non-vacuous B-org seed; every new copy module =
  fact-check + banned-phrasing.
- **Acceptance:** wave gate consumes one evidence file; zero unregistered tables/surfaces.

### W5-N. Documentation *(standing workstream — content is a claim surface)*

- **Objectives:** Spec V4 stays the single source of truth **during** the work, not after.
- **Deliverables:** (1) the consolidation pass shipped **with this plan's PR** (see §7 — AGENTS.md
  resynced to CLAUDE.md@V4, supersession banners on pre-pivot docs, launch-collateral
  positioning banners, ADR-0014 disambiguation, Architecture-brief basis fix, broken link fix);
  (2) per-PR doc rule: any workstream PR that changes behavior described in a doc updates that
  doc in the same PR (review-blocker otherwise); (3) the public **"what we collect" schema page**
  generated from the agent's actual allowlist (§13 commitment; pairs with W5-G); (4)
  score-definitions/scoring-explained gain the one-line "the number is a diagnostic, not the
  headline" note; (5) launch-collateral copy re-cut to V4 positioning **before any launch
  execution**; (6) `/revise-claude-md` at each wave end + AGENTS.md resync in the same PR
  (no automation exists — the pairing is the rule).
- **Dependencies:** none; runs continuously.
- **Risks:** prose overclaims (the W3-N/W3-P pattern) — every product claim fact-checked by a
  non-author reviewer against schema/credentials/connector-facts before merge.
- **Effort:** S per PR. **Acceptance:** at W5 gate, a fresh agent reading CLAUDE.md + Spec V4 +
  this plan needs no other document to start a workstream — and no doc it would read contradicts
  the shipped product.

**Exit gate W5** (founder-judged, evidence-based, rule 4): a fresh personal org walks
pitch → connect → sync → "You're at <level>, try X" with the raw score demoted; every §11.2 MVP
row demonstrably shipped or explicitly founder-deferred; return-rate instrumentation produces a
real number for a real week; the adversarial content fact-check found-and-fixed list is in the
evidence pack; **the §14 dogfood clock starts**.

---

## 4. Wave 6 — V1: deepen the engine

W6-A is **gated on the §14 MVP exit gate** (first Team-tier investment). W6-B → W6-C sequence
is hard (Roles before role-specific content). W6-D depends only on the W5-B spike; W6-E on W6-D
for *measured* claims (directional variant may precede it).

### W6-A. Sub-case-C ADR + dual-source dedup + Companion in Team orgs *(feature; closes the #1 structural gap)*

- **Objectives:** every member of a Team org gets the Companion — with data-layer proof their
  manager can't see it, no double-counting, and no billing surprise.
- **Deliverables:** the sub-case-C ADR landing all three of (Spec §9.4): (a) the provable
  exclusion audit predicate (delivered by W5-A's registry — this ADR extends registration to
  the new surface class); (b) **dual-source dedup** — fixes the live defect (§1.1): a person
  reachable via both an admin API and the local agent must not double-sum; (c)
  surfaced-not-billed treatment for local-only signal. Then: the dashboard branch at
  `dashboard/page.tsx:174` gains the per-member self-view path inside Team orgs; opt-in flow +
  opt-in-rate instrumentation (the §13 "privacy enables adoption" hypothesis, measured).
- **Dependencies:** §14 gate; W5-A (3); W5-C (the surface being extended).
- **Technical approach (dedup, from the verified defect chain):** dedup at score-input assembly
  (`rowsForSubjects`, `src/scoring/recompute.ts:119-141`) — when one person's linked subjects
  span sources reporting the **same underlying activity family** (Claude Code via Console API
  vs local agent), prefer the higher-attribution source per (metric_key, day) window rather
  than summing; exact precedence rules are the ADR's core content. The billing path
  (`tracked_user` Set) is verified unaffected. Deduped-away rows surface as an honesty note,
  never silently vanish (invariant b).
- **Data/telemetry changes:** possible `identities`/link metadata for source-family tagging
  (ADR decides); opt-in state (small self-view table under the full §15.2 law).
- **UX impact:** the flywheel's conversion moment — a team member finally gets *more* personal
  value inside a team, provably private.
- **Performance:** self-view read = the personal companion read scoped to the member; threads
  onto the existing pattern; dedup runs at recompute (poller), zero request-time cost.
- **Testing:** the dedup fixture (one person, two sources, overlapping windows — asserts no
  double-sum AND no silent drop); predicate completeness over the new surface; opt-in-rate
  event tests; tenant isolation re-sweep.
- **Risks:** the highest-stakes privacy work in the plan — gate order is law: **ADR merged
  before any surface code**; de-anonymization in small teams (floors, W5-H precedent).
- **Effort:** M–L. **Acceptance:** two-source fixture person's spend counted once; a Team
  member sees their Companion; the manager's every read surface passes the completeness-
  enforced predicate; unbilled local-only people appear surfaced-not-billed.

### W6-B. Roles entity *(data workstream)*

- **Objectives:** a real FK target for `applicable_roles` before any role-specific content.
- **Deliverables:** `roles` table (engineering-only seed values), person→role assignment
  (manual, Settings), full §15.2 registrations + ADR.
- **Dependencies:** W5-A seams. **Approach:** seeded reference data (`metric_catalog` precedent)
  + an org-scoped assignment table. **Not** derived from HRIS/org-chart sync (NOT-list).
- **Data/telemetry:** two small tables (reference + assignment). **UX:** a Settings control;
  nothing else until content uses it. **Performance:** joins the existing batch (+1 query max).
- **Testing:** three registrations ×2; assignment CRUD tests. **Risks:** scope creep toward
  org-chart features — tripwire. **Effort:** L (mostly registration burden).
- **Acceptance:** tripwires green; a person can hold a role; catalog columns can FK it.

### W6-C. Recommendation catalog as seeded data *(AI-coaching workstream; supersedes G6's letter, preserves its intent — by ADR)*

- **Objectives:** the growing catalog without an engine: content = data, evaluator = code, no
  LLM anywhere in selection or generation.
- **Deliverables:** catalog table seeded from the 7-entry static map (verbatim content
  migration) + the §8.2 metadata columns (roles, tools-as-capability-nouns, requiredSignals,
  benefit, difficulty, confidence, resources, related workflows, insight kind, suggested-action
  type from the closed 3-value taxonomy); evaluator (`deriveAttention`) reads catalog rows
  through ONE per-org read; `requiredSignals` formalizes the existing closed comparator
  vocabulary (measured-ness · threshold-below · min-weight · signalGroup-dedup · cap) as
  structured data — no new comparator kinds without an ADR; the static map retired after a
  cutover release.
- **Dependencies:** W6-B (the `applicable_roles` FK target); W5-D (`rec_id` continuity —
  verified: the static ids survive as PKs).
- **Technical approach (verified recipe):** the `score_definitions` shape — nullable `org_id`
  (NULL = global), `(org_id, slug, version)` unique with `nullsNotDistinct()`, **idempotent
  migration-file seed** (`INSERT … ON CONFLICT DO NOTHING`), rows immutable per version;
  live-read pattern (not the `metric_catalog` TS-mirror pattern — content shouldn't be
  duplicated into a constant). Growing the catalog = a reviewed PR inserting rows of
  human-written, fact-checked copy.
- **Data/telemetry changes:** the table + §15.2 law + ADR (the ADR **must contain the
  batched-read design** — perf floor is a stated ADR requirement, Spec §8.2).
- **UX impact:** none directly (same cards, richer metadata rendering).
- **Performance:** ONE per-org catalog read folded into the existing flat batch (dashboard) and
  the digest's existing single `Promise.all`; per-person evaluation in memory. Never N
  per-person round trips (~500–670ms each — a naive loop is a multi-second page).
- **Testing:** seed↔evaluator contract test (every row's requiredSignals parse against the
  closed vocabulary — unparseable row fails CI); migration test proving the 7 legacy entries
  produce identical recs pre/post cutover; catalog-row fixtures; fact-check on every seeded
  body (each row is a claim surface).
- **Risks:** the catalog quietly becoming a DSL (requiredSignals stays a closed enum —
  review-blocker); content-ops treadmill (catalog grows by reviewed PRs only — no editorial
  feed, NOT-list).
- **Effort:** L–XL. **Acceptance:** static map deleted; identical-output migration test green;
  a new rec ships as a data PR with zero evaluator changes.

### W6-D. Claude Code OTel receiver + context-usage signal *(telemetry workstream)*

- **Objectives:** the only honest source for true accept/reject, real active time, retries —
  gates all *measured* proficiency.
- **Deliverables:** `/v1/metrics` + `/v1/logs` routes (202-accept → queue-batch →
  one-chunk-one-UTC-day aggregation into the frozen grain); exporter auth per the W5-B
  decision; content-flags-off-by-default + scrubbing (the third §13 enforcement point);
  context-usage as a **directional** signal (≥2-signal rule before it drives any rec);
  onboarding copy for enabling `CLAUDE_CODE_ENABLE_TELEMETRY`.
- **Dependencies:** W5-B spike decision. **Approach:** agent-ingest template (auth,
  cheap-auth-first, zod, transactional upsert, post-commit recompute) with the async
  queue-batch deviation; **new queue = create it in BOTH `deploy.yml` and `ci.yml`
  preview-deploy** or every PR preview goes red (standing gotcha).
- **Data/telemetry:** new metric keys via catalog+contract ADR (accept/reject, active time,
  retries); `raw_payloads` pointers for batches over the 128 KB queue bound.
- **UX impact:** connections page gains the OTel channel card (honest "what this adds" copy).
- **Performance:** ingestion is queue-consumer work; request path untouched.
- **Testing:** fixture-replay from W5-B recordings; aggregation idempotency under redelivery;
  scrub tests (content fields never persisted); tenant isolation on any new table.
- **Risks:** wire-format surprises post-spike (contained by the spike); double-count vs the
  local-agent channel — **lands on W6-A's dedup rails, which must merge first for any
  founder-org dogfood with both channels active**.
- **Effort:** L (route+auth · consumer+aggregation · UI, a 3-PR chain). **Acceptance:** founder-
  org OTel data lands normalized with correct day-grain; accept/reject metrics exist with
  `measured` confidence; both-channels dogfood shows no double-sum.

### W6-E. Proficiency band + marker breakdown + learning paths *(AI-coaching workstream)*

- **Objectives:** the person-scale of the two-ladder law: band + ~11 markers, self-view only.
- **Deliverables:** marker computation (F3.1–F3.3), band L0 Dormant → L4 Orchestrator,
  strong/weak per marker with "what moved" decomposition; static learning-path curricula keyed
  to band (merged with "learning goals" — one content model, rides the W6-C catalog);
  **capped at `directional` until W6-D data flows, then upgraded to `measured`** (G2 labels
  rendered, never implied).
- **Dependencies:** W6-C (content model), W6-D (measured tier); a directional-only first cut
  may ship earlier at founder discretion (the Intelligence Plan's stated fallback).
- **Approach/UX:** self-view only (W5-A predicate registry — G3); composite band is the
  *secondary* label, markers first; Growth Journey card upgrades its level source from
  org-maturity to the person band (resolving §1.2 (6) permanently).
- **Data/telemetry:** band-history persistence only if trend rendering needs it (then §15.2
  law); markers derive from existing + OTel metrics.
- **Performance:** marker math in-memory over the existing batch.
- **Testing:** marker unit tests against fixtures with known-truth bands; ≥2-signal rule tests;
  predicate registration; banned-phrasing on band copy.
- **Risks:** the band reading as a grade (positive-first copy law; "discovery, never
  deficiency"); directional shipped as measured (G2 tests).
- **Effort:** M–L. **Acceptance:** founder sees their own band + markers with honest tier
  labels; a manager provably cannot.

### W6-F. Monthly Executive narrative one-pager *(feature workstream)*

- **Objectives:** the exec artifact — memo, not chart wall.
- **Deliverables:** monthly composed narrative (8 maturity numbers + trajectory + plateau +
  spend line + honesty-gap trend) as email + downloadable export; `composeNarrative` extended
  from the team-dashboard card into the distributable.
- **Dependencies:** W5-H (consolidated exec view), W5-I (email-type pattern + its CAS
  precedent). **Approach:** monthly cron → queue → per-org compose (one flat read) → SES;
  month-keyed idempotency state; template-composed, zero LLM (G6).
- **Data/telemetry:** send-state row (month CAS). **UX:** an exec settings toggle.
- **Performance:** poller-time. **Testing:** golden-file narrative snapshots across
  notComparable/first/plateau states; idempotency; fact-check (a narrative is claims).
- **Risks:** fabricated-sounding prose on thin data (the `notComparable` honesty states are
  load-bearing — test them). **Effort:** M. **Acceptance:** founder org receives a monthly memo
  whose every number traces to the maturity read.

### W6-G. Renewal reminders *(feature workstream)*

- **Objectives:** manually-entered vendor contract dates → honest reminders (no vendor reports
  renewal dates — labeled as user-entered, never inferred).
- **Deliverables:** date field on connections (or a small table — ADR decides), Settings entry
  UI, reminder email at T-30/T-7 riding the W5-I email pattern.
- **Dependencies:** W5-I. **Effort:** M. **Testing:** reminder-window unit tests + send CAS.
- **Acceptance:** an entered date produces exactly two reminders, labeled user-entered.

**Exit gate W6:** Team-org members use the Companion behind the completeness-enforced predicate;
catalog drives recs with the static map deleted; OTel data flows from the founder's own usage
with no cross-channel double-count; exec memo delivered; every new table's three registrations
green; evidence pack reviewed.

---

## 5. Future ledger (gated — never calendar-scheduled)

| Item | Named gate |
|---|---|
| Outcomes entity (rec engagement → next-period signal delta; never code-quality) | A real outcome signal exists — W5-D "tried" data shows usable volume. An always-empty table is an invariant-(b) trap: do not ship hollow |
| Role expansion beyond Engineering | **Evidence-gated:** the §16 (3) research question (M365 Copilot / Google Workspace admin APIs as honest telemetry) answered affirmatively — until then there is no honest data-acquisition strategy |
| Planning-behaviour + conversation-structure signals | OTel receiver live + the §16 (4) design answer (scope vs no-prompt-content stance) |
| Real cross-org k-anonymous benchmarks | Consent volume (≥20 orgs/cell); the swap seam (`resolveBenchmarkSource()`) already exists |
| Read-only MCP server over org analytics | Personal-value proof (the §14 gate sustained) |
| Perceived-vs-measured pulse panel | User-reaction evidence (§16 assumption 4) |
| Resident desktop agent | `last_success_at` cadence telemetry shows manual sync failing habit formation |
| Enterprise connectors / SSO / SCIM | A first Enterprise customer (trigger-gated) |
| ChatGPT-export upload | Parked from the V1.5 cut order; demand-gated |

---

## 6. Critical path, parallelization, blockers, quick wins

**Critical path (dependency spine):**
`W5-A(3) predicate → W5-C Companion → [§14 dogfood clock, ~6 weeks] → W6-A sub-case-C →
Companion-in-Team` — the pivot's conversion moment sits at the end of this chain, and the §14
clock is the one segment agents cannot compress. Second spine: `W5-B spike → W6-D OTel → W6-E
measured proficiency`. Fire W5-B immediately for the same reason W0 filed OAuth approvals
first: it's the longest lead item and blocks nothing else.

**Fully parallel in W5:** C, D, E, F, G, H, I are independent PR chains (C↔F share the digest
seam — coordinate via contracts, not branches; D needs A(1) merged first). **Parallel in W6:**
B, C, D, F, G; A gated on §14; E behind C/D.

**Blockers (external / founder):** §14 exit-gate numbers (default 6 weeks — sign-off item) ·
Custom-Index demotion sign-off (spec default: demoted) · no-streak decision (spec default
recorded in W5-F — veto window at gate) · §16 (3) role-telemetry research (Future gate) ·
§16 (4) conversation-structure scope (Future gate).

**Quick wins (S, high leverage, no dependencies):** signal-coverage indicator (zero queries —
already in the batch) · sync transparency panel + same-click reward (ingest counts already
returned) · dead `segmentTeams` deletion · nav consolidation (one file) · maturity CSV export
(serialization of an existing read) · docs consolidation (shipped with this PR).

**Orchestration reminders (inherited, enforced):** rules 1–7 + tripwires verbatim; G8
numbering claimed at build time; merges serialized after any ADR/migration-bearing PR;
`gh pr checks` output captured and grepped before any merge — never piped into `gh pr merge`.

---

## 7. Documentation state & the single-source-of-truth rule

Shipped **with this plan's PR** (wave-start, not wave-end):

| Doc | Action taken |
|---|---|
| `AGENTS.md` | Full resync from CLAUDE.md (was V3-pointing, missing the custom-domains split, stale vitest/prod facts — the most operationally dangerous drift found); header now names the pairing rule: any CLAUDE.md edit resyncs AGENTS.md in the same PR |
| `docs/Revealyst_Execution_Plan.md` | Header note: W0–W3 complete; rules/tripwires still binding; V4 waves live here |
| `CLAUDE.md` | Ground-truth block links this plan |
| `docs/marketing-strategy.md`, `docs/marketing-website-plan.md` | Supersession banners (pre-pivot positioning: CTO-first, "Fluency (flagship)"); broken `documenation-plan.md` link fixed |
| `docs/Revealyst_Feasibility_Study.md` | Supersession banner (business math stands; positioning superseded by V4 §1–§2) |
| `docs/Architecture-brief.md` | Basis line → Spec V4; production hosts corrected to the custom-domain split |
| `docs/launch/launch-plan.md`, `announcements.md`, `directories.md` | Positioning banners: copy predates the pivot — re-cut against V4 §1–§2 before any launch execution (the share-card "My AI Fluency: 78" headline is exactly what V4 kills) |
| `docs/decisions/0014-*.md` (both) | Collision disambiguation note each; cite by slug; next free number 0027 |
| Everything else (compliance, legal, gates, research, ops-runbooks, scoring docs, connector-facts) | Verified current/reference — untouched; `ops-runbooks.md` is code-referenced (`scripts/rotate-kek.ts:4`) and must never move |

**Standing rules (W5-N/W6-N):** docs update in the same PR as the behavior change
(review-blocker); wave-end `/revise-claude-md` + AGENTS.md resync; every new user-facing claim
fact-checked by a non-author reviewer; launch collateral rewritten before use, not at launch
moment.

---

## 8. Top execution risks

| Risk | Signal | Response |
|---|---|---|
| Dual-source double-count reaches a real user before W6-A | A Team-org member connects a vendor API *and* runs the local agent with consent | W5-N documents the caveat now; W6-A's dedup is the fix; W5-S adds the two-source fixture early so the defect is pinned before it's fixed |
| The §14 gate stalls the whole W6 wave | Dogfood return-rate ambiguous at 6 weeks | Only W6-A is gated; B/C/D/F/G proceed; founder re-cuts N or the threshold — the gate is a decision point, not a dead stop |
| org-scope split breaks the ADR CI gate | Post-split PRs to `src/db/org-scope/**` merge without ADRs | The regex update is **in the same PR** as the split (W5-A deliverable 2); W5-S adds a CI meta-test asserting the guard fires on a synthetic namespace-file diff |
| Catalog drifts toward a DSL | requiredSignals grows comparator kinds ad hoc | Closed-enum contract test (unparseable row fails CI); new comparators need their own ADR |
| Newly wired fields double-count | A "fix" un-drops a deliberate drop | Stays-dropped pinned tests per §1.2 (4); connector fixture diffs reviewed against connector-facts |
| Positive framing becomes fabricated positivity | Milestone/reward copy fires on thin data | Honesty gates inherited (no rows → no claim); banned-phrasing guard extended; fact-check |
| Parallel-fan-out numbering collisions (repeat of W4) | Two open PRs claim ADR 0027 / migration 0024 | G8 + orchestrator serializes ADR/migration-bearing merges; renumber-before-merge is the loser's job |
| Instrumentation privacy drift | Event payloads accrete identifying dims | `launch-events.ts` pattern is the contract: event name + coarse dim only; reviewed against §13 |
| Companion ships as a fourth ladder | XP/streak/level mechanics appear in a PR | NOT-list is a review-blocker; the two-scales law (§1.2 (6)) cited in review invariants |
| Doc drift resumes post-consolidation | CLAUDE.md/AGENTS.md diverge again | The same-PR pairing rule (§7) + wave-end resync; W5-N owns it |

---

## 9. Founder sign-off items (carried from Spec V4 §16, with plan defaults)

1. **§14 exit-gate numbers** — plan default: 6 weeks founder-org dogfood, digest
  click-through → in-app within 7 days as the return signal (W5-I makes it measurable).
2. **Custom Index Builder demotion** — plan default: demoted in W5-H (nav only; feature intact).
3. **No-streak decision** — plan default recorded in W5-F: weekly-consistency-with-forgiveness
  as narrative copy only; no counters.
4. **Segment member-naming under loosened visibility** — plan default (§1.2 (5)): count-only in
  every mode.
5. **W6-E directional-first proficiency** — ship a directional band before OTel, or wait for
  measured? Plan default: wait for W6-D unless dogfood demands otherwise.

---

*Produced by fleet orchestration: a ten-domain repo-verification fan-out synthesized against
Product Spec V4 by the orchestrating agent. Every status claim verified against `main` at
`39e8625` on 2026-07-13. This plan is execution-ready input for `/kickoff <workstream>`
sessions; each workstream block is the seed of that session's plan-mode brief.*
