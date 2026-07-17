# Revealyst — fleet shared brain

The AI Growth Platform: a bottom-up Personal AI Companion whose individual signal
compounds into the team and executive intelligence CTOs pay for. Built by parallel
AI-agent workstreams against frozen contracts. Every session auto-loads this file —
it is the interface between agents.

> Ground truth: [Product Spec V4 — the pivot](docs/Revealyst_Product_Spec_V4.md)
> (strategy source: [Product Direction V4](docs/Revealyst_Product_Direction_V4.md);
> V1.5 reference: [Spec V3](docs/legacy/Revealyst_Product_Spec_V3.md);
> V1 reference: [Spec V2](docs/legacy/Revealyst_Product_Spec_V2.md)) ·
> [V4 Execution Plan](docs/Revealyst_Execution_Plan_V4.md) (the active plan: gap analysis +
> waves W5–W6 + Future ledger) ·
> [Execution Plan](docs/Revealyst_Execution_Plan.md) (V1 waves, complete; still the home of
> rules 1–7 + tripwires; V1.5 waves in Spec V3 §16) ·
> [Desktop Agent Execution Plan](docs/Revealyst_Desktop_Agent_Execution_Plan.md)
> (Tauri 2 tray agent, phases M0–M7; spec + gap analysis in `docs/product/desktop-agent-*`) ·
> [Claude Code Workflow](docs/Revealyst_Claude_Code_Workflow.md) ·
> [Harness setup status](docs/Revealyst_Harness_Setup.md)

> **V4 Wave 5 (MVP) shipped — 2026-07-13** (PRs #187–#196; every Spec V4 §11.2 row):
> the **Personal Companion** surface replaces the score-first self-view (Growth Journey +
> coaching + daily-nudge cards; raw 0–100 demoted behind a "diagnostic details" expander;
> level copy from `maturity-glossary`, never a 4th ladder) with **onboarding inverted**
> (companion pitch before connect). **Rec interaction state** (snooze/dismiss/mark-tried,
> self-view-only, `rec_interaction_state` — mig 0024, ADR 0028). **Team Intelligence** folded
> ~18 panels → 5 cards + board CSV export + segments count-only-everywhere + `MIN_PEOPLE`
> champion floor + band-first share cards. **Telemetry MVP** wired honest dropped fields +
> per-person `signal-coverage` + rec optimization metadata (deliberate drops pinned).
> **Milestones + insight taxonomy** (`AttentionItem.kind` now `recommendation|anomaly|plateau|
> milestone|spend|agentic-transition`; reserved coaching slot; **no-streak decision recorded**:
> weekly-with-forgiveness narrative only). **Manual Sync UX** (same-click reward + "what this
> sync sends" panel derived from the agent allowlist + public `/legal/what-we-collect`).
> **Email lanes** (budget-threshold emails via `budget_alert_state` CAS — mig 0025, ADR 0029;
> digest return-rate + companion-revisit instrumentation → the §14 dogfood clock is now
> measurable; scheduled flywheel funnel). **`org-scope.ts` split** into `src/db/org-scope/*`
> factories (public API unchanged, ADR 0027) + `assertTeamOnlyPseudonymized` generalized to a
> completeness-tripwire surface registry. **OTel receiver spike** decided GO / OTLP-HTTP-JSON
> (`docs/research/2026-07-13-claude-code-otel-receiver-spike.md`; fixture capture founder-gated).
> Latest W5 migration **0025**, ADR **0029**. Prod deployed + §14 dogfood clock running since
> 2026-07-14; OTel telemetry configured founder-side (capture harness: `scripts/otel-capture.mjs`).

> **V4 Wave 6 (V1) — non-gated slice shipped — 2026-07-14** (PRs #199–#202): **Roles** (`roles`
> global reference + `role_assignments`, engineering-only seed, Settings assignment — mig 0026,
> ADR 0030). **Recommendation catalog** (`recommendation_catalog`, seeded VERBATIM from the
> retired 7-entry static map + §8.2 metadata; `deriveAttention` reads it via ONE per-org batched
> read, in-memory per-person eval; migration-equivalence test pins identical output; `score_slug`
> ≠ `slug` — mig 0029, ADR 0033). **Monthly Executive narrative** one-pager (email + `/api/exec-report`
> export; `exec_report_state` org-level opt-in + month CAS; `composeExecReport` wraps `composeNarrative`;
> cron `0 16 1 * *` — mig 0028, ADR 0031). **Renewal reminders** (user-entered `connections.renewal_date`,
> honestly labeled unverifiable; `renewal_reminder_state` CAS; T-30/T-7 emails; cron `0 13 * * *` — mig
> 0027, ADR 0032). Latest migration **0029**, latest ADR **0033**. **Parallel-frozen-contract merge
> lesson (repeat of W4):** these four all appended to `schema.ts`/migrations/`org-scope.ts`/
> `tenant-isolation`; serialize the BUILDS (not just merges) next time — the parallel builds forced
> heavy per-rebase migration renumbering (G→0027, F→0028) + a snapshot-drift bug (a regenerated
> migration re-created a sibling's table until the sibling snapshot was restored before `drizzle-kit
> generate`). **Still GATED (cannot force):** W6-A (Companion-in-Team-orgs + dual-source dedup)
> on the §14 ~6-week dogfood outcome; W6-D (OTel receiver) on founder OTel fixture capture; W6-E
> (measured proficiency) on W6-C + W6-D.

> **V4 Wave 7 (AI Capability Layer) — in progress** (see
> [AI Capability Execution Plan](docs/Revealyst_AI_Capability_Execution_Plan.md), phases P0–P6):
> **P0** dual-source per-person double-count **fixed** (`rowsForSubjects` collapses same-(day,dim)
> rows within one person's exclusive-subject set to MAX, not SUM — PR #210; `segmentTeams` was
> already gone, predicate registry already extensible). **P1** the relational **capability graph**
> shipped (mig 0030, ADR 0035): global reference tables `domains`/`capabilities`/`capability_signals`/
> `capability_dependencies` seeded with the v0 **9-capability** Engineering set (bound only to
> already-ingested signals; shallow acyclic DAG; NOT a graph DB), `recommendation_catalog` gains
> additive `target_capabilities` linking all 7 recs, `forOrg().capabilities` namespace, and a
> display-only capability label on the coaching card (`deriveAttention` output byte-identical except
> the label — pinned by the migration-equivalence guard). **P2** per-person `user_capability_state`
> shipped (mig 0031, ADR 0036): an org-scoped, self-view-only mastery table + a pure engine
> (`src/scoring/capability-state.ts`) + a parallel reducer in the poller `score-recompute` step
> (`recompute-capability-state.ts`, all reads batched once — query count independent of person count,
> proven by `tests/perf/capability-state-queries`), **capped `directional`** (L7), honesty reused
> verbatim (zero evidence → no row), three registrations green, backfill-safe-empty. Rendered as a
> positive-first **capability-profile card** (decomposition of the one band, not a third ladder).
> Latest mig **0031**, latest ADR **0036**. **P3** utility ranker shipped (no migration/ADR): the
> fixed `impact:1` in `deriveAttention` is replaced by a deterministic `computeUtility`
> (`src/lib/recommendation-catalog.ts`, named/exported weights, no ML) that consumes the previously-
> inert benefit/difficulty/confidence + capabilityGap; a permanent output-equivalence guard proves
> uniform metadata reduces to weakest-first; a stage-1 eligibility filter (role/tool/prereq
> fails-closed) is implemented + tested but wired live in P4 (to keep dashboard+digest in sync). The
> ranking itself is live on both paths (internal to `deriveAttention`). **P4** coaching loop (no
> migration): a computed **"why this" line** from the dominant utility term (`dominantUtilityTerm`,
> can't drift from the ranking) + an honest **confidence disclosure** ("Based on N connected sources")
> on each coaching rec; a **digest/dashboard shared-source test** pins identical rec selection+order.
> Deferred (documented, reliability-first): eligibility-gate LIVE activation (tested-dormant — a
> fails-closed prereq gate over directional mastery could over-suppress), and the Growth-Journey
> level→capability-band swap (until measured/OTel). **P6** team rollups (no migration): an aggregate,
> **count-only, `MIN_PEOPLE`-floored** capability-coverage card in the team "(c) Training
> opportunities" section (reuses `mastery.coverageCounts` from P2 + `SEGMENT_MIN_PEOPLE_TO_NAME`); a
> capability below the floor is dropped entirely (never a suppressed-but-implied number), and the row
> prop type carries NO person id/name (per-person leak structurally impossible). One extra batched
> read in `readDashboardView`. Deferred (documented follow-up): the one exec-memo coverage line (needs
> wiring the same `coverageCounts` into the separate `composeExecReport` data path).
> **Three W7 follow-ups then shipped** (no migration/ADR): (1) the exec-memo capability-coverage line
> (`readExecReport` → `composeExecReport`, same MIN_PEOPLE floor as the dashboard); (2) the P3
> eligibility gates **activated live on dashboard + digest together** — role/tool always, the
> fails-closed prereq gate ONLY once the person has established ≥1 capability (forming-user safeguard,
> since directional mastery could over-suppress); a gated shared-source test pins parity; (3) the
> Growth-Journey **band headline** (`overallCapabilityBand`) wired but gated on `measured` — null today
> (all mastery is directional), so the modeled maturity level stays the headline until OTel/P8.
> **P5 missions shipped** (mig 0032, ADR 0037; founder anti-gamification sign-off received):
> `missions`/`mission_steps` (global, seeded 3 starters) + `mission_progress` (org-scoped self-view, 3
> registrations); completion is a MEASURED capability crossing detected in the capability-state reducer
> (`isMissionComplete`, stamped once), never a click — the only write is the opt-in `POST
> /api/missions/start`; **no XP/streak/league/points column or copy** (enforced by a schema-shape test +
> a banned-phrasing test). Opt-in `MissionCard` on the companion. Latest mig **0032**, latest ADR
> **0037**. **Wave 8 gates were then cleared by the founder** (2026-07-14): OTel fixture capture done +
> privacy-reversal ADR approved (+ real founder-captured OTel fixtures landed via #220). **P7 exposure
> log shipped** (mig 0033, ADR 0038): `recommendation_exposure` (org-scoped, **self-view-only** — no
> manager/admin read route; never on the team view; purge-registered; idempotent per day) REVERSES the
> "don't log rec-shown" stance under a founder-signed ADR; deterministic holdout/variant assignment
> (`src/lib/experiments.ts`, empty registry at launch); the digest logs exposures off the hot path; the
> Outcomes entity + offline harness stay gated on real volume (never hollow). Latest mig **0033**,
> latest ADR **0038**. **P8 OTel measured tier shipped** (mig 0034, ADR 0039): additive marker metrics
> (`otel_active_time`/`otel_edit_accepted`/`otel_edit_rejected`, `markers` family) + capability_signals
> bindings; a `POST /v1/metrics`+`/v1/logs` OTLP receiver reusing the agent device-token scheme, with a
> PURE decoder (`src/lib/otel-ingest.ts`) tested against the REAL captured fixtures (`fixtures/otel/
> *.captured.json`, rule 2); the capability engine renders **`measured`** (not just `directional`) when
> a capability has evidence for **≥2** of its bound markers (markers are distinct keys → no
> cross-channel double-count) — which also activates the W7-4 Growth-Journey band headline. **Non-eng
> role expansion stays DEFERRED** — a separate gate needing an honest M365/Workspace role-telemetry
> source (doesn't exist). Latest mig **0034**, latest ADR **0039**. **Wave 7 (P0–P6) + all
> follow-ups + the founder-unblocked P5/P7/P8 are now complete; only non-eng role expansion remains
> gated.**

> **V4 Wave 9 — Closure phases P1–P3 shipped — 2026-07-16** (PRs #227–#231, #233; plan:
> `docs/Revealyst_Closure_Execution_Plan.md`; no migration, no new ADR): **P1 measurement**
> — lane-aware digest body CTA to `/dashboard` (one click now fires BOTH `digest_return` +
> `companion_revisit`; the §14 exit-gate pair finally measures companion returns, not
> footer-settings clicks); `deriveSyncCadence`/`deriveAgentOptInRate` pure derivations in
> `launch-funnel.ts` + wired into `scripts/launch-metrics.ts`; cross-org counts-only
> `recEngagementRollup` in `system.ts` + `scripts/rec-engagement-metrics.ts` (no person id in
> the shape, test-enforced — never wire to a route, ADR 0038); `scripts/digest-return-rate.ts`
> (Analytics Engine SQL API, `--weeks` default 6, NO baked threshold — OQ-001 is unsigned;
> weeks via `toStartOfWeek(timestamp, 1)` since `companion_revisit` carries no wk dim);
> "N connected sources" line on the Data Confidence card (orphaned `SignalCoverageBadge` +
> `FIRST_SYNC_AHA_COPY` deleted); server-side sync reward in `SyncTransparencyPanel`
> (`src/lib/sync-reward.ts` mirrors ONLY the CLI reward's consistency tier — breadth/busiest-day
> data doesn't survive to `connector_runs`; null over guessing). **P2 hardening** —
> `assertTeamOnlyPseudonymized` runs at runtime at the end of `readDashboardView` (gated
> `visibilityMode === "private"`; managed/full deliberately reveal names); `DashboardView.subjects`
> now a `{id, connectionId}` PROJECTION (full rows carry email/name — the old ids-only doc claim
> was false); `/v1/logs` was completely unauthenticated → device-token auth via
> `authenticateDeviceToken`, and `/v1/metrics` reordered auth-BEFORE-body (sibling-drift catch);
> purge-ORDER FK tripwire (≥21-edge anti-vacuity floor) in `tests/account-deletion.test.ts`;
> a11y package (skip link, nav landmark + aria-current, reduced-motion, DialogContent overflow,
> `p-4 md:p-6`, vitest-axe smokes — muted-foreground darken skipped per D10). **P3 ranker/companion**
> — `dashboard/page.tsx` split into `personal-self-view.tsx`/`team-overview.tsx`/`shared.tsx`
> (pure move, Promise.all batches byte-identical, 29-line route entry — T5.1 precondition met
> with T2.1); fatigue/novelty ACTIVATED on dashboard + digest (`recentlyShownRecIds` window is
> DAY-granular, previous 1–7 days EXCLUDING today — a clock-time cutoff made digest self-rotation
> structurally impossible; same-day email↔dashboard parity, day-after drift is the novelty
> feature); `suggestedActionType` branched in `CoachingCard` but TESTED-DORMANT (no per-rec URL
> source exists — needs the deferred frozen-catalog-column ADR, same gap as `vendor-deep-link`).
> **Founder-default resolutions (plan §6, recorded, not built):** T2.4 audit rows (D5), T2.6
> contrast token (D10), T3.3 card consolidation (D4), T3.5a/b opt-out + invite copy (D8/D7);
> T2.5 → option A (guard comment in `ci.yml`; option-B registration checker is the follow-up).
> P0 (governance docs) and P4 (learning paths, TEL-012) were NOT in this slice. Latest mig
> still **0034**, latest ADR still **0039**.

> **V4 Wave 9 — Closure phases P0 + P4 + P5.2 shipped — 2026-07-16** (PRs #235–#239; W9 is
> now COMPLETE except externally gated W10 items; no migration): **P0 governance** — duplicate
> ADR 0037 (cause-chain) renamed → **0040** + `scripts/check-adr-numbers.mjs` duplicate-prefix
> CI guard (bannered 0014 pair allowlisted, self-tested) + full index table in
> `docs/decisions/README.md`; last live "KMS" overclaims → "versioned Worker-secret KEK
> envelope"; requirements.csv OQ-008 no longer claims an unmade founder sign-off (status
> `Open`; TEL-003 26/10→29/11 and WF-006 `deriveAttention` citation fixed in passing);
> **`docs/product-signoffs.md` created** — the durable founder-decision ledger (OQ-001/002/008
> pending + D4–D12 + T2.5 default-applied rows); gap-analysis doc bannered superseded (gated
> items honestly excluded); Spec V4 refreshed to match code (29 keys/11 families, mig 0034,
> two-tier route-typing blessed, six `allowOverFreeBand` routes, `deriveAttention` citation,
> 9-capability seed, OTel receiver shipped) — adversarial fact-check caught + fixed a
> re-fabricated "product-owned, not agent-invented" seed-provenance claim (W3-N pattern,
> again); landing $1-promo derives from `src/lib/pricing.ts` dated constants (manual Paddle
> mirror, honestly commented). **P4** — GJ-007 learning paths: pure `src/lib/
> capability-curriculum.ts` (glossary pattern, all 9 slugs, seed-sort order) + opt-in "See how
> to grow this" Sheet from `CapabilityProfileCard`'s next-focus line (client leaf, card stays
> server; LMS-vocabulary banned-phrasing sweep added; inert learning_path columns stay inert);
> **TEL-012 formally moved to Future (D11 default)** — no metric key, no migration. **P5.2** —
> `schema.ts` split (ADR **0041**): 1,749-line frozen monolith → barrel over 13
> `src/db/schema/*` domain modules; barrel order = topological sort of the 15 composite tenant
> FKs; auth-schema re-export stays last (circular-import constraint); contract-guardian
> verified 45 tables + 5 enums via `getTableConfig` **0 diffs**, export surface 50→50;
> `drizzle-kit generate` zero-diff; full suite 174 files/1,752 tests green. Latest mig still
> **0034**, latest ADR **0041**. **Remaining (Wave 10, externally gated — do not force):**
> T5.1 companion-in-team-orgs (W6-A dogfood outcome, clock since 2026-07-14; T2.1+T3.4
> preconditions already merged), T5.3 role expansion (OQ-003/OQ-004). Founder ratification
> queue lives in `docs/product-signoffs.md`.

> **UI/UX execution plan (`docs/Revealyst_UIUX_Execution_Plan.md`) — U0–U5 shipped —
> 2026-07-16** (PRs #244–#248 + #251): config-driven **nav IA**
> (`src/lib/nav-items.ts` `navFor` — personal orgs get Today/Growth/Connections/Settings, team
> orgs get Team/AI maturity/Connections/Settings, admin group Match accounts/Spend/Compliance)
> + theme toggle + shared primitives (`ConfidencePill`/`Banner`/`EmptyState` inline variant/
> `RecommendationCard` undo/`ConnectorCard`/`ResponsiveSheetContent`). The undo toast needed a
> new **`cleared` API action** on the closed-enum `rec_interaction_state` seam (**ADR 0043** —
> a DELETE, not a stored value; no migration). **U1** split the Personal Companion into **Today**
> (`/dashboard`) + a new **Growth** (`/growth`) route — a decomposition, not a new surface (Spec
> V4 §12.1 updated). **U2** added the `scope-claims.ts` per-vendor "what this connector can/can't
> measure" registry + a "limited" coverage badge, and impact/evidence framing on Match accounts.
> **U3** consolidated `/account`, `/billing`, `/members`, `/teams`, `/people` into `/settings/*`
> (all five 308) — a deliberate access change rides along: people management is now **admin-only**
> (members previously read `/people`/`/teams` as an unretired W5-H leftover). `/playbook` retitled
> "Shared-account migration guide" (R2 — no Playbooks nav item; Notification center R3 and command
> palette R4 stay deferred to the §8 ledger, not built). Latest mig still **0035**, latest ADR now
> **0043**. **U4** shipped the team narrative hero (floor-note copy from the live
> MIN_PEOPLE constant) + the workspace-setup stepper (scope explainer sourced from
> scope-claims/agent-collection-schema; server-derived resume). **U5** hardened touch targets
> (44px), axe coverage on every recomposed route, focus-on-route-change (skip link now visibly
> confirms — a blanket outline-none was caught as a WCAG 2.4.7 regression in review), dark-mode
> contrast, and CLS skeletons.
> **Founder-default decisions applied** (`docs/product-signoffs.md`, all unratified): D-U1/D-U2/
> D-U3/D-U5 proceed (Today+Growth split, "Today" label, Settings consolidation, benchmark-consent
> toggle to Settings→Privacy); D-U4 (mobile bottom nav) and D-U6 (persistent Help entry) **not
> adopted**; D-U7 (Playbooks direction) sits on the Future ledger.

> **Desktop Agent — planning phase merged, build NOT started — 2026-07-16**
> (`docs/Revealyst_Desktop_Agent_Execution_Plan.md`, phases M0–M7; spec transcript
> `docs/product/desktop-agent-spec.md`; gap analysis + registry
> `docs/product/desktop-agent-{gap-analysis.md,requirements.csv}`). The agent is the
> resident evolution of the CLI (`packages/revealyst-agent`) — Tauri 2 tray utility,
> macOS 13+/Win 10 22H2+, **Analytics Only default, never raw prompt/response upload**;
> reuses the `rva1.` device-token scheme, `AgentIngestRequest` day-aggregates, and the
> `AGENT_COLLECTION_FIELDS` allowlist (bridged to Rust via generated JSON). Desktop code
> will live in top-level `desktop-agent/` (excluded from root tsconfig — the only root
> build-config change, plus a `.gitignore` addition for Rust artifacts), with its own
> path-filtered `desktop-ci.yml` and a
> `release-desktop.yml` under a protected GitHub Environment (signing secrets NEVER in
> PR workflows). **Gates (do not force): D-DA-1** (resident-collector go/no-go —
> SYNC-007/TEL-017 demotion must be founder-cleared before any product-behavior PR) and
> **D-DA-2** (Spec V4 §9.4 sub-case-C ADR before any Team-org enrollment; Personal orgs
> first). Prompt-feature extraction ships shape+counts only until **D-DA-5**. Ledger rows
> D-DA-1…7 pending in `docs/product-signoffs.md`. Next ADR 0044 / migration 0036 (verify
> both at PR time).

## Product principles — UX & writing (highest priority)
These outrank feature scope: every screen, dialog, workflow, onboarding step, and
settings page must satisfy them, and any new feature must **preserve or improve**
the app's overall simplicity and consistency.

**UX — minimal by default.** The product must always feel minimal, clean, modern,
and distraction-free. Simplicity is the default: cut unnecessary UI elements,
options, dialogs, clicks, and visual noise, and optimize every screen and
component for the lowest possible cognitive load. Prefer **progressive
disclosure** — hide advanced functionality behind an opt-in rather than exposing
it by default.

**Writing — plain English for beginners.** Assume every user is a beginner and
write in plain, everyday English throughout the app. Avoid jargon, technical
terms, acronyms, and implementation details. Keep labels, buttons, descriptions,
onboarding, helper text, confirmations, and error messages concise, clear, and
action-oriented — tell the user what to *do*, not how the system works internally.
(This is the user-facing complement to invariant-(b)/W3-N: rendered UI copy is a
claim surface, so it must be both honest *and* plain.)

**AI development rule.** For every design or implementation decision, default to
the simplest solution that fully meets the requirements. Continuously refactor and
simplify existing UI and copy where appropriate instead of adding complexity —
reducing options and clarifying words is real work, not a nice-to-have.

## Stack facts
- Next.js / TypeScript monolith, deployed to **Cloudflare Workers** via OpenNext.
- **Neon Postgres** via Hyperdrive; **Drizzle** migrations from day one.
- Polling via **Cron Triggers → Queues** (one queue message per connection).
- Single database, `org_id` on every row. **Personal mode = an org of one** —
  identical machinery to Team.
- **Production (live since W0-B):** https://app.revealyst.com +
  https://revealyst.com (legacy revealyst.thapi.workers.dev redirects) — deploy via
  the manual `Deploy` GitHub workflow (migrations → queue → deploy → Worker-secret
  sync from repo secrets); CI uploads a preview version per PR. Founder infra steps
  + local no-credential dev loop (`npm run dev:db`): `docs/infra.md`.
- **Custom domains (host split, `docs/infra.md` §6):** ONE Worker, two custom
  domains — **`app.revealyst.com`** is the app + Better Auth origin (`BETTER_AUTH_URL`,
  GitHub OAuth callback, Paddle Default-Payment-Link/webhook all point here);
  **`revealyst.com`** is the public marketing site (landing today; docs/blog later)
  and the canonical home of public share cards. The split is enforced in `src/worker.ts`
  by a GET/HEAD host redirect from `src/lib/domains.ts` (the single source of truth for
  the two origins + path classification) — `/api/*`, assets, and the OpenNext
  self-reference subrequest pass through untouched on the custom domains.
  `src/lib/auth.ts` sets `trustedOrigins` to both hosts; share URLs are minted on
  the marketing host (`toMarketingOrigin`, `src/components/share-score-button.tsx`).
  The legacy `revealyst.thapi.workers.dev` host 308s GET/HEAD page requests to
  canonical hosts (`WORKERS_DEV_HOST`; neutral paths + non-safe methods still
  serve in place) and needs `workers_dev: true` kept explicit in wrangler.jsonc —
  adding custom-domain routes silently disabled the subdomain (edge 404 "error
  code: 1042", Worker never invoked) until 2026-07-10.
- Windows dev machine: OpenNext builds use webpack, not Turbopack (adapter's chunk
  patching breaks on Win — see `open-next.config.ts`); DB/auth clients are created
  per request, never cached at module scope (Workers cancel cross-request I/O).
- `npm run dev` (plain Next dev) needs `.dev.vars`'s `BETTER_AUTH_URL` set to
  `http://localhost:3000`, not the `wrangler dev` default of `:8787` — mismatch
  fails sign-up/sign-in with "Invalid origin" 403.
- `vitest.config.ts` now maps `@` → `./src` (added for component tests under
  `src/components/**/*.test.tsx`), so Vitest DOES resolve `@/` at test runtime.
  The historical relative-import convention in `src/lib`/`src/db` (`../db/x`)
  remains the house style for lib-to-lib imports, but it is no longer
  load-bearing for test resolution.
- `next dev` hits a LOCAL Postgres, not Neon: `createDb` prefers the HYPERDRIVE
  binding, whose wrangler `localConnectionString` is `127.0.0.1:5432` — run
  `npm run dev:db` (PGlite socket) first. The socket's historical postgres.js
  prepared-statement failure (`08P01`) is FIXED by `prepare: false` in
  `src/db/client.ts` — logged-in app-shell flows work against `dev:db` now
  (verified 2026-07-11: sign-in + platform-admin `/admin/users` against a
  `npm run dev:seed:demo`'d db; demo platform admin
  `sam.reyes@revealyst.example` / `Demo-Pass-2026!`). Data is in-memory —
  it vanishes when the `dev:db` process stops, and the demo seed NEVER
  touches prod (its users/passwords are committed to the repo — do not seed
  Neon with it). `.dev.vars` is per-worktree
  (gitignored); appending without a trailing newline concatenates onto the last key.
  Embedded-browser gotcha: React 19 reveals streamed Suspense content via
  requestAnimationFrame, and a hidden/unpainted pane never fires rAF — a page
  can hold fully-streamed data in `div[hidden][id^=S:]` yet read as "empty";
  assert on the streamed DOM, not innerText/screenshots.
- A corrupted `.next/dev/types/validator.ts` (from an interrupted `next dev`) breaks
  `tsc --noEmit` repo-wide with unrelated syntax errors; `.next` isn't in tsconfig's
  exclude — `rm -rf .next` and retype checks clean.
- Manually-created worktrees (`git worktree add`) don't get `node_modules` —
  run `npm install` in each before typecheck/test.
- `git worktree remove` can report "Permission denied" deleting the directory
  (locked by an editor/indexer) yet still succeed at unregistering the
  worktree — `git worktree prune` cleans up the stub; the leftover empty
  folder is harmless.
- Adding a Queue consumer to `wrangler.jsonc` (e.g. a DLQ) makes `wrangler
  versions upload` fail "Queue X does not exist" until the queue exists — add a
  `wrangler queues create <q>` step to BOTH `deploy.yml` AND the `preview-deploy`
  job in `ci.yml`, or every PR's preview-deploy goes red.
- New table: edit `src/db/schema.ts`, then `npx drizzle-kit generate --name
  <slug>` (offline, no DB) writes the next-numbered `drizzle/*.sql` + snapshot +
  `_journal` entry. Migration numbers and ADR numbers are INDEPENDENT sequences
  (both collided at 0009/0010) — check `ls drizzle/*.sql` and `ls docs/decisions/`
  separately before numbering. Re-check `ls docs/decisions/` after your FINAL
  sync to main too: a parallel workstream can merge its ADR into your number
  between your first check and your PR (W3-M's 0010 collided with W3-O's merged
  `0010-audit-log`; renumbered to 0011).
- Unauthenticated routes use `getApiContext()` (no session) from
  `src/lib/api-context.ts`, not `handleApi`/`appContext` (which require a
  session, 401 otherwise). System-level / bounded cross-org DB reads belong in
  the non-frozen `src/db/system.ts` (routes may import it; never `db/schema`).
- **Design system (W1-G):** Tailwind v4 + shadcn/ui `base-nova` — **Base UI**
  primitives, not Radix: custom triggers use `render={...}` (and
  `nativeButton={false}` when rendering an `<a>`/`Link`). Shared components in
  `src/components` (`EmptyState`, `SyncStatusBadge`, `PageHeader`, sidebar shell);
  pages/API get session + `forOrg` scope ONLY via `src/lib/api-context.ts`
  (`appContext`/`requireAppContext`) — never call `createDb` in a page/route.

## Performance & request-lifecycle observability (7s incident, PRs #125–#127)
- **Perf model:** on Workers → Hyperdrive → Neon, PER-ROUND-TRIP cost dominates
  authenticated TTFB, and ONLY authenticated requests touch Postgres at all
  (no-cookie `getSession` returns before any query) — so "authenticated pages
  slow, everything else fast" means DB-layer cost, not app code. Reduce
  sequential query STAGES first (see `readDashboardView`'s single flat
  `Promise.all` + prefetched-params pattern), then per-op cost.
- **Depth-1 ≠ parallel (24s dashboard incident, PR #265):** postgres.js does
  NOT pipeline concurrent queries on one connection — it queues them — so with
  the old `max: 1` a "depth-1" batch of N queries serialized at ~600ms EACH
  (prod Server-Timing: a 3-query access stage = 2250ms; Today's 39-query batch
  streamed ~20s). Query COUNT is a first-class cost alongside depth: budget
  ~ceil(N/5) round-trip waves. Fixes that hold the line: `max: 5` +
  `prepare: true` via Hyperdrive only (`src/db/client.ts` — loopback PGlite
  keeps 1/unprepared, 08P01), the isolate reference cache for seeded
  global/reference reads (`src/lib/reference-cache.ts` — org-varying reads
  need org-keyed entries, invariant a), union-window shared reads sliced per
  consumer (`sharedCompanionReadSpans`/`sliceScoreRows` in `src/lib/maturity.ts`
  — every slice pinned by an equivalence test), and the speculative
  org-context prefetch that runs alongside `getSession` in `appContext`
  (verified-userId-gated; getSession stays the authority).
- **Gauges:** `curl -sD - https://app.revealyst.com/api/health` →
  `Server-Timing: db;dur=` = connection setup + one query (unauthenticated DB
  probe). Authenticated docs//api//RSC responses carry
  `Server-Timing: session/orgContext/access/pageData/total` (devtools →
  Network). `tests/perf/authenticated-page-queries.test.ts` (run with
  `--reporter=verbose`) counts queries + sequential depth on PGlite.
- **Measured (W4, from BOM):** `db;dur` is a stable **~500–670ms per
  round-trip** (Neon inferred US region) — this per-round-trip floor, not app
  code, dominates authenticated TTFB. Read-path N+1 is already eliminated
  (dashboard 12 queries / depth 1). The **biggest remaining lever is a Neon
  read replica near users / region move** = founder infra, not yet done.
- **Edge caching is ON (W4, PRs #146/#147):** OpenNext incremental cache
  (static-assets flavor + `enableCacheInterception`, no new bindings). Live:
  `/sign-in` + `/legal/*` serve via **interception** (`x-opennext-cache: HIT`);
  the marketing landing `/` is **static** (`x-nextjs-cache: HIT`) — interception
  does NOT fire for `/` (interceptor strips the trailing slash `/`→`""`, missing
  the manifest key), so `/` rides the NextServer incremental cache instead.
  `public/_headers` makes `/_next/static/*` `immutable`. The `landing_view` §15
  metric now writes from the `src/worker.ts` entry seam (the page went static) —
  it must count ALL non-RSC GETs of `/` (gating on `Accept: text/html` silently
  drops `*/*`/no-Accept crawlers+monitors the old force-dynamic render counted).
- **Instrumentation seam:** `src/lib/request-timing.ts` (`timeStage`, ALS
  collector entered in `src/worker.ts`). Streamed (Suspense) stages log as
  late-stage JSON lines (headers already flushed); assets/WebSocket upgrades
  pass through untouched. **OpenNext bundles src twice** (worker entry vs Next
  server) — any request-scoped singleton MUST anchor on `globalThis`, or the
  two module copies get separate instances (shipped the header with zero
  stages; fixed in #127).
- **DB client (`src/db/client.ts`):** `fetch_types: false` (postgres.js
  otherwise pays a pg_catalog introspection round-trip on every request's
  fresh connection). **Smart Placement is OFF and must stay off** (reverted
  in PR #131): within hours of the #126 deploy enabling it, every request
  invoking Better Auth (all auth API paths, `/api/me`, authenticated pages)
  hung indefinitely in prod while non-auth routes stayed fast — same bundle
  + env ran clean in local workerd, so it's a placement-layer interaction
  with this dual-custom-domain Worker (see wrangler.jsonc comment).
  Re-enabling needs its own monitored change. Related: cross-surface links
  (marketing↔app host) must be plain `<a>`, never `<Link>` — a soft-nav RSC
  fetch gets 308'd cross-origin and CORS-blocked (PR #132).
- **Better Auth perf config:** `experimental: { joins: true }` is a TOP-LEVEL
  `betterAuth()` option — inside `drizzleAdapter`'s options it is silently
  ignored. The join path needs drizzle `relations()` (`src/db/auth-relations.ts`,
  deliberately OUTSIDE frozen `schema.ts`) spread into `drizzle()`'s schema
  (`fullSchema`, exported from `db/client.ts` — tests that build their own
  PGlite db + `createAuth` must import it). A model reachable via `join` but
  missing its relation THROWS at query-build time (no soft fallback) — wire
  user↔sessions/accounts too, not just session→user. `session.cookieCache`
  stays OFF (tripwire in `auth.ts` — admin ban/impersonation gates must be
  re-audited before enabling).

## Operating model — rules 1–7 (from the execution plan)
1. **Contracts before fan-out.** No W1+ workstream starts until W0-C is frozen.
   Post-freeze changes require an ADR (`/adr`) + re-sync of affected workstreams.
2. **Fixtures over coupling.** Engine/UI build against fixture `metric_records`/
   `score_results`; connectors against recorded vendor payloads. Live data only at gates.
3. **One agent, one workstream, one PR chain.** Independently mergeable, own tests,
   merges gated on CI. Never read another workstream's branch.
4. **Gates are human-reviewed, thin, evidence-based.** Never self-certified by the
   authoring agent; adversarial pre-review first; the founder judges *evidence, not code*.
5. **External approvals are the critical path — fire ASAP.** GitHub App/OAuth → W0
   (no site needed); Paddle MoR → the instant W2 has a live site; legal → when terms drafted.
6. **The seams have an owner (W1-S).** Standing workstream owns contract tests,
   recorded-payload fixtures, the tenant-isolation test, and the cross-workstream E2E.
7. **Scope tripwires** — stop any agent building one (see below).

## Frozen contracts — do not touch without an ADR (tag `contracts-v1`)
Frozen at the W0-C freeze ceremony. Any change requires an ADR in `docs/decisions/`
— **stop and ask before touching them.** CI blocks PRs that change a frozen path
without a `docs/decisions/` change in the same PR. Adding a NEW org-scoped table
is one such PR (additive, but still trips the guard): ADR + `drizzle-kit generate`
+ a `SCOPED_READS` entry in `tests/tenant-isolation.test.ts` with a non-vacuous
B-org seed row in its `beforeAll` (the completeness tripwire fails otherwise).
- **`src/contracts/**`** — typed interfaces: `Connector` (pure `normalize`, honesty
  gaps), `ScoreDefinition`/`ScoreResult` + zod shapes, `CANONICAL_METRICS`,
  attribution ladder + `lowestAttribution`, API-route contracts (`api.ts`), and
  **`tracked_user`** (`tracked-user.ts`): an identity-resolved person with ≥1
  metric_record in the period; unresolved key/account subjects surfaced, **not
  billed**; shared accounts count resolved identities only.
- **`src/db/schema.ts`** + **`drizzle/**`** — schema & migrations, incl. sub-daily
  signals (`subject_day_signals`: 24-slot histogram + peak concurrency per
  subject/day, for W2-K), the `metric_records` natural upsert key, the metric
  catalog as a seeded reference table (mig 0007, not an enum), score presets
  (mig 0009), and the encrypted-credential column shape (`connection_credentials`:
  base64 envelope fields only — no plaintext credential column anywhere).
- **`src/db/org-scope.ts` public API** — the tenancy contract: `forOrg` is the only
  application query surface (ADR `docs/decisions/0001-tenant-isolation.md`;
  enforced by composite tenant FKs, `scripts/check-org-scope.mjs` in CI, and the
  `tests/tenant-isolation.test.ts` sweep incl. its completeness tripwire).
- **`src/lib/credentials.ts` row format** — AES-256-GCM envelope, versioned
  Worker-secret KEK, AAD = `orgId:connectionId:kind`; rotation = DEK rewrap only.
- **`docs/connector-facts.md`** — per-vendor endpoints/auth/granularity/attribution.
- **`fixtures/**` shapes** — downstream builds against these (rule 2); adding
  coverage is fine, changing existing shapes is an ADR.

## Tripwires — never build in V1 (rule 7, verbatim)
No formula DSL · no browser extension/proxy · no prompt-content ingestion in Team mode ·
no second B2C funnel for Personal · no Kafka/ClickHouse · no separate ML service ·
no Chinese-vendor connectors. Cut order under pressure: ChatGPT-export upload →
score-card polish → Cursor connector — **never** privacy defaults or attribution honesty.

## Tenancy rule
Every query goes through the org-scoped repository layer / RLS. **Raw table access
without org scoping is a review-blocker.**

## Review invariants — every `/code-review` inherits these four (§8)
(a) every query org-scoped · (b) never fabricate per-user numbers ·
(c) frozen contracts untouched without an ADR · (d) no tripwire tech.

**Gate-check finding pattern (W2):** 2 of 3 gate blockers were "a new call
site forgot a guard its siblings already had" — `dashboard-view.ts` threaded
`visibilityMode` into `readDashboard`/`resolveSegmentSource` but not the
adjacent `resolveSharedAccountSource().flags()` call; the poller never got
the delete-then-upsert restatement guard that agent-ingest already used. When
adding a call alongside existing ones, diff it against its siblings for the
same guard — and if a new field is added to a type an audit predicate
inspects (e.g. `assertTeamOnlyPseudonymized`), update the predicate too, or
it passes vacuously.

**Scoring engine rule (invariant b, applied per-component):** a ratio component
needs rows on BOTH sides — absence on either side omits the component, never
floors it to a fabricated 0 (conflates "no data yet" with "measured zero").
Plain (non-ratio) metric components floor to 0 on no rows; that's intentional
and tested (`tests/scoring-evaluate.test.ts` "honesty rules").

**Content/legal-workstream rule (invariant b, W3-N):** prose is a claim surface
too — a DPIA/ToS/DPA that states a security control or product behavior the
system doesn't have is an invariant-(b) overclaim, just like a fabricated
number. Fact-check EVERY product claim in written content against the code, not
only the one you're suspicious of: W3-N shipped a "KMS envelope" claim (there is
no KMS — it's a versioned Worker-secret KEK, see `src/lib/credentials.ts`) and a
"read-only vendor scopes" claim (the admin keys are non-scoped full-access per
`docs/connector-facts.md` — Revealyst *uses* them read-only; the scope isn't).
The KMS one slipped into merged PR #75 because that PR's fact-check was scoped
narrowly to the claim under suspicion; a broad "check every sentence" pass in
#76 caught both. Run an adversarial content fact-check (a reviewer that did not
write the prose) over the whole document, grounded in the schema/credential/
connector-facts contracts. W3-P repeats confirmed the pattern (13 findings in
launch copy, incl. the same "read-only" claim independently re-invented) and
added a structural fix: the landing page's "Connects" strip derives from
`src/connectors/registry.ts` — never hard-code connector claims in copy, and
never present-tense a not-yet-live connector. (Copilot shows "Soon": it *is*
registered in the connector registry since ADR 0022, but is founder-gated off
the live surface via `NLV_PENDING_VENDORS` in `src/lib/vendor-connect-meta.ts`
— "not yet live," not "unregistered.")

**Timestamp gotcha (analytics/funnels, W3-P):** `score_results.computed_at` is
REWRITTEN by the nightly recompute upsert (`org-scope.ts` `upsertResults`) —
never derive "first score" / activation timing from it (min(computed_at) reads
as days, not minutes, for any org older than a day). `connector_runs` rows are
append-only per attempt — the stable timestamp source; score-row EXISTENCE is
stable for activation booleans.

**Billing/entitlement pattern (W3-M, Paddle):** the free-band paywall gates BOTH
the page shell (`(app)/layout.tsx`) AND the JSON APIs (`handleApi` — the API
choke point; 402 by default, opt-out `allowOverFreeBand` only for the
upgrade/portal routes). A UI-only gate leaves fleet data readable via `/api/*`
with the session cookie. `org.kind` never becomes `team` (nothing sets it), so
entitlement is count-based (`tracked_user` × subscription via
`src/lib/access.ts` `computeAccess`), never kind-based. Product params shown in
UI/legal prose (free-band size, price) render a single source-of-truth constant
(`FREE_TRACKED_USER_LIMIT`) so ToS/landing can't drift from what the code
enforces — the W3-N content-overclaim rule applies to rendered pages, not just
docs. Metering is a charge path on an at-least-once queue: compare-and-set the
seat quantity in Postgres BEFORE the Paddle PATCH (`subscriptionsForOrg`
`.setQuantityIf`) so concurrent/redelivered messages charge once, and
record-then-charge so a mid-flight crash under-bills (safe), never
double-charges. Paddle checkout needs a dashboard Checkout Settings → Default
Payment Link set, or `POST /transactions` 400s
`transaction_default_checkout_url_not_set` and the overlay never opens.

**Tailwind v4 `.dark`-scoped sections (W1-G design system):** inside a
section-level `dark` class, arbitrary-value CSS must use the raw tokens
(`var(--background)`, `var(--muted-foreground)`) — the `@theme inline`
`--color-*` vars resolve at `:root` (light) and ignore the scoped override
(painted a white vignette over a dark hero; invisible to DOM assertions, found
only by mechanism review). Also: base-nova `Card` draws its outline with
`ring-1`, so `border-*` color classes are silent no-ops on it — use `ring-*`.

- Windows dev machine: `preview_screenshot` can time out persistently while
  `preview_snapshot`/`preview_inspect`/`preview_eval` all work — verify with
  DOM/CSS-level assertions instead of blocking on the screenshot.

## How the fleet works
- **Plan mode before code, every time.** `/kickoff <workstream>` starts in plan mode;
  the founder approves the *plan*, not the diff.
- **Fresh context beats long context.** One workstream per session; new session per
  major task. State lives in the branch, the contracts, and this file — not a conversation.
- Inner loop: plan → feature-dev → build against fixtures → own tests →
  `/code-review` + **apply fixes** → `/commit-push-pr` → merge on green CI. Run
  review and land its fixes BEFORE opening the PR (see merge-race below), so the
  PR's first commit is already the reviewed state. Small PRs; a workstream is a chain.
- Custom skills: `/kickoff`, `/gate-check`, `/adr`, `/new-connector`. Gate pre-review:
  `/gate-review <wave>` workflow + the `contract-guardian` / `adversarial-reviewer` subagents.
- **Hooks run on every Edit/Write** (`.claude/settings.json`): a tripwire guard (rule 7) and
  a post-edit typecheck. Expect them to block on drift — that's the design, not a glitch.
- Keep this file current: `/revise-claude-md` at session end; `/claude-md-improver` once per wave.
- **Before deleting any branch as "merged":** check `git merge-base --is-ancestor
  <branch> main`, not the PR's GitHub state — a branch can receive a later merge
  *after* it was already merged upstream, stranding real work with a "MERGED" PR
  label (cost W1-D 10 tested fixes; recovered in PR #51).
  The ancestor check itself has a false-negative mode: an intermediate branch in
  a stacked-PR chain can show NO even when fully merged, if it got a no-op
  merge-back commit after being forked further. Before treating NO as stranded
  work, run `git log main..branch --oneline` — if the only "unique" commits are
  merges of a *later* PR in the same stack (not real diffs), it's a stale
  pointer, not lost work.
- **Merge-race: the founder merges each PR at its PR-creation-time commit**, so any
  commit pushed *after* `gh pr create` (e.g. review fixes) is silently dropped from
  the merge. Always `/code-review` + apply fixes *before* opening the PR. If fixes
  slipped in after, verify each with `git merge-base --is-ancestor <fixSHA>
  origin/<target>`; recovery for a stacked chain = retarget the still-open tip PR's
  base to the integration branch (its HEAD holds the whole reviewed stack). Cost
  W2-K all 4 PRs (#55/#57/#60), recovered via #63 retargeted to `w2-k`.
  **Stacked-PR variant (W3-P):** GitHub's merge button merges a PR into its
  *base branch* — for a stacked PR that's the parent branch, NOT main. "All
  PRs merged" can therefore leave every non-root PR stranded on stack branches
  (cost W3-P #88/#90; recovered via #91→#92 from the stack tip based on main).
  After any stack merge, verify the TIP commit with `git merge-base
  --is-ancestor <tipSHA> origin/main` before celebrating or deleting branches.
  And if a recovery PR develops conflicts with main, don't push the resolution
  to the open PR (merge-race drops it) — resolve on a fresh branch and
  recreate the PR with the resolution in its creation-time HEAD.
- **Parallel-fan-out numbering collisions (W4 orchestration):** when N agents
  build simultaneously, each grabs the "next" ADR/migration number offline and
  they COLLIDE (W4: ADRs 0018/0020/0021 + migration 0020 all double-claimed
  across 5 workstreams). ADR and migration are INDEPENDENT sequences. The
  orchestrator must serialize merges and, after each ADR/migration-bearing
  merge, have the next agent rebase + renumber (rename the ADR file, regen the
  migration via `drizzle-kit generate`, update every code/test/PR-body ref)
  BEFORE its PR merges. Cheaper than post-hoc recovery.
- **Verify CI check state EXPLICITLY before merging — never pipe `gh pr merge`
  after `gh pr checks`:** a shell pipe masked a red check and auto-merged a PR
  whose `npm test` had FAILED (W4: #140 merged with a failing
  account-deletion purge tripwire → needed hotfix #143). Pattern: capture
  `gh pr checks <n>` output, grep for `fail|error`, and merge only if clean.
- **A new org-scoped table needs THREE registrations, not two:** (1)
  `tests/tenant-isolation.test.ts` SCOPED_READS with a non-vacuous B-org seed,
  (2) a `docs/decisions/` ADR, AND (3) `src/db/account-deletion.ts` —
  PURGE_TABLES if it has no cascade-to-orgs FK, else PURGE_EXEMPT_TABLES. The
  purge-completeness tripwire (`tests/account-deletion.test.ts`) is CI-enforced
  and will red main post-merge otherwise (W4: `budgets` missed #3).
- **Shared-checkout hazard:** concurrent agent sessions drive this ONE physical
  checkout and can switch branches/HEAD under you mid-task (observed: reflog
  hopping across 5 branches while agents worked; uncommitted edits survive a
  checkout but not a reset). Verify `git branch --show-current` immediately
  before staging/committing, stage explicit paths (never `git add -A` — foreign
  in-progress edits share the tree), and commit+push early to make work durable.
- Flaky, not broken: an occasional `[vitest-pool]: Worker exited unexpectedly`
  (Windows fork crash) and a rare pseudonym-collision in `tests/api-impl.test.ts`
  are known transient flakes — rerun before treating either as a regression.
  The full suite fails a *different* small set each run under load (2–5 files,
  auth/connector tests); confirm by running the named files in isolation (they
  pass) rather than assuming a regression.
- `preview-deploy` CI intermittently fails on a Cloudflare Hyperdrive-binding 500
  (`code: 10021`, "try again later") unrelated to the diff — `gh run rerun <id>
  --failed`, don't debug.
