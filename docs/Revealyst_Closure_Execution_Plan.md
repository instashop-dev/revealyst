# Revealyst — V4 Closure & Hardening Execution Plan (Wave 9 + gated Wave 10)

> Execution-ready plan converting the Spec V4 gap-analysis roadmap
> ([implementation-roadmap.md](product/implementation-roadmap.md), merged PR #225) into
> build-ready workstreams. Grounded at `main` = `5fe43e2` by a 7-domain read-only
> specialist fan-out (architecture, backend, frontend, data/migrations, UX/a11y, QA/CI,
> docs/governance) — every file/line anchor below was verified against code, not prose.
> Follows the operating rules in [CLAUDE.md](../CLAUDE.md) (rules 1–7, three-registration
> law, honesty invariants a–d) and inherits the cross-cutting laws L1–L9 of the
> [AI Capability Execution Plan](Revealyst_AI_Capability_Execution_Plan.md) §1 verbatim.
>
> **Wave numbering:** W7/W8 are complete. This plan is **Wave 9** (non-gated closure —
> roadmap phases P0–P4 plus the schema-split P5.2, which needs only an ADR and a quiet
> window, not an external gate) and **Wave 10** (the externally gated tail — roadmap
> P5.1 companion-in-team-orgs and P5.3 role expansion). Task ids keep the roadmap's
> phase labels (`T0.x` = roadmap P0 item) for traceability.

---

## 0. Plan-on-a-page

**The thesis.** The gap analysis found 142/160 requirements implemented and zero
requirements built wrong. What remains is *closure*, not construction: make the §14
MVP-bet instrumentation measure what it claims (before the ~6-week dogfood clock matures),
convert documented-but-dormant safety invariants into enforced ones (before the gated
companion-in-team widening makes them load-bearing), activate shipped-but-inert
recommendation machinery, close the two genuinely missing V1 features, and restore the
"prose is a claim surface" discipline. Nothing here is a rewrite; almost nothing is a
migration (one seed migration + at most one optional table in the whole wave).

| Phase | Milestone | User-visible value | Effort | Risk |
|---|---|---|---|---|
| **P0** | Governance & claim-surface hygiene | none (trust/citability) | S | Trivial |
| **P1** | Measurement-plane closure | digest→companion CTA; visible source coverage; same-click sync reward | S each | Low |
| **P2** | Defense-in-depth hardening | none (enforced invariants) + a11y basics | S each | Low |
| **P3** | Ranker & companion completion | tried recs rotate; action-aware buttons; leaner companion; split dashboard modules | S–M | Med-low |
| **P4** | V1 remainder | learning paths (GJ-007); context-usage signal (TEL-012, OTel-gated) | M each | Low |
| **P5 · W10** | Gated work | Companion-in-Team-orgs; role expansion | M–L | Gated |

**Numbering at build time.** Next migration is **0035**. ADRs: the T0.1 renumber consumes
**0040**, so the next *new* ADR is **0041**. Verify with `ls drizzle/*.sql` /
`ls docs/decisions/` immediately before each PR — the sequences are independent and a
parallel merge can claim your number (W4/W6 lesson).

**Standing constraint (W6 lesson):** serialize the *builds* (not just merges) of any two
workstreams that both touch `schema.ts`/migrations until T5.2 (schema split) lands. In
this wave only T4.2 (seed migration) and the optional T3.5b (preference table) qualify —
do not build them concurrently.

---

## 1. Corrections to the roadmap (evidence-based deviations)

The fan-out verified every roadmap item against code. These findings **supersede the
roadmap's wording** where they differ; each is reflected in the task specs below.

1. **`/playbook` is not a learning surface.** `src/app/(app)/playbook/page.tsx` is the
   shipped *visibility-readiness* playbook (per-user API-key migration for shared-account
   cleanup) — unrelated to learning curricula. GJ-007 (T4.1) therefore ships a **new**
   curriculum module and leaves `/playbook` alone (optional cross-link), rather than
   "folding or retiring" it.
2. **GJ-007 needs no migration.** The inert columns (`capabilities.learning_path` at
   `src/db/schema.ts:1458`, `recommendation_catalog.learning_resources` at
   `schema.ts:1348-1351`) are NULL/`'{}'` for every seeded row. Curriculum content
   belongs in a pure code module (house glossary pattern), not in backfilled columns —
   avoids a migration and keeps reference content out of mastery data.
3. **The "invite N more" cold-start copy does not exist yet** — no such string anywhere
   in `src/`. T3.5a is a *build* (product call first), not a copy fix.
4. **The "KMS" claim survives at four lines**, not one: `docs/Revealyst_Execution_Plan.md`
   lines 60, 66, and 181, **plus `docs/approvals.md:58`** ("store the App private key per
   the W0-C encrypted-credential contract (KMS envelope)") — an affirmative claim, not a
   warning-against.
5. **The OQ-008 provenance overclaim lives in `docs/product/requirements.csv:160`** —
   Spec V4 §16.8 itself never claims sign-off (it still reads as an open ask), and ADR
   0036's own "engineering assumption… executed autonomously" note is the ground truth.
6. **Spec V4's stale "OTel receiver (unbuilt)" claim is located precisely**: line 237
   ("Claude Code OTel receiver (unbuilt — verified: zero application references)…") —
   contradicted by the shipped receiver (P8: `src/app/v1/metrics/route.ts`, mig 0034,
   ADR 0039). Included in T0.4 as delta (g).
7. **No sign-off ledger exists anywhere.** `docs/approvals.md` covers external filings
   only (GitHub App, Paddle, legal). T0.5 must *create* the product-sign-off ledger, not
   append to one.
8. **Budget/renewal opt-out is bigger than "S".** Neither lane has any unsubscribe
   mechanism or preference storage; a settings preference means a new org-scoped table →
   ADR + three registrations + migration. Re-graded M and gated on a founder policy call
   (T3.5b).
9. **The 0014 ADR collision is already bannered** (both files); only 0037 is un-bannered —
   and the renumber touches nothing else (every "ADR 0037" reference in code/tests/docs
   points at missions, none at the cause-chain fix).
10. **`connector_runs` HAS a retention window: 90 days.** `purgeExpiredRetention`
    (`src/db/system.ts`, `CONNECTOR_RUNS_RETENTION_DAYS = 90`) batch-deletes
    `poll`/`agent_ingest` rows older than 90 days on the nightly retention cron — so the
    T1.2 cadence window must sit inside 90 days (fine for any sane cadence
    distribution, but the constraint is real and must be documented in the derivation).
    Bonus finding: `system.ts`'s own docstring says the purge covers "`kind = 'poll'`
    ONLY" while the code purges both kinds — a stale claim to fix in passing (§7).
11. **`companion_revisit` exists only in Workers Analytics Engine**, not Postgres. The
    honest Postgres-derivable opt-in proxy for T1.4 is `connections` rows with
    `vendor='claude_code_local'` + `authKind='device_token'` (the agent/OTel connection).
12. **`audit_log`'s documented scope excludes machine actions** ("user-initiated
    mutations… machine actions are NOT logged here", `schema.ts:896-923`). T2.4's billing
    events are machine-triggered — the ADR must widen the table's documented intent (or
    choose another home), not just add rows.
13. **A require-NEW-ADR frozen-contracts guard would break legitimate PRs** (ADR
    renumbering/edit PRs like the very T0.1 in this plan). T2.5 is therefore a decision
    task with a recommended alternative, not a blind strengthening.
14. **A digest CTA to `/dashboard` double-fires both metrics**: `digestReturnDim()`
    (`src/lib/launch-events.ts:89-99`) is pathname-agnostic on `?src=digest`, and
    `isCompanionRevisit()` (`:109-119`) matches GET `/dashboard` — one click relates a
    digest to a companion revisit, exactly what the §14 gate needs.

---

## 2. Migrate / Deprecate / Remove / Retain

| Disposition | Item | How / when |
|---|---|---|
| **Retain untouched** | Every shipped subsystem — the gap analysis' verdict is zero rewrites. All frozen contracts, engines, guards remain as-is | — |
| **Refactor (frozen-contract ADR)** | `src/db/schema.ts` → 13 per-domain modules behind a barrel (T5.2) | Mirror of ADR 0027; `drizzle.config.ts` path unchanged; zero-diff `drizzle-kit generate` as acceptance |
| **Refactor (no ADR)** | `src/app/(app)/dashboard/page.tsx` (1,408 lines) → `personal-self-view.tsx` + `team-overview.tsx` + shared helpers (T3.4) | Pure move; `Promise.all` batches verbatim; not a frozen path |
| **Activate (no schema change)** | `deriveAttention`'s `fatigueRecIds` param (exists, never passed) + a new `recentlyShownRecIds` novelty input from the shipped exposure log (T3.1) | Output-equivalence guards extended first |
| **Migrate (seed-only)** | TEL-012 context-usage metric key → `CANONICAL_METRICS` + `metric_catalog` seed insert, mig 0035 (T4.2) | Contract ADR; OTel-gated rendering (≥2-source rule) — or formally move to Future |
| **Remove** | `SignalCoverageBadge` + its test (dead; concept re-homed on the Data Confidence card, T1.5) · `FIRST_SYNC_AHA_COPY` (`src/lib/companion-glossary.ts:232-237`, zero imports) | T1.5 / T0 cleanup |
| **Deprecate (banner/move)** | `docs/ai-capability-implementation-gap-analysis.md` → supersession banner or `docs/legacy/` (T0.5) | Point-in-time audit, fully shipped |
| **Not built (tripwires)** | LMS/courses/certification (NOT-019) · XP/streaks/leagues · prompt-content ingestion · ML service | GJ-007 stays a static content module; banned-phrasing tests extended |

---

## 3. Phased milestones & exit criteria

| Phase | Wave | Depends on | Exit criterion |
|---|---|---|---|
| P0 Governance | W9 | — | ADR prefixes unique in CI; zero "KMS" outside `credentials.ts` comments; requirements.csv provenance corrected; sign-off ledger exists with OQ-001/002/008 entries (signed or explicitly pending); spec refresh contains no code-contradicted status claim. *Human gate: founder reviews the sign-off recordings (rule 4).* |
| P1 Measurement | W9 | — | Each §14 leading indicator is a tested pure derivation or a committed query; a digest click relates to a companion revisit; a 1-source vs 3-source person is visibly distinguishable on the self-view without a rec being surfaced |
| P2 Hardening | W9 | — | Synthetic identity-bearing team view throws at runtime in a test; unauthenticated `POST /v1/logs` → 401; purge-order test green; a plan change and a purge each produce an audit row (post-ADR); axe smoke suite green |
| P3 Ranker/companion | W9 | P1 items none; founder call on T3.3/T3.5 only | A tried rec visibly rotates next period; equivalence + shared-source guards green; dashboard file split with perf tests unchanged |
| P4 V1 remainder | W9 | T4.2 needs OTel marker (gated rendering) | Band-keyed ordered curriculum renders from the capability profile; banned-mechanic tests green; TEL-012 key exists (or formally moved to Future) |
| P5 Gated | W10 | W6-A dogfood outcome (clock since 2026-07-14); T2.1 + T3.4 merged first | Founder judges the sub-case-C evidence pack: runtime predicate throws on synthetic leak, dual-source dedup test on the self-view read path, billing unchanged, opt-in metric (MET-004) live |

---

## 4. Critical path, parallelization, quick wins, blockers

**Critical path:** there is almost none — that is the point of this wave. The one real
chain is **T2.1 (runtime predicate) + T3.4 (dashboard split) → T5.1 (sub-case-C
widening)**, and T5.1 is externally gated anyway. Everything else is parallel.

**Do-first quick wins (S, zero dependency, disproportionate value):**
1. **T1.1 digest companion-return CTA** — the highest-risk item in the whole gap
   analysis (the MVP exit gate currently measures footer-settings clicks); one link +
   copy string fixes it, and the dogfood clock is already running.
2. T0.2 KMS fix (3 lines) · T0.3 requirements.csv provenance (1 row) · T1.5 badge
   wire-or-delete · T2.2 `/v1/logs` auth · T2.3 purge-order test.

**Parallelism map:** P0, P1, P2 can all start now, concurrently (P0 = docs/CI, P1 =
lib/poller/scripts, P2 = lib/routes/tests — disjoint files). Within each phase every task
is independent. T3.1/T3.2/T3.4 can start now; T3.3/T3.5 wait on founder calls. T4.1 is
independent of everything. **Serialize** T4.2 and T3.5b builds (both migration-bearing)
until T5.2 lands.

**Hard blockers (external, cannot be compressed):**
- **W6-A dogfood outcome** → T5.1 (clock started 2026-07-14, ~6 weeks).
- **OQ-003 M365/Workspace research + OQ-004 scope decision** → T5.3 (no implementation
  work permitted ahead of these — NOT-015).
- **Founder product calls** → T3.3 (card consolidation), T3.5a/b, T2.4 ADR decisions,
  T2.5 guard semantics, OQ-001/002/008 sign-offs (§6 ledger).

---

## 5. Task specifications

Effort grades reuse the spec scale (S = lib/UI PR · M = new surface · L = table+ADR+
registrations · XL = multi-surface). Every task ships with its own tests in the same PR
and follows the inner loop: plan → build against fixtures → own tests → `/code-review` +
apply fixes → PR → merge on green CI.

### Phase 0 — Governance & claim-surface hygiene (docs + CI only)

#### T0.1 — ADR ledger repair + duplicate-prefix CI check
- **Objective/scope:** unique, citable ADR numbering, enforced mechanically.
- **Dependencies:** none. **Priority:** P0-high. **Effort:** S.
- **Approach:** rename `docs/decisions/0037-org-scope-unique-violation-cause-chain.md` →
  `0040-org-scope-unique-violation-cause-chain.md` (update its own title line; grep
  confirmed zero external references point at this 0037 — all cite missions). Keep
  `0037-missions.md` (schema-bearing, mig 0032) at 0037. Add an index table (number ·
  slug · one-line title · status) to `docs/decisions/README.md` (today a 9-line how-to).
  New `scripts/check-adr-numbers.mjs` mirroring `check-org-scope.mjs`: readdir
  `docs/decisions/*.md`, extract the 4-digit prefix, fail on duplicates — **allowlist the
  two bannered 0014 files** (kept per their own banners: "cite by slug, never bare
  number"). Wire as a step in the `check` job of `.github/workflows/ci.yml` (always-run,
  cheaper than the PR-only `frozen-contracts` job).
- **Files:** rename in `docs/decisions/`; `docs/decisions/README.md`; new
  `scripts/check-adr-numbers.mjs`; `.github/workflows/ci.yml`.
- **Data/migration:** none. **UX impact:** none.
- **Tests/acceptance:** CI step fails on a synthetic duplicate (verify locally by
  running the script against a temp copy); green on the real ledger.
- **Risks:** trivial. The renumber PR itself touches `docs/decisions/` so it passes the
  frozen guard by construction.

#### T0.2 — KMS claim-surface fix
- **Objective:** remove the last "KMS" overclaims (PRIN-008; the exact W3-N pattern).
- **Dependencies:** none. **Priority:** P0-high. **Effort:** XS.
- **Approach:** `docs/Revealyst_Execution_Plan.md` lines **60, 66, 181** and
  `docs/approvals.md:58` — replace "KMS"/"KMS wiring"/"KMS envelope" with "versioned
  Worker-secret KEK envelope" (the true mechanism per `src/lib/credentials.ts`).
- **Tests/acceptance:** `grep -ri "KMS" docs/ src/` returns only `credentials.ts`
  comments and the deliberate *warnings against* the word (CLAUDE.md, AGENTS.md, legacy).
- **Risks:** none.

#### T0.3 — OQ-008 provenance correction
- **Objective:** stop claiming a founder sign-off that ADR 0036 itself disclaims.
- **Dependencies:** none. **Priority:** P0-high. **Effort:** XS.
- **Approach:** edit `docs/product/requirements.csv:160` — replace "founder sign-off
  received per W7" with "decided autonomously per directive (ADR 0036), awaiting founder
  confirmation". Spec V4 §16.8 and CLAUDE.md are already accurate (verified). Record the
  pending confirmation in the T0.5 ledger.
- **Risks:** none. If the founder *does* confirm (§6), update both the CSV and the ledger.

#### T0.4 — Spec V4 refresh PR
- **Objective:** the spec's status claims match code at the refresh commit.
- **Dependencies:** none (pairs naturally with T0.3/T0.5). **Priority:** P0. **Effort:** S.
- **Approach:** in `docs/Revealyst_Product_Spec_V4.md`, correct the six verified deltas:
  (a) line 214 — 26 keys/10 families → **29 keys / 11 families** (`agentic`, `markers`);
  (b) line 773 — latest migration 0023 → **0034**;
  (c) line 795 — "routes typed in `api.ts`" → bless (or reject) the evolved **two-tier
  convention** (~6 non-frozen routes with colocated Zod, all still behind
  `handleApi`/forOrg/402) — this is a *decision to record*, not just a wording fix;
  (d) same section — `allowOverFreeBand` "upgrade/portal only" → the actual six routes
  (billing/checkout, billing/portal, connections/[id], settings, settings/digest,
  settings/exec-report), with the rationale (privacy/account routes are never paywalled);
  (e) lines 184-185 — shared-assembly citation `digest-content.ts` → **`deriveAttention`
  (`src/lib/score-insights.ts`)**;
  (f) lines 436 + 856 — "~30–40 capability seed" → **9 shipped deliberately** (ADR 0035
  rejected the larger seed as fabrication risk; lines 277/280 already say so);
  (g) line 237 — "Claude Code OTel receiver (unbuilt…)" → **shipped** (`/v1/metrics` +
  `/v1/logs`, mig 0034, ADR 0039, measured tier live).
  Optionally add the two one-line spec-silence resolutions if the founder signs them
  (§6): mobile-supported statement + WCAG 2.1 AA target.
- **Tests/acceptance:** adversarial content fact-check by a reviewer that did not write
  the edits (W3-N rule), grounded in `src/contracts/metrics.ts`, `drizzle/`, and the
  `allowOverFreeBand` grep.
- **Risks:** low; the spec is a claim surface — the fact-check is mandatory, not optional.

#### T0.5 — Product sign-off ledger + legacy banner
- **Objective:** a durable home for founder product decisions (none exists today).
- **Dependencies:** none. **Priority:** P0. **Effort:** S. **Human gate:** founder
  reviews/ratifies entries (rule 4).
- **Approach:** create `docs/product-signoffs.md` (date · item · decision · evidence
  link · status), seeded with: OQ-001 exit-gate N/threshold (default 6 weeks —
  **pending**), OQ-002 Custom Index demotion (**pending** ratification; code already
  matches the default), OQ-008 third-ladder (**pending** — see T0.3), plus rows for the
  §6 decision queue below as they resolve. Add a supersession banner to
  `docs/ai-capability-implementation-gap-analysis.md` (or move it to `docs/legacy/` — the
  established home; banner preferred since the AI Capability plan and Spec V4 link it by
  path).
- **Tests/acceptance:** ledger exists; roadmap P0 acceptance ("sign-off ledger entries
  exist or explicitly deferred") satisfied.
- **Risks:** none.

#### T0.6 — Landing $1-promo derived from a dated constant
- **Objective:** the founder-pricing footnote can't silently drift from the enforced
  Paddle price (the `FREE_TRACKED_USER_LIMIT` pattern, applied to the promo).
- **Dependencies:** none. **Priority:** P0-low. **Effort:** S.
- **Approach:** the copy at `src/app/page.tsx:226` ("Founder pricing: 50% off — $1 per
  tracked user — through Aug 31, 2026.") is **currently accurate** against the recorded
  Paddle config (`docs/approvals.md`: discount `FOUNDER` 50%, expires 2026-08-31, price
  $2.00/user/mo) but hardcoded. Add a small `src/lib/pricing.ts` exporting
  `LIST_PRICE_CENTS = 200`, `FOUNDER_DISCOUNT_PCT = 50`, `FOUNDER_PROMO_EXPIRES =
  "2026-08-31"` with a comment pinning the Paddle price/discount IDs from approvals.md;
  compose the footnote from them. A unit test derives the rendered string and asserts
  the promo math ($2 × 50% = $1).
- **UX impact:** none (identical copy).
- **Risks:** the constant is still a manual mirror of Paddle dashboard state (no API
  check at build time) — the comment must say so honestly. Founder must update it when
  the promo changes; the dated name makes staleness visible.

### Phase 1 — Measurement-plane closure (protects the §14 MVP bet)

#### T1.1 — Digest companion-return CTA ⚡ *top priority in the entire plan*
- **Objective:** make `digest_return` measure companion returns, not footer-settings
  clicks, before the dogfood clock matures.
- **Dependencies:** none. **Priority:** highest. **Effort:** S.
- **Approach:** `appendDigestUtm(href, isoWeek)` (`src/lib/digest-email.ts:43-47`, tags
  `?src=digest&wk=<isoWeek>`) is called exactly once today — the footer settings link
  (`:245`). Add a prominent body CTA button near the top of `renderDigestEmail` linking
  to `` `${appOrigin}/dashboard` `` wrapped in `appendDigestUtm`. Because
  `digestReturnDim()` is pathname-agnostic and `isCompanionRevisit()` matches GET
  `/dashboard`, this one click fires **both** `digest_return` and `companion_revisit`
  (§1 correction 14). Copy via a new `DIGEST_COPY` entry (plain English, e.g. "Open your
  companion"); email-safe inline table styles matching the existing `sectionHeading`
  idiom.
- **Files:** `src/lib/digest-email.ts`, digest copy module, `tests/digest-content.test.ts`
  / `tests/digest-return.test.ts`.
- **Data/migration:** none. **UX impact:** one new button in the weekly email.
- **Tests/acceptance:** rendered HTML contains a `/dashboard` href carrying
  `src=digest&wk=`; existing footer-link test unchanged.
- **Risks:** none structural. Ship first; every week without it weakens the exit-gate data.

#### T1.2 — `deriveSyncCadence()` derivation
- **Objective:** MET-003 — the inter-sync-interval distribution as a tested pure function.
- **Dependencies:** none. **Priority:** P1. **Effort:** S.
- **Approach:** pure fn in `src/lib/launch-funnel.ts` (house pattern: pure derivation +
  script-side query):
  `deriveSyncCadence(runs: readonly {orgId; finishedAt: Date|null}[]) →
  {orgId; samples; medianMinutes|null; p90Minutes|null}[]`. Honest-null: `samples < 2` →
  null median (never a fabricated 0). `scripts/launch-metrics.ts` adds one query over
  `connector_runs` (`kind='agent_ingest'`, `status='success'`, ordered by org/finishedAt).
  **Retention constraint (§1 correction 10):** `agent_ingest` rows age out at 90 days
  (`CONNECTOR_RUNS_RETENTION_DAYS`, `src/db/system.ts`) — the derivation observes at
  most a 90-day window; say so in its doc comment and script output.
- **Tests/acceptance:** unit tests in `tests/launch-funnel.test.ts` — 0/1/N samples,
  unsorted input, null-median honesty. Clock-injection style (`now` param) per house
  convention.
- **Risks:** none; script is founder-run, cross-org by design (not `forOrg` — documented
  in the script header like its siblings).

#### T1.3 — Rec-engagement ratio (founder-only aggregate)
- **Objective:** MET-005 — shown/tried/dismissed counts per (org, rec, period).
- **Dependencies:** none (exposure log shipped, mig 0033). **Priority:** P1. **Effort:** M.
- **Approach:** one batched cross-org aggregate in `src/db/system.ts` (the documented
  home for bounded cross-org reads): `recEngagementRollup(db)` — `recommendation_exposure`
  LEFT JOIN `rec_interaction_state` on `(orgId, personId, recId)`, grouped by
  `(orgId, recId, period)`, aggregated to **counts only** (`shown/tried/dismissed/
  snoozed`); the output shape carries no personId/name. New founder-run
  `scripts/rec-engagement-metrics.ts` mirroring `launch-metrics.ts`. Note the seam
  already anticipated this: `src/db/org-scope/exposures.ts` `list()` is marked
  "SERVER-SIDE ONLY … future founder analysis" — but the rollup is cross-org, so
  `system.ts` is the right home (one query, not N per-org round trips).
- **Data/migration:** none. **UX impact:** none (no UI — deliberately).
- **Tests/acceptance:** PGlite test seeding 2 orgs' exposure+interaction rows; asserts
  counts and that the output type/rows contain no person identifier (ADR 0038 stance:
  self-view-only means **no manager/admin route** — this must never be wired to `/admin`).
- **Risks:** the privacy constraint is the whole risk; enforce by shape (no person field
  in the return type) + the test.

#### T1.4 — Named opt-in-rate figure
- **Objective:** PRIV-007 — an honest agent/companion opt-in rate.
- **Dependencies:** none. **Priority:** P1. **Effort:** S.
- **Approach:** `companion_revisit` is Analytics-Engine-only (§1 correction 11), so the
  Postgres numerator is `connections` rows with `vendor='claude_code_local'` +
  `authKind='device_token'` (per-org boolean or per-person count), denominator =
  activated orgs (score-row existence — the stable activation boolean per the W3-P
  timestamp rule). Add to `deriveLaunchFunnel`/`scripts/launch-metrics.ts` output.
  Team-org variant deferred to W10 (MET-004 instruments it properly).
- **Tests/acceptance:** unit test on the pure derivation; labeled honestly in script
  output ("agent connection opt-in", not "companion usage").
- **Risks:** none.

#### T1.5 — Coverage visible on the self-view (badge wire-or-delete → resolved: re-home)
- **Objective:** TEL-016 — a 1-source person can see their coverage without a rec.
- **Dependencies:** none. **Priority:** P1. **Effort:** S.
- **Approach:** delete `src/components/signal-coverage-badge.tsx` + its test (genuinely
  orphaned — zero JSX call sites). Surface the count on the always-relevant **Data
  Confidence card** instead: `buildDataConfidence` (`src/lib/data-confidence.ts`) gains
  an optional `sourceCount?: number`; push a plain-English "N connected sources" line
  into `summaryLines` (the block at `src/components/companion/data-confidence.tsx:170`
  renders whenever the list is non-empty — pushing the line guarantees it shows). Wire
  from `dashboard/page.tsx:704` using the `connectedTools.size` already computed at
  `:631` — **zero new queries** (perf law holds).
- **UX impact:** one new line on an existing card; no new card (companion stays minimal).
- **Tests/acceptance:** `data-confidence` test asserts the line renders with the count;
  registered as a data-confidence definition per the shipped framework's convention.
- **Risks:** none; `computeSignalCoverage`/`coverageForPerson` stay untouched (still used
  by team view + capability reducer).

#### T1.6 — SYNC-003 same-click reward composition
- **Objective:** one reward moment per manual sync (counts + positive nudge together).
- **Dependencies:** none. **Priority:** P1-low. **Effort:** S–M.
- **Approach:** the CLI already composes this correctly in one place —
  `packages/revealyst-agent/src/reward.ts` `composeSyncReward()` returns
  `{headline, positive}` with honesty gating (`positive: null` on thin data). Mirror it
  server-side: new pure `src/lib/sync-reward.ts` deriving the positive line from the
  already-fetched `connector_runs` facts; render it inside `SyncTransparencyPanel`
  (`src/components/sync-transparency-panel.tsx:68-84`) directly under the existing
  counts line on `/connections`. The dashboard `DailyNudgeCard` stops being "the reward"
  (it remains a nudge; no removal needed in this task — T3.3 owns card folding).
- **Tests/acceptance:** unit tests on `sync-reward.ts` incl. the honesty-null case;
  panel component test asserts counts + positive render together.
- **Risks:** low; keep the two copy sources single-sourced (one module) so CLI and web
  don't drift.

#### T1.7 — Committed exit-gate query (digest-return rate)
- **Objective:** OQ-001's metric is a committed, reviewable computation — not a
  dashboard glance.
- **Dependencies:** OQ-001 founder sign-off for the *threshold*; the script lands now
  with the window as a flag. **Priority:** P1. **Effort:** M.
- **Approach:** `digest_return`/`companion_revisit` land in Workers Analytics Engine
  (`src/lib/launch-events.ts`, written at the `src/worker.ts` seam). New founder-run
  `scripts/digest-return-rate.ts`: POST to the Cloudflare Analytics Engine SQL API
  (`/accounts/{account}/analytics_engine/sql`, `CLOUDFLARE_API_TOKEN`), filter
  `blob1 IN ('digest_return','companion_revisit')` grouped by the `wk` dim, compute the
  trailing-N-week return ratio. `--weeks` CLI flag, default 6 (the documented default) —
  **never a baked-in unsigned threshold**. Split pure ratio math into a unit-tested
  helper (mirroring `launch-funnel.ts`'s pure/shell split).
- **Tests/acceptance:** unit test on the pure ratio helper; script documented in the
  T0.5 ledger row for OQ-001.
- **Risks:** Analytics Engine SQL API auth/plumbing is new to the repo — keep the script
  standalone (no CI), same trust tier as `launch-metrics.ts`.

### Phase 2 — Defense-in-depth hardening

#### T2.1 — Runtime privacy predicate (precedes all W10 work)
- **Objective:** `assertTeamOnlyPseudonymized` enforced at runtime, not just in tests.
- **Dependencies:** none. **Priority:** P2-high (hard precondition of T5.1). **Effort:** S.
- **Approach:** the predicate (`src/lib/visibility.ts:168`,
  `assertTeamOnlyPseudonymized(view: TeamVisibleView): void`, throwing) is referenced
  today only by comments — `readDashboardView` (`src/lib/dashboard-view.ts:206-236`)
  never calls it. Invoke it on the composed view at the end of `readDashboardView`.
  `TeamVisibleView` is structural, so the real `DashboardView` satisfies it **iff** the
  three field names still line up — confirm `DashboardScore.person`,
  `SegmentDistribution.segments[].members`, `SharedAccountFlag.externalId` before wiring
  (verified: `src/lib/segments.ts:45`, `src/lib/shared-account/index.ts:28`). Register the
  team-visible attention-item shape in `IDENTITY_BEARING_MANIFEST` +
  `TEAM_VISIBLE_IDENTITY_SURFACES` (it carries no identity today; registering makes a
  future change throw instead of leak).
- **Data/migration:** none. **UX impact:** none (private-mode views are zero-throw by
  construction — `toPersonRef` already nulls names).
- **Tests/acceptance:** (1) synthetic leak — a hand-built `DashboardView` slice with a
  `displayName` (mint via `toPersonRef(person, "full")`, the idiom
  `visibility.test.ts:62-63` already uses) → `toThrow(/score exposes a real name/)`;
  (2) zero-throw — `readDashboardView` against a PGlite fixture org in private mode does
  not throw; (3) manifest completeness tripwire still `{missing:[],extra:[]}` plus the
  new attention-item surface.
- **Risks:** a throwing runtime predicate converts a silent leak into a hard 500 — that
  is the *intent* (fail closed), but verify zero-throw on current production shapes via
  the PGlite test before merging (roadmap's stated condition).

#### T2.2 — `/v1/logs` auth + explicit `/v1/` routing + timing
- **Objective:** V1-001 — the logs endpoint actually reuses the device-token scheme.
- **Dependencies:** none. **Priority:** P2-high. **Effort:** S.
- **Approach:** `src/app/v1/logs/route.ts` reads no Authorization header at all (its own
  comment claims otherwise — fix the comment too). Factor the auth steps of
  `ingestOtelMetrics` (`src/lib/otel-receiver.ts:43-67`: `parseAgentToken` →
  `connections.get` → `authKind==='device_token'` → `withCredential` timing-safe compare)
  into `authenticateDeviceToken(db, env, bearer)` and call it from the logs route —
  401/403 before the body is accepted. Also: add `pathname.startsWith("/v1/")` to
  `isNeutralPath()` in `src/lib/domains.ts` (~line 70) with a never-redirect comment
  (exporters don't follow 308s; cross-host redirects strip Authorization), and widen the
  `instrument` gate in `src/worker.ts:148-151` with `|| url.pathname.startsWith("/v1/")`
  so `/v1/*` gets request timing.
- **Tests/acceptance:** mirror `tests/otel-receiver.test.ts:63-66` for logs — empty
  token → 401, garbage → 401, valid device token → 200; a `domains.ts` unit test pins
  `/v1/metrics` classifying neutral *explicitly*.
- **Risks:** low. OpenNext dual-bundling hazard noted: if any ALS-scoped helper is later
  added inside otel ingestion, anchor on `globalThis` (documented incident).

#### T2.3 — Purge-ORDER test
- **Objective:** the purge sequence is dependency-asserted, not hand-maintained.
- **Dependencies:** none. **Priority:** P2. **Effort:** S.
- **Approach:** current ordering was hand-verified correct (all 22 child tables precede
  their parents). New test (extend `tests/account-deletion.test.ts`'s tripwire block):
  for each table in `PURGE_TABLES`, `getTableConfig(table).foreignKeys` → resolve target
  table names; for every FK whose target is also in `PURGE_TABLES`, assert
  `position(child) < position(parent)`. Assert for **all** FKs regardless of
  `onDelete: "cascade"` (relying on cascade implicitly is fragile — a dropped cascade
  would otherwise regress silently).
- **Tests/acceptance:** green on current order; a deliberate local reorder fails with
  the offending pair named.
- **Risks:** none — pure schema introspection, no fixtures.

#### T2.4 — Audit rows: billing lifecycle + account purge (ADR-gated)
- **Objective:** plan changes, seat metering, and purges leave accountability records.
- **Dependencies:** **ADR first** (next free number at planning time: 0041). **Priority:**
  P2. **Effort:** M (ADR is the cost driver). **Human gate:** founder decides the ADR.
- **Approach (three call sites, no migration):**
  1. `billing.subscription_status` — in `applySubscriptionEvent`
     (`src/lib/paddle-webhook.ts:204`) after `applyPaddleSubscriptionEvent` succeeds:
     `forOrg(db, orgId).auditLog.record({actorUserId: null, action:
     "billing.subscription_status", targetKind: "subscription", targetId, metadata:
     {status, priceId}})`.
  2. `billing.seat_quantity_set` — in `src/metering/meter.ts` after the CAS +
     Paddle PATCH succeed (record-then-charge framing preserved).
  3. `account.purge` — in `assertDeletableAndPurgeOrg` (`src/db/account-deletion.ts`)
     **before** the purge transaction, targeting **`SYSTEM_ORG_ID`** via
     `ensureSystemOrg` + `forOrg(db, SYSTEM_ORG_ID).auditLog.record(...)` — the exact
     ADR-0016 admin-audit mechanism. Critical: a record in the dying org's own log would
     be destroyed by the cascade it records (`audit_log` is PURGE_EXEMPT, cascade-deleted
     with the org).
- **The ADR must decide** (do not decide unilaterally): (a) widening `audit_log`'s
  documented "user-initiated only" scope to named machine events (`actorUserId: null`) —
  a semantic change to a frozen-adjacent contract; (b) whether a **long-lived**
  survives-erasure "an org was deleted" record is acceptable under the privacy stance —
  note `audit_log` rows (including the SYSTEM org's) already age out at 365 days via
  `purgeExpiredRetention` (`AUDIT_LOG_RETENTION_DAYS`, `src/db/system.ts`), so the real
  question is whether the SYSTEM-org purge record should be **exempted** from that
  retention or accept the 365-day ceiling; and what `metadata` may contain (ids and
  short labels only, never PII — house rule).
- **Tests/acceptance:** PGlite tests per call site (webhook event → audit row; metering
  CAS → audit row; purge → SYSTEM-org row exists *after* the org is gone); metadata
  shape asserted PII-free.
- **Risks:** the privacy-vs-accountability tension is real — hence the ADR gate.

#### T2.5 — Frozen-contracts guard: decide, don't blindly strengthen
- **Objective:** close the "any docs/decisions touch satisfies the guard" gap without
  breaking legitimate workflows.
- **Dependencies:** founder call. **Priority:** P2-low. **Effort:** S (option A) / M (option B).
- **Approach:** the naive fix (require a git-**added** `docs/decisions/` file via
  `--diff-filter=A`) would fail any PR that edits ADR prose while touching a frozen path
  — including renumbering PRs like T0.1 (§1 correction 13). Present two options:
  **(A)** record the decision to keep the current guard with human review as the
  backstop (a one-line note in the guard's comment + the T0.5 ledger); **(B)** the
  higher-value strengthening — new `scripts/check-new-org-table-registrations.mjs`
  that detects new `pgTable(` with an `orgId` column in the diff and asserts the three
  registrations (SCOPED_READS entry, PURGE registration, ADR in-diff) — mechanically
  enforcing the three-registration law the current guard can't see. Recommend **B** as
  a follow-up and **A** now.
- **Tests/acceptance:** (B) script fails on a synthetic unregistered table; green on HEAD.
- **Risks:** (B)'s diff parser must not false-positive on the T5.2 schema split (moved
  `pgTable` calls are not new tables — match on table *names* against the base ref, not
  raw diff hunks).

#### T2.6 — Accessibility & responsive hardening package
- **Objective:** WCAG 2.1 AA as a stated principle + the structural basics, guarded.
- **Dependencies:** none (WCAG statement lands via T0.4). **Priority:** P2. **Effort:** M
  total (each item XS–S).
- **Approach (all verified single-choke-point fixes):**
  1. **Skip link:** first focusable child inside `src/app/(app)/layout.tsx` (before
     `<SidebarProvider>`) targeting `id="main-content"` on the real `<main>` that
     `SidebarInset` already renders (`src/components/ui/sidebar.tsx:305-316`) — pass the
     id via the existing props spread at the call site. App shell only (marketing/sign-in
     are single-column; no tab-order problem to solve).
  2. **Nav landmark:** one `<nav aria-label="Primary">` wrapping the three menu groups in
     `src/components/app-sidebar.tsx` + `aria-current={isActive ? "page" : undefined}` at
     the three `SidebarMenuButton` call sites (`:118-125, :138-145, :159-166` — props
     spread already reaches the rendered element; no primitive change).
  3. **Reduced motion:** the standard `@media (prefers-reduced-motion: reduce)` reset in
     `src/app/globals.css` `@layer base` (animations/transitions → 0.01ms).
  4. **Dialog overflow:** add `max-h-[calc(100vh-2rem)] overflow-y-auto` to
     `DialogContent` (`src/components/ui/dialog.tsx:56`) — fixes every dialog at the
     primitive. (Known consequence: long bodies scroll the footer; sticky-footer is a
     separate, unscoped change.)
  5. **Shell padding:** `p-6` → `p-4 md:p-6` at `src/app/(app)/layout.tsx:97` (the one
     shared wrapper; no other page hardcodes shell padding).
  6. **Contrast token:** light-mode `--muted-foreground` is `oklch(0.556 0 0)` ≈ 4.73:1
     on white — passes AA with no margin. Darken to ~`oklch(0.50 0 0)` (≈5.3:1). This
     touches nearly every screen visually → needs a founder visual pass before landing
     (§6), and any `text-muted-foreground/70`-style opacity composition should be
     grepped and reviewed in the same PR.
  7. **Axe harness:** add **`vitest-axe`** (not jest-axe — the suite is Vitest-native;
     matcher via `expect.extend` in `vitest.setup.ts`); smoke assertions in
     `src/components/onboarding-wizard.test.tsx` and
     `src/components/companion/companion-cards.test.tsx` (highest-value interactive
     markup). Honest caveat: jsdom axe catches structural issues only — computed
     contrast needs a real browser and is out of scope (no Playwright infra exists;
     standing one up is a separate L proposal, deliberately not in this wave).
  8. **Table-wrapper regression pin:** `overflow-x-auto` is already implemented at the
     shared `Table` primitive (`src/components/ui/table.tsx:9-12`) — add a one-line
     class assertion test so it can't silently regress.
- **Tests/acceptance:** axe smoke green; nav test asserts `getByRole("navigation",
  {name: "Primary"})` + `aria-current`; dialog/table class pins; reduced-motion is a
  documented manual QA step (not automatable in jsdom).
- **Risks:** item 6 only (visual breadth) — gated on the founder pass; everything else
  is additive attributes/CSS.

### Phase 3 — Ranker & companion completion

#### T3.1 — Fatigue/novelty activation (feed the shipped exposure log into the ranker)
- **Objective:** COACH-004 — a tried rec rotates; a recently-shown rec scores lower on
  novelty. Both terms exist and are inert.
- **Dependencies:** none (P7 shipped). **Priority:** P3-high. **Effort:** M.
- **Approach (verified reality):** `deriveAttention` already accepts
  `fatigueRecIds?: ReadonlySet<string>` (`src/lib/score-insights.ts:736`, consumed at
  `:933`) — no caller passes it. `novelty` is hardcoded `1` at `:932` (no input exists).
  Wire three points:
  1. **Dashboard** (`src/app/(app)/dashboard/page.tsx:603`): the interaction states are
     already fetched in the flat `Promise.all` (`:401`) — hoist the
     `deriveRecInteractionView` call (currently *after* `deriveAttention`, `:647-650`)
     above it and pass `fatigueRecIds: triedRecIds`. For novelty, add
     `ctx.scope.exposures.forUser(ctx.user.id)` to the same `Promise.all` (+1 query,
     depth still 1 — perf law), derive `recentlyShownRecIds` (lookback window, e.g. 7
     days, as a named exported constant), pass via a new optional
     `recentlyShownRecIds?: ReadonlySet<string>` param replacing the hardcoded novelty
     (`input.recentlyShownRecIds?.has(id) ? 0 : 1`).
  2. **Digest** (`src/lib/digest-content.ts:186` `assembleDigest`, called from
     `src/poller/digest.ts:219`): thread both sets through `assembleDigest`'s options
     (mirroring the W7-3 `connectedTools`/`masteredCapabilities` threading); add the
     exposure read to the poller's existing `Promise.all` (`digest.ts:147-180`),
     personal lane only.
  3. **Team call site** (`page.tsx:1080`): unchanged — org-aggregate recs have no
     single person; fatigue/novelty do not apply (precedent in the digest comments).
- **Data/migration:** none. **UX impact:** rec rotation only (no new UI).
- **Tests/acceptance (guards first — extend, never bypass):**
  - `tests/utility-ranker.test.ts`: no-history pin — `fatigueRecIds: undefined` vs
    `new Set()` (and `recentlyShownRecIds` likewise) produce `toEqual` outputs (idiom of
    the existing eligibility backward-compat pin at `:176-186`); a novelty ordering test
    (none exists today — only fatigue is tested at `:189-208`).
  - `tests/digest-content.test.ts` shared-source block: new sibling test passing the
    same sets to both `deriveAttention` and `assembleDigest`, asserting the digest
    remains a prefix of the dashboard order — parity holds *with* history, not just
    without.
- **Risks:** medium-low. The no-history equivalence pins are the safety net: a person
  with zero exposure/interaction rows must see byte-identical recs before/after.

#### T3.2 — `suggestedActionType` affordances
- **Objective:** COACH-008 — the stored action taxonomy drives the button, not a
  generic "Take a look".
- **Dependencies:** none. **Priority:** P3. **Effort:** S (+ deferred M).
- **Approach:** the enum (`link-out | in-product-setting | vendor-deep-link`,
  `schema.ts:1380-1382`) is parsed onto `CatalogRecommendation` and never read again.
  Thread it onto `AttentionItem` in the recommendation-push block
  (`score-insights.ts:~975`); branch `CoachingCard`
  (`src/components/companion/coaching-card.tsx:90-100`): `in-product-setting` → the
  current in-app link; `link-out` → external-link affordance ("Learn more", new tab).
  **Defer `vendor-deep-link`** — no per-rec target URL exists anywhere; adding one is a
  frozen-catalog column (ADR) and goes to the deferred ledger (§8). Copy via
  `COACHING_COPY` (plain English).
- **Tests/acceptance:** component test per branch; migration-equivalence guard untouched
  (display-only threading — same pattern as the P1 capability label, pinned byte-identical
  except the new field).
- **Risks:** none for the two shipped branches.

#### T3.3 — Companion card consolidation *(founder call — do not build ahead of it)*
- **Objective:** resolve the ~11-stacked-cards vs "one card, not a dashboard" (§11.2)
  tension.
- **Dependencies:** **founder decision** (§6). **Priority:** P3. **Effort:** M (option 1)
  / L (option 2).
- **Approach — two options prepared, verified against the actual render order**
  (PageHeader → banners → AttentionSection → DataConfidence → GrowthJourney → Milestone →
  DailyNudge → Coaching → CapabilityProfile → Mission → DiagnosticDetails(collapsed) →
  AgenticAdoption → SpendGovernance → Benchmarks):
  - **Option 1 (recommended — fold, minimal restructure):** merge `MilestoneCard` +
    `DailyNudgeCard` into `GrowthJourneyCard` as optional sub-sections (same voice,
    adjacent already; pure builders `detectMilestones`/`buildDailyNudge` untouched);
    progressive-disclose `CapabilityProfileCard` + `MissionCard` behind a collapsed
    expander below `CoachingCard`, reusing the `DiagnosticDetails` collapsed-by-default
    pattern. Net: 11 → ~6 visible cards, zero data-path change.
  - **Option 2 (deeper):** one tabbed "Companion" card (Journey / Coaching /
    Capabilities). More minimal, more restructure, higher regression surface.
- **UX impact:** the point of the task — lower cognitive load, preserves progressive
  disclosure.
- **Tests/acceptance:** existing companion component tests updated; the §11.2 spirit
  check is the founder's review.
- **Risks:** product-scope; each card was a deliberate W5/W7 addition — hence the gate.

#### T3.4 — Dashboard module extraction (de-risks W10)
- **Objective:** `dashboard/page.tsx` (1,408 lines, both audience surfaces) becomes
  tractable for the T5.1 widening.
- **Dependencies:** none. **Priority:** P3-high (precondition-of-convenience for T5.1).
  **Effort:** M.
- **Approach:** pure move. `PersonalSelfView` (lines 277–943) →
  `src/app/(app)/dashboard/personal-self-view.tsx`; `TeamOverview` (944–1408) →
  `team-overview.tsx`; shared helpers used by both (`dashboardWindow`,
  `attentionActionLabel`, `AttentionAlert`, `AttentionSection`, `SpendGovernanceLine`,
  lines 130–252) → `shared.tsx`. **Copy the `Promise.all` batches verbatim** — the file's
  own comments (256-265, 296-300, 372-403) document non-obvious perf reasons for exact
  placement (unawaited connections promise, `timeStage` boundaries); read them before
  moving. Not a frozen path — no ADR.
- **Tests/acceptance:** honest bar (no RSC render-diff harness exists in this repo, and
  inventing `renderToStaticMarkup` infra is not warranted): `tests/perf/
  authenticated-page-queries.test.ts` unchanged-green (the query-count/depth sentinel),
  full `npm test` green, and a manual preview diff of both dashboard variants against
  the demo seed. Do not weaken any `timeStage` boundary.
- **Risks:** silently changing batch membership during the move — mitigated by verbatim
  copy + the perf sentinel.

#### T3.5 — Optional product calls (build only after §6 decisions)
- **a) Count-bearing cold-start invite copy** ("invite N more"): does not exist today —
  a build, not a fix. Needs the founder to want it (the current honest floor-gated copy
  scored Implemented). Effort S once decided.
- **b) Budget/renewal email opt-out + List-Unsubscribe:** re-graded **M** (§1 correction
  8): a new org-scoped preference table (ADR + three registrations + migration —
  serialize with T4.2 per the standing constraint), `List-Unsubscribe` headers on both
  lanes (digest's RFC-8058 helper `digestListUnsubscribeHeaders`,
  `src/lib/digest-email.ts:264-271`, is the template; budget/renewal senders currently
  pass no headers at all), and per-lane unsubscribe routes mirroring
  `src/app/api/digest/unsubscribe/route.ts`. The founder policy question first: are
  these governance/transactional mails (defensibly no opt-out) or preference-managed?

### Phase 4 — V1 remainder

#### T4.1 — GJ-007 learning paths (the one greenfield build)
- **Objective:** a band-keyed, ordered curriculum a person can follow — static content,
  explicitly not an LMS (NOT-019).
- **Dependencies:** none. **Priority:** P4. **Effort:** M.
- **Approach (corrected per §1.1–1.2):** new pure module
  `src/lib/capability-curriculum.ts` mirroring `src/lib/capability-glossary.ts` (the
  W7-2 exemplar — capability-slug-keyed, banned-phrasing-swept):
  `Record<capabilitySlug, {summary; howTo; tryThis: string[]}>` over the 9 seeded
  capability slugs, sequenced by the seed's existing `sort` (10–90). Render as a
  detail sheet/drawer opened from `CapabilityProfileCard`'s next-focus line
  (`src/components/companion/capability-profile-card.tsx:92-98`, currently plain text)
  — mirror the `DataConfidenceDrawer` Sheet pattern. Content lives in code; the inert
  DB columns stay inert (no migration, no reference-content-in-mastery-data). `/playbook`
  untouched (unrelated surface — optional cross-link only).
- **Data/migration:** none. **UX impact:** one new drawer, opt-in click — no new card
  (companion minimalism preserved).
- **Tests/acceptance:** completeness test — every active capability slug has a
  curriculum entry (the glossary-module idiom); banned-phrasing sweep extended with LMS
  vocabulary ("course", "certification", "lesson N of M"); existing anti-gamification
  tests stay green.
- **Risks:** content authoring quality is the real work; keep it plain-English and
  founder-reviewable in one module.

#### T4.2 — TEL-012 context-usage signal (OTel-gated; or formally Future)
- **Objective:** the last V1 telemetry key exists honestly — or is honestly deferred.
- **Dependencies:** decision first (§6): schedule now vs move to Future in the T0.4
  spec refresh. If scheduled: **serialize with T3.5b** (both migration-bearing).
  **Priority:** P4-low. **Effort:** M.
- **Approach (if scheduled):** contract ADR (number per `ls` at build time) adding the
  canonical key to `CANONICAL_METRICS` (`src/contracts/metrics.ts` — frozen) + an
  idempotent `metric_catalog` seed insert (mig **0035**, the ADR-0022 pattern; data-only,
  no DDL — `family`/`unit` are TS-side enums). Bind an OTel context marker in
  `capability_signals`; optionally harvest the Anthropic `context_window` group_by as the
  second corroborating source. Renders **directional-never-single-source**: the ≥2-signal
  rule pinned by test exactly as the P8 markers are.
- **Tests/acceptance:** contracts mirror test (catalog ⟷ `CANONICAL_METRICS`) green;
  decoder fixture test if a new marker shape is decoded; single-source → no render,
  pinned.
- **Risks:** low; the gate discipline (never render from one source) is already
  test-enforced machinery to reuse.

### Phase 5 — Gated Wave-10 tail + the W9 quiet-window schema split

*(T5.1 and T5.3 are Wave 10, externally gated — do NOT force. T5.2 is a Wave 9 task
that lives here only because the roadmap numbered it P5.2; it needs an ADR and a quiet
window, not an external gate.)*

#### T5.1 — Sub-case-C ADR → Companion-in-Team-orgs
- **Objective:** the spec's #1 structural gap (WF-001/POP-001/POP-007/MET-004), opened
  only by its named gate.
- **Dependencies:** the **W6-A ~6-week dogfood outcome** (clock since 2026-07-14);
  **T2.1 and T3.4 merged first**. **Priority:** W10. **Effort:** M–L.
- **Approach:** the ADR lands all three legs, two of which already exist in code — cite,
  don't rebuild: (a) provable exclusion predicate with test-enforced completeness
  (T2.1's runtime wiring), (b) dual-source dedup (`rowsForSubjects`,
  `src/scoring/preview.ts` — extend coverage to the self-view read path with a test),
  (c) surfaced-not-billed (frozen `tracked_user` contract — cite). Then widen the
  (post-T3.4, now-small) `dashboard/page.tsx` branch: team-org member →
  person-scoped `PersonalSelfView` + digest personal lane; instrument the opt-in event
  (MET-004).
- **Tests/acceptance / completion gate (human, rule 4):** founder judges the evidence
  pack — predicate throws on synthetic leak, dedup test on the self-view path, billing
  provably unchanged, opt-in metric live; tenant-isolation + exclusion tests prove no
  team-rollup/billing reach.
- **Risks:** premature widening is the #2 risk in the gap analysis — the sequencing
  above (predicate first, ADR second, branch third) is the mitigation.

#### T5.2 — `schema.ts` split (frozen-contract ADR; quiet-window W9 task)
- **Objective:** end frozen-monolith merge contention before the next table lands.
- **Dependencies:** a quiet window (no in-flight schema-touching builds). **Priority:**
  high within W9 — land **before** T3.5b/T4.2 if either is scheduled. **Effort:** S–M.
- **Approach (verified):** mirror ADR 0027 — `src/db/schema.ts` (1,749 lines, **40
  `pgTable` calls + 5 enums defined here, plus the 5 auth tables re-exported from
  `src/db/auth-schema.ts`**) becomes a barrel re-exporting `src/db/schema/*.ts`
  per-domain modules: `core` (enums + orgs/people/teams/teamMembers/invites),
  `connections`, `tracking` (subjects/identities/metricCatalog/rawPayloads/
  metricRecords/subjectDaySignals), `scoring`, `poller`, `sharing`, `billing`, `audit`,
  `digest`, `recommendations`, `roles`, `capability-graph`, `missions`. **Two real
  constraints the split must preserve:** (1) the `auth-schema` re-export sits under an
  explicit circular-import ordering constraint (`schema.ts:1747-1749` — auth-schema
  imports `orgs` back, so the re-export must come after `orgs` initializes; keep the
  same ordering in the barrel); (2) simple `.references()` FKs use the lazy thunk form,
  but the composite tenant FKs (`foreignKey({ foreignColumns: [connections.orgId,
  connections.id] })`, e.g. `schema.ts:770-776`) use **direct column references** — the
  module graph must be acyclic for those (the domain grouping above keeps each
  composite FK's parent upstream of its children; verify with `tsc` + a `drizzle-kit`
  smoke run). `drizzle.config.ts` stays pointed at `./src/db/schema.ts` (a barrel is a
  valid single entry). File/directory coexistence (`schema.ts` + `schema/`) is already
  proven by `org-scope.ts` + `org-scope/`.
- **Data/migration:** none — that is the acceptance test.
- **Tests/acceptance:** from a branch **fully current with main's latest snapshot**
  (0034 — the W6 snapshot-drift lesson makes this step non-optional), run
  `npx drizzle-kit generate`: assert no new SQL file and zero new `_journal.json` rows;
  `git status --porcelain drizzle/` empty; full suite green (80 test files import the
  same path — nothing to touch); `check-org-scope.mjs` green (schema imports stay
  inside `src/db/`).
- **Risks:** low with the precedent; the ADR is required (frozen path) and the T2.5(B)
  registration-checker, if built, must not false-positive on moved tables.

#### T5.3 — Role expansion / conversation-structure: remains closed
No implementation work permitted until **OQ-003** (an honest M365/Workspace
role-telemetry research doc) and **OQ-004** (conversation-structure scope decision)
exist (NOT-015, no-prompt-content). Listed here so no wave-planning session re-derives
it.

---

## 6. Founder decision ledger (inputs this plan needs; record outcomes in T0.5's ledger)

| # | Decision | Blocks | Default if unconfirmed |
|---|---|---|---|
| D1 | OQ-001 exit-gate N + threshold | T1.7 threshold only (script lands with `--weeks` flag) | 6 weeks, founder-org dogfood |
| D2 | OQ-002 Custom Index demotion ratification | nothing (code matches default) | demoted, route intact |
| D3 | OQ-008 third-ladder confirmation | nothing (T0.3 corrects the record either way) | capability profile = decomposition (ADR 0036) |
| D4 | Companion card consolidation — option 1 vs 2 vs keep | T3.3 | keep as-is (do not build) |
| D5 | Audit-log scope widening + permanent purge record (T2.4 ADR) | T2.4 | do not write machine-event rows |
| D6 | Frozen-guard semantics (T2.5 A/B) | T2.5 | keep current guard (A) |
| D7 | Budget/renewal opt-out policy | T3.5b | transactional, no opt-out (status quo) |
| D8 | "Invite N more" cold-start copy | T3.5a | current honest copy stands |
| D9 | Mobile-supported statement + WCAG 2.1 AA line in spec | T0.4 additions | spec stays silent |
| D10 | `--muted-foreground` darken visual pass | T2.6 item 6 | token unchanged |
| D11 | TEL-012 now vs formally Future | T4.2 | move to Future in T0.4 |
| D12 | Exec memo in-app page vs email/export-only | nothing this wave | email + export only |

---

## 7. Documentation updates & cleanup ledger

- **This plan's own P0 tasks** are the documentation program (T0.1–T0.6).
- **On each merge:** update CLAUDE.md's wave banner via `/revise-claude-md` at session
  end (house rule); keep migration/ADR "latest" counters current.
- **Cleanup shipped inside tasks:** `SignalCoverageBadge` + test (T1.5);
  `FIRST_SYNC_AHA_COPY` (fold into any P1 companion-adjacent PR — zero imports,
  delete-only); stale `/v1/logs` route comment (T2.2); the stale `src/db/system.ts`
  retention docstring ("`kind = 'poll'` ONLY" — the code purges `agent_ingest` too;
  fix alongside T1.2); `docs/ai-capability-implementation-gap-analysis.md` banner (T0.5).
- **After T5.2:** update ADR 0027's "deferred follow-up" note (it names the schema split
  as pending — close the loop).

---

## 8. Deferred / gated ledger (never calendar-scheduled)

| Item | Gate |
|---|---|
| Companion-in-Team-orgs (T5.1) | W6-A dogfood outcome + founder evidence-pack review |
| Non-eng role expansion | OQ-003 honest M365/Workspace role-telemetry research |
| Conversation-structure signals | OQ-004 scope decision (NOT-015 stands) |
| `vendor-deep-link` rec affordance | needs a per-rec target URL — frozen-catalog column ADR (from T3.2) |
| Outcomes entity + offline eval harness | real exposure/"tried" volume (never hollow — invariant-b) |
| Playwright real-browser viewport/contrast testing | separate L proposal if mobile becomes a stated surface (D9) |
| Dashboard exposure logging (client beacon) + `/v1/logs` event-marker mining | documented P7/P8 follow-ups; volume-driven |
| Neon read replica / region move | founder infra (the biggest measured TTFB lever — unchanged from W4) |
