# Manual Sync — Implementation Plan

**Date:** 2026-07-11 · **Status:** Implementation plan (approved research → build) ·
**Source of truth:** [Manual Sync vs. Desktop Connector evaluation](research/2026-07-11-manual-sync-vs-desktop-connector.md)
(supersedes the resident-collector build direction of [2026-07-09-desktop-collector.md](research/2026-07-09-desktop-collector.md) §5.5(C)/§5.6 until the Phase-3 re-decision) ·
**Method:** synthesized from seven parallel single-ownership evidence streams (architecture, backend, desktop/CLI,
telemetry, security & privacy, UX, adversarial review), each grounded in file:line inspection of this repo at
`bd00f77`. Findings below are code-verified unless marked **[assumption]**; deliberate deviations from the research
doc are marked **[decision]** with rationale.

**Scope:** Phase 1 MVP = the research's §6 items 1–8, Personal plan, **zero frozen-contract changes, no ADR, no new
tables** (verified: ingest writes only existing `raw_payloads`/`subjects`/`metric_records`/`subject_day_signals`/
`connections`, so no tenant-isolation/account-deletion/ADR registrations are triggered). Phase 2 = the
`sync_window_incomplete` honesty-gap ADR. Phase 3 = the demand-gated resident-agent re-decision.

---

## 1. Architecture

**Shape (unchanged from research §4): keep the thick client, on demand.** The shipped `revealyst-agent` CLI already
is the manual sync — stateless, idempotent, on-demand, pushing the frozen aggregate contract. Phase 1 wraps it in a
first-class in-app Sync surface and fixes four client/route defects. No event-schema inversion, no server-side
normalizer, no queue-normalize path, no new auth mechanism, no new tables.

```
Connections page (new Sync card, reuses AgentConnectCard)
  │  mint/rotate token: POST /api/connections            (existing, reused)
  │                     POST /api/connections/:id/agent-token (existing, reused)
  ▼
user runs:  npx revealyst-agent login --token rva1.…     (first run)
            npx revealyst-agent sync [--dry-run]         (every run)
  │  discover  → ~/.claude, ~/.config/claude, CLAUDE_CONFIG_DIR   (discover.ts)
  │  stream-parse JSONL, allowlist-only                  (parse.ts — privacy line; now streaming)  ← PR1
  │  summarize → metric rows + 24-slot signals           (summarize.ts, UTC days)
  │  window.start = max(lookback, earliest surviving event day); abort if no events in window  ← PR1 (Fix 1)
  ▼
POST /api/agent/ingest  (Bearer device token; 10 MB cap; getApiContext seam)
  │  auth → validate → txn: raw_payloads → subjects → delete-then-upsert(window) → signals → markSynced
  │  post-commit, best-effort: POLL_QUEUE.send({kind:"score-recompute", orgId, day})   ← PR2 (Fix 2)
  ▼
existing queue consumer recomputes month + rolling_28d (idempotent upsert)
  ▼
UI: SyncStatusBadge "Synced just now" (existing, from last_success_at)
    + staleness state past threshold                     ← PR3
    dashboard "data as of your last sync" banner          ← PR3 (zero new queries)
```

**Architectural invariants preserved:**
- The privacy line stays on-device (`packages/revealyst-agent/src/parse.ts:1-15`); the server's `dim` bound
  (`src/lib/agent-ingest.ts:132-141`) remains the second line. No upload path for raw files exists or is added
  (research §1.2(b) categorically rejected — it would falsify "No prompt content. Ever." at `src/app/page.tsx:145,265`,
  `src/app/(app)/compliance/page.tsx:36-37`, and `docs/compliance/dpia-template.md:47-51`).
- Tenancy derives from the token, never the payload: `forOrg(db, token.orgId)` everywhere
  (`agent-ingest.ts:57,147`); all agent-written tables are in the tenant-isolation SCOPED_READS sweep
  (`tests/tenant-isolation.test.ts:69-75`) with the completeness tripwire.
- "A push is authoritative for its window" (delete-then-upsert, `agent-ingest.ts:171-190`) is kept — Fix 1 makes the
  *client* never declare a window wider than its surviving evidence, rather than weakening the server semantic.

## 2. Components & responsibilities

| Component | Location | Responsibility (Phase 1 delta) |
|---|---|---|
| CLI `sync` command | `packages/revealyst-agent/src/cli.ts` | Token resolution gains `REVEALYST_TOKEN` env fallback (ephemeral, never persisted); streams files instead of `readFileSync` (`cli.ts:104`) |
| Window derivation | `packages/revealyst-agent/src/window.ts` + `index.ts` | `trailingWindow` output clamped: `start = max(requested, earliest surviving event UTC day)`; zero-events-in-window ⇒ abort before any network call |
| Parser | `packages/revealyst-agent/src/parse.ts` | Extract per-line parse fn for streaming; allowlist and skipped-line accounting unchanged; `parseSessionContent` kept as wrapper (frozen-seam test depends on it) |
| Composition root | `packages/revealyst-agent/src/index.ts` | `buildIngestRequest` computes the clamp (it holds all events); the clamped window feeds **both** `summarize` and `batch.window` (they must agree — `batch.window` is what the server deletes) |
| Ingest lib | `src/lib/agent-ingest.ts` | Gains optional injected `deps.send` (mirrors `PollDeps.send`, `src/poller/run.ts:57`); fires `{kind:"score-recompute", orgId: token.orgId, day: previousDay(todayUTC)}` post-commit, best-effort, only when rows were written |
| Ingest route | `src/app/api/agent/ingest/route.ts` | Supplies `deps.send` from the runtime env's `POLL_QUEUE` (present at runtime; type-erased by the `CredentialEnv` cast in `getApiContext`, `src/lib/api-context.ts:105-108`) |
| Sync surface | `src/components/` (extraction) | `AgentConnectCard` extracted from `src/components/onboarding-wizard.tsx:279-417` into a standalone shared component; rendered on the Connections page as a sibling section to `GithubAppConnectCard` (`connections/page.tsx:176-185`); adds copy button, repeat-run command, `--dry-run` line, last-synced state |
| Onboarding wizard | `src/components/onboarding-wizard.tsx` | Renders the extracted card; broken one-liner at `:372` replaced by the two-command block |
| SyncStatusBadge | `src/components/sync-status-badge.tsx` | New opt-in stale state via `staleAfterDays?: number` prop — supplied **only** for `claude_code_local` rows; polled connectors (`connections/page.tsx:139`, `dashboard/page.tsx:632`) pass nothing and are behaviorally unchanged |
| SyncStalenessBanner | `src/components/` (new, mirrors `BudgetAlertBanner`) | "Data as of your last sync (Nd ago)" above `AttentionSection` in both dashboard views; derived from already-fetched `connections` (zero new queries); doubles as the future resident-agent upsell slot |
| Shared copy constants | `src/lib/agent-sync.ts` (new, pure/db-free like `src/lib/entitlements.ts`) | Single source for: npx command strings, pinned version, staleness threshold days — consumed by wizard, Sync card, badge callers, banner (the `FREE_TRACKED_USER_LIMIT` pattern) |
| Release workflow | `.github/workflows/release-agent.yml` (new) | `workflow_dispatch`, npm publish with `--provenance`, `id-token: write`, `NPM_TOKEN`-gated (mirrors `deploy.yml`'s secret-gating shape) |

## 3. Project structure

No new directories. Additions/changes only:

```
packages/revealyst-agent/src/   cli.ts, window.ts, parse.ts, index.ts, config.ts  (modified)
src/lib/                        agent-ingest.ts (modified), agent-sync.ts (new)
src/app/api/agent/ingest/       route.ts (modified)
src/components/                 sync-agent-card.tsx (extracted), sync-staleness-banner.tsx (new),
                                sync-status-badge.tsx (modified), onboarding-wizard.tsx (modified)
src/app/(app)/connections/      page.tsx (modified)
src/app/(app)/dashboard/        page.tsx (modified — two view branches)
src/app/                        page.tsx (source comment :68-70 updated only)
tests/                          agent-cli-contract.test.ts, agent-ingest.test.ts (extended)
src/components/                 sync-status-badge.test.tsx (new)
.github/workflows/              release-agent.yml (new)
packages/revealyst-agent/       package.json (publish fields), README.md (copy alignment)
```

Frozen surfaces **read but untouched** (CI `frozen-contracts` guard stays green with no ADR):
`src/contracts/api.ts` (`agentIngestRequestSchema:115-128`), `src/contracts/connector.ts` (`HonestyGap:24-33`),
`src/db/schema.ts`, `drizzle/**`, `src/db/org-scope.ts` public API (`markSynced`, `metrics.*` used as-is),
`src/lib/credentials.ts`, `docs/connector-facts.md`, `fixtures/**` shapes.

## 4. Data flow

Verified end-to-end (evidence stream, file:line):

1. **Discovery** — `claudeConfigDirs` (`discover.ts:24-39`): `~/.claude`, `~/.config/claude`, comma-split
   `CLAUDE_CONFIG_DIR`, de-duped; `listSessionFiles` (`:50-80`) walks depth ≤6 collecting `{path, sizeBytes, mtimeMs}`.
2. **Parse (PR1: streaming)** — today `cli.ts:100-108` whole-file `readFileSync` → V8 ~0.5 GB string ceiling throws on
   documented multi-GB session files. Replace with `createReadStream` + `readline` per-line feed into an extracted
   per-line parser. Skipped-line/unknown-type accounting (counters declared `parse.ts:106-107`, incremented at
   `:117,122,128,138,177`; surfaced as honesty gap in `index.ts:51-56`) preserved.
3. **Window (PR1: Fix 1)** — `trailingWindow(now, days)` (`window.ts:6-13`) is computed before parsing and today goes
   to the server verbatim; the server deletes the **entire declared window** (`agent-ingest.ts:171-175`,
   `org-scope.ts:1076-1113`). Clamp in `buildIngestRequest` after events are in hand:
   `effectiveStart = max(requested.start, min(utcDay(event.timestampMs)))` — **event-day-based, not file-mtime-based**
   [decision: mtime is an imprecise upper bound; a file touched today can hold old days]. The pin is global across all
   config dirs (events are already flattened, `index.ts:31-39`). **If zero events fall in the window, abort with
   "no logs within the last N days; nothing to sync" and send nothing** — the pin alone doesn't cover the all-pruned
   case, and an empty authoritative window is pure history destruction. All-UTC throughout (`summarize.ts:37-43`,
   `window.test.ts:19-26`) — no local-time mixing.
4. **Push** — `pushBatch` (`push.ts:11-64`), single `POST /api/agent/ingest`, unchanged.
5. **Ingest** — token auth first (`agent-ingest.ts:52-88`, timing-safe, AAD-bound decrypt), zod + window/subject/dim
   guards (`:91-142`), then one transaction (`:146-209`): `raw.insert` → `subjects.upsertMany` →
   `deleteWindowForConnection` → `upsertRecords` (natural key `(orgId, subjectId, metricKey, day, dim)`,
   `org-scope.ts:1049-1056`) → `upsertSignals` (PK `(orgId, subjectId, day)`) → `markSynced` (sets `status='active'`,
   `last_polled_at`, `last_success_at`, clears `last_error`; paused-guarded — `org-scope.ts:595-613`).
6. **Recompute (PR2: Fix 2)** — post-commit, best-effort (try/catch → `console.warn`, never rethrow — mirrors
   `run.ts:120-135`): send `{kind:"score-recompute", orgId, day: previousDay(todayUTC)}` (`messages.ts:50-59`) to
   `POLL_QUEUE` (queue `revealyst-poll`, `wrangler.jsonc:62-68`). **Guard: enqueue only when the ingest wrote rows**
   (`records + signals > 0`) — the cheapest coalescing step against empty-sync spam. Consumer
   (`poller/process.ts:71-101`) recomputes month + rolling_28d, idempotent on the frozen `score_results` key; duplicate
   messages are harmless but each costs a full recompute (see §9 Error handling / §7 Security for the amplification
   note). **Caveat (by design, inherited from the sanctioned poll anchor `run.ts:120-127`):** the `previousDay` anchor
   means same-UTC-day usage reflects in the score only once a later period covers that day — the "click Sync → watch
   your score" payoff is about yesterday-and-earlier data, and Sync-surface copy must not promise same-day score
   movement.
7. **UI reflection** — `SyncStatusBadge` reads `last_success_at` (already wired at `connections/page.tsx:139`,
   `dashboard/page.tsx:632`); the dashboard banner derives `max(lastSuccessAt)` over `claude_code_local` connections
   from the **already-fetched** `connections` in both views (`dashboard/page.tsx:163,438`; `dashboard-view.ts:98,191`)
   — zero new DB round trips (respects the ~500-670 ms/RT perf model).

**Sync protocol:** full-window restatement, no cursor, idempotent under retry by the natural PK. "What's new since
last time" remains a non-question.

## 5. Telemetry pipeline

- **Staleness source of truth = `connections.last_success_at`** (stamped by `markSynced`). Explicitly forbidden
  sources: `score_results.computed_at` (rewritten nightly — CLAUDE.md gotcha), `connector_runs` (agent ingest writes
  **no** run rows — verified, `run.ts:408-413` is poller-only), `max(metric day)` (calendar coverage, not sync time).
- **Staleness threshold**: one shared constant (`src/lib/agent-sync.ts`, default **14 days = ½ · the 30-day default
  `cleanupPeriodDays`** [assumption A2 of the research — upstream-changeable, hence a constant/prop, not scattered
  literals]). Badge and banner consume the same constant so they can never disagree.
- **Honesty exposure (verified):** plain metrics floor to 0 on absent rows (`scoring/evaluate.ts:103-106`, test
  `scoring-evaluate.test.ts:369`); ratio components gap-omit (`evaluate.ts:119-121`); a definition consuming no rows
  yields no score row (`:154-156`). An unsynced week therefore paints tokens/requests/sessions/active-days/spend-est
  as measured-zero — the staleness banner is the MVP-mandatory honest counterweight (invariant b).
- **Finding beyond the research doc:** `body.gaps` accepted by agent ingest are validated, stored inside the
  `raw_payloads` blob, and **silently dropped from every dashboard** — both gap readers pull exclusively from
  `connector_runs.gaps` (`dashboard-view.ts:131,190`, `honesty-gaps.ts:1-7`), which the agent path never writes.
  Consequence: Phase 2's `sync_window_incomplete` is **not a pure enum add** — it needs a gap sink for the local-agent
  path (cheapest: `agent-ingest` writes a `connector_runs` row with `dedupeGaps(body.gaps + synthesized gap)`, which
  also retroactively fixes the silent drop). Size the Phase-2 ADR accordingly.
- **Recompute cost model:** each message runs up to two `recomputeOrg` passes with per-metric-key and per-person N+1
  reads (`recompute.ts:80-85,159-161`). No dedup exists; correctness doesn't need it (idempotent upsert), cost does —
  hence the wrote-rows guard now, and a per-connection min-interval as a fast-follow if `last_synced` telemetry shows
  rapid-fire syncs.
- **Cadence instrumentation (feeds the Phase-3 re-decision):** `last_success_at` deltas per `claude_code_local`
  connection are the measured sync-cadence signal (research R1/A8). No new writes needed; an ops query/dashboard over
  existing columns suffices for the go/no-go.

## 6. APIs & contracts

**No new or changed API contracts in Phase 1.** Reused as-is:

| Surface | Contract | Phase-1 status |
|---|---|---|
| `POST /api/agent/ingest` | Bearer `rva1.<orgId>.<connectionId>.<secret>`; body `agentIngestRequestSchema` (frozen) | Behavior gains a post-commit enqueue — same class as `connectionsPoll`'s `recompute` semantics; **not** a schema/contract change, no ADR |
| `POST /api/connections` | create-or-reuse `claude_code_local` + `device_token` connection | Reused by the Sync card exactly as the wizard does (`onboarding-wizard.tsx:301-306`) |
| `POST /api/connections/:id/agent-token` | session-authed, member-level; upsert-rotate; token returned once | Reused; rotation invalidates the prior token immediately (`org-scope.ts:655-667`) |
| Queue `POLL_QUEUE` | `PollMessage` `{kind:"score-recompute", orgId, day}` (`messages.ts:50-59`) | New producer call site (ingest lib); message shape untouched |

**Internal seam change (typed, not a contract):** `ingestAgentBatch` gains an optional `deps: { send?: (msg: PollMessage) => Promise<void> }`
parameter [decision — over widening `getApiContext`: the orgId needed for the message exists only inside the lib
(`token.orgId`; the route never sees it), injection keeps `ingestAgentBatch` PGlite-testable by asserting the callback,
and it avoids touching the `check-org-scope.mjs`-allowlisted `getApiContext` seam]. The route builds `send` from the
runtime env's `POLL_QUEUE` (runtime-present; only the `CredentialEnv` typing hides it — `cloudflare-env.d.ts:7`).

**Phase 2 (ADR-gated):** `sync_window_incomplete` added to the `HonestyGap` kind union touches three mirrored
surfaces — `src/contracts/connector.ts:24-33`, `honestyGapSchema` `src/contracts/api.ts:103-113`, and the agent
package's `types.ts` mirror — plus the gap-sink write (§5). One ADR covers all.

## 7. Security & privacy

Verified posture, preserved:
- Token parse is strict and non-throwing (`agent-token.ts:52-65`); secret compare is constant-time
  (`agent-token.ts:72-84`); credential storage is the frozen AES-256-GCM envelope, AAD `orgId:connectionId:kind`.
- Revocation: rotate (upsert on `(connection_id, kind)`) or pause (403 post-auth, `agent-ingest.ts:86-88`;
  `markSynced` cannot un-pause). Blast radius of a leak: write-only restatement of one connection's windows; reads
  nothing.
- Token display is show-once, React-state-only, never browser-persisted (`onboarding-wizard.tsx:290,336,366-374`) —
  the extracted Sync card must preserve exactly this.

Phase-1 security work items:
1. **Copy switches to the two-command block** (`login --token …` then `sync`) [decision — over the env-var one-liner:
   inlined env vars land in shell history and `/proc/<pid>/environ`; the 0o600 config file (`config.ts:55-61`) is
   strictly better at rest]. The CLI **also** gains `REVEALYST_TOKEN` as an ephemeral fallback (validated by
   `isValidTokenShape`, never persisted, never echoed, documented "CI/headless only") so anyone holding today's broken
   copy or old READMEs is un-stranded.
2. **npm supply chain (R7):** the unscoped name `revealyst-agent` is unclaimed while live onboarding copy already
   prints `npx revealyst-agent` — an open squat window onto machines holding `~/.claude`. **Claim the name in the
   first Phase-1 deploy window** (stub or real publish). **[decision] Publish under unscoped `revealyst-agent`**,
   matching the shipped `bin`, README, and all copy (zero drift risk), deviating from the research's `@revealyst/agent`
   — flagged for founder sign-off in the publish PR; flipping to scoped is cheap **only before** first publish. Either
   way: CI-only release, `npm publish --provenance` with `id-token: write`, npm 2FA + automation token in a repo
   secret, version-pinned copy (`npx revealyst-agent@<MIN_AGENT_VERSION> …`) to harden the warm-npx-cache gap (A6) and
   bound bad-publish blast radius.
3. **CSRF on the mint route:** research assumption A7 (Better Auth SameSite + `trustedOrigins` enforced on POST) must
   be verified for this custom route in the Sync-surface PR — a forged mint rotates the victim's token and bricks
   their agent. Add an explicit Origin check if Better Auth's CSRF cover doesn't extend to non-auth API routes.
4. **Recompute amplification:** device tokens don't expire (mint passes no `expiresAt`; enforcement machinery exists
   at `org-scope.ts:697-701`). Guard now: wrote-rows-only enqueue + best-effort/non-blocking send. Fast-follows,
   cheapest-first: per-connection min-interval on accepted syncs; optional `expiresAt` on mint; "last used" surfacing.
5. **Copy fact-check (W3-N):** every new Sync-surface string describes a *manual, user-run local summarize*; nothing
   present-tenses a resident companion; nothing implies file upload. Adversarial whole-document copy review against
   `parse.ts` + `agent-ingest.ts` before the UX PR merges. Update the stale "desktop companion" source comment at
   `src/app/page.tsx:68-70` in passing. Verify the DPIA's "automated sentinel test suite" claim maps to the shipped
   privacy tests (`packages/revealyst-agent/tests/privacy.test.ts`) — if coverage is thinner than the claim, fix the
   test, not the claim.

**Rejected/deferred surfaces (unchanged from research):** raw upload — categorically out; browser-FSA — deferred,
never without CSP+SRI, per-session grants, cookie-authed sibling route + ADR (R9); `revealyst://` deep link — deferred
with the opaque-verb constraint (R10).

## 8. Configuration

- **CLI:** `REVEALYST_TOKEN` (new, ephemeral fallback), `REVEALYST_API` [assumption: name to be confirmed against
  `login --api` handling in PR1 — the flag exists (`cli.ts:45-72`); an env twin is optional, not required],
  `CLAUDE_CONFIG_DIR` (existing). Config file `~/.revealyst/agent.json`, 0o600, unchanged. `--days` stays bounded
  1–90 (`cli.ts:83-85`) — safe post-Fix-1 because the clamp makes wide lookbacks harmless.
- **App:** `src/lib/agent-sync.ts` constants — `AGENT_PACKAGE` (name+pinned version), command-string builders,
  `SYNC_STALE_AFTER_DAYS = 14`. Pure module, importable by public pages (the `entitlements.ts:11` pattern). The
  release process bumps the pinned version alongside `packages/revealyst-agent/package.json` [assumption A6 tightening;
  the CLI package stays deliberately un-imported by the app — its `types.ts` mirror rule].
- **CI/CD:** new `NPM_TOKEN` repo secret (founder action); release workflow is `workflow_dispatch` and skips
  gracefully when the secret is absent (mirrors `ci.yml`'s Cloudflare-creds skip pattern so forks stay green). No
  wrangler.jsonc changes (no new queues/bindings — `POLL_QUEUE` producer already bound).

## 9. Error handling

- **CLI:** zero-events-in-window → explicit abort message, exit without network call (the R2 worst case). Unreadable/
  oversized lines → counted, surfaced via the existing skipped-line honesty accounting, never fatal. Missing token →
  actionable message naming both `login` and `REVEALYST_TOKEN`. `--dry-run` remains the inspect-before-send path.
- **Ingest route:** unchanged taxonomy — 401 (all auth-shaped failures collapse to one message), 400 (shape/window/dim),
  403 (paused), 413 (>10 MB). The recompute enqueue is fire-and-forget: a queue failure logs a warning and **never**
  turns a committed ingest into a 5xx (`run.ts:120-135` precedent).
- **Recompute consumer:** existing retry + DLQ semantics (`wrangler.jsonc:62-90`) apply untouched; duplicate messages
  are idempotent by the frozen upsert key.
- **UI:** badge `error` state with tooltip already handles `last_error`; the Sync card surfaces mint failures inline
  (existing `error` state in the wizard flow); rotate gets a confirm affordance ("regenerating invalidates the old
  token") to prevent accidental agent-bricking.

## 10. Testing & validation

| Test | File | What it locks |
|---|---|---|
| Window pinning regression | `tests/agent-cli-contract.test.ts` (extend) | Lookback **wider than surviving logs** restates only surviving days (a 30/30-default gap passes vacuously — the research's own warning); clamped `batch.window` == summarize window |
| Zero-events abort | `tests/agent-cli-contract.test.ts` or package test | No batch built, no push attempted, when no events fall in the window |
| Env-token fallback | package `config`/`cli` tests | `REVEALYST_TOKEN` honored, not persisted, malformed shape rejected |
| Streaming parity | package `parse`/`summarize` tests | Streamed parse ≡ string parse on fixtures; skipped-line accounting preserved; string-based `buildIngestRequest(sessionContents)` signature kept intact (the frozen-seam test at `tests/agent-cli-contract.test.ts:32-59` depends on it) |
| Recompute enqueue | `tests/agent-ingest.test.ts` (extend) | `deps.send` called once with `{kind:"score-recompute", orgId, day}` on success-with-rows; **not** called on validation failure, auth failure, or zero-row ingest; ingest still succeeds when `send` throws |
| Badge threshold | `src/components/sync-status-badge.test.tsx` (new; pattern: `scores/score-meter.test.tsx`, `// @vitest-environment jsdom`) | Stale state at threshold+; normal "Synced" under threshold; **no-threshold callers unchanged** (polled-connector regression guard) |
| Token lifecycle locks | `tests/agent-ingest.test.ts` (extend, cheap) | Rotated token's old secret 401s; paused connection 403s (already coded — lock the behavior) |
| Copy fact-check | review step, not code | W3-N adversarial pass over all new Sync-surface prose vs `parse.ts`/`agent-ingest.ts` |

Existing suites that must stay green untouched: `tests/tenant-isolation.test.ts` (incl. completeness tripwire),
`tests/account-deletion.test.ts` (no new tables), `tests/contracts/**`, `scripts/check-org-scope.mjs`, the
`frozen-contracts` CI job (no ADR needed — verify the diff never brushes a frozen path).

Manual validation (per repo norms — `next dev` against `npm run dev:db`; note the PGlite prepared-statement limitation
means authenticated app-shell flows are unit-tested, not driven): CLI dry-run against fixtures; a real
`login`+`sync` against a dev deployment for the end-to-end "click Sync → badge flips → score updates
post-recompute" payoff.

## 11. Rollout strategy

Order is dictated by two live hazards (broken copy R6; open npm squat window R7):

1. **PR1 (CLI correctness) merges first** — everything after it publishes/points at a correct CLI.
2. **Merge PR4, then claim the npm name immediately** (PR4 creates the release workflow; founder: create `NPM_TOKEN`
   secret; run the workflow once). The name must exist before any additional UI prints `npx revealyst-agent`.
3. **PR2 (recompute)** — server-only, invisible, safe any time; ship before the UI so the first user-visible Sync
   click already has its payoff.
4. **PR3 (UX)** — Connections Sync card + wizard copy fix + staleness badge/banner land together (the copy references
   the published, version-pinned package from step 2).
5. **Deploy** via the existing manual `Deploy` workflow; verify on prod: mint → `login`+`sync` from a real machine →
   badge flips → score visible after recompute; `curl` the ingest route for the 401/413 taxonomy unchanged.
6. **Instrument, then decide Phase 3**: watch `last_success_at` cadence distribution for a few weeks; the resident
   agent go/no-go (Phase 3) is made on that data (research §6 fast-follow ladder), not on intuition.

No feature flag needed: every change is either strictly-better client behavior, an invisible server enqueue, or new
UI on a page that previously showed nothing for the local agent. Rollback = revert the UI PR; the CLI is
version-pinned in copy so a bad publish is contained by pinning to the prior version.

## 12. Risks & dependencies

Inherited from research §5 (R1–R10 stand); new/raised by this plan's evidence pass:

| # | Risk | Mitigation |
|---|---|---|
| P1 | **Skip-unchanged-files is unsafe as scoped in research item 4** — skipping files while declaring the full window makes delete-then-upsert erase the skipped days (found by the CLI stream). | **[decision]** Dropped from MVP entirely (research already hedged "if trivial" — it is not). Fast-follow only with per-changed-day window narrowing; never against a full-window restatement. |
| P2 | Package-name fork (`revealyst-agent` vs `@revealyst/agent`) breaks `npx` copy if unreconciled (research §6.7 self-inconsistency). | One name, decided in the publish PR, aligned across package.json/bin/README/wizard/Sync card + pinned constant. Default: unscoped (matches everything shipped); founder may flip pre-publish. |
| P3 | Local-agent honesty gaps silently dropped today (no `connector_runs` sink) — Phase 2 is mis-sized as "enum add" without this. | Phase-2 ADR scoped to include the gap sink; documented in §5. |
| P4 | Recompute cost amplification via non-expiring leaked token once Fix 2 lands. | Wrote-rows guard (PR2); min-interval + `expiresAt` fast-follows (§7.4). |
| P5 | CSRF cover for the mint route is assumed, not verified (A7). | Explicit verification (or Origin check) inside PR3's checklist — blocking for that PR. |
| P6 | `cli.ts` has **zero test coverage** today and every PR1 change lands there. | PR1 extracts logic into testable helpers (streaming reader, token resolution) and adds the §10 tests; the seam test keeps covering the composition root. |
| P7 | Cache-warm `npx` lags the latest parser (A6). | Version-pinned copy from the shared constant, bumped by the release process. |

**Dependencies:** founder actions — `NPM_TOKEN` secret + npm account 2FA (blocking step 2 of rollout; PRs 1/3 can
merge without it), sign-off on the package-name decision. No external API, vendor, or infra dependencies; no
migrations; no new Cloudflare resources.

## 13. Phased implementation (PR-sized tasks)

**Phase 1 — one PR chain, ~3 engineer-days (research A1), no ADR.** Each PR independently mergeable, reviewed
(`/code-review` + fixes applied) **before** `gh pr create` per the merge-race rule.

| PR | Contents | Tests | Est. |
|---|---|---|---|
| **PR1 — CLI correctness** (`packages/revealyst-agent` + `tests/`) | Fix 1 window pinning (event-day clamp in `buildIngestRequest`, clamped window into both summarize + `batch.window`); zero-events abort; `REVEALYST_TOKEN` ephemeral fallback; streaming line reader (extract per-line parse; keep string wrapper); README copy alignment | Pinning regression (lookback > surviving logs), abort, env-token, streaming parity | 1 d |
| **PR2 — recompute enqueue** (`src/lib/agent-ingest.ts`, ingest route) | Injected `deps.send`; post-commit best-effort enqueue `{kind:"score-recompute", orgId, day: previousDay(todayUTC)}`; wrote-rows guard; route supplies `POLL_QUEUE` from runtime env | `agent-ingest.test.ts` extensions (§10) | 0.5 d |
| **PR3 — Sync surface + staleness UX** (`src/components/**`, connections + dashboard pages, `src/lib/agent-sync.ts`) | Extract `AgentConnectCard` → shared Sync card on Connections page (mint/rotate + confirm, copy button, two-command first-run block, repeat-run line, `--dry-run` affordance, last-synced); wizard uses the card + fixed copy; `SyncStatusBadge` `staleAfterDays` opt-in prop; `SyncStalenessBanner` in both dashboard views (Alert primitive, amber via className — no `warning` variant exists; Base UI `render={...}` conventions; `ring-*` not `border-*` on Card); shared constants module; `page.tsx:68-70` comment update; A7 CSRF verification | Badge-threshold component test (+ no-prop regression case); W3-N copy fact-check | 1 d |
| **PR4 — npm publish** (`packages/revealyst-agent/package.json`, `.github/workflows/release-agent.yml`) | Drop `private:true`; add `engines` (Node ≥20 — global `fetch`), `license`, `repository`, publish config; `workflow_dispatch` release with `--provenance`, `id-token: write`, `NPM_TOKEN`-gated with graceful skip; version-pin constant wired into `agent-sync.ts` | CI dry-run of the workflow (skip path); `npm pack` sanity | 0.5 d |

Sequencing: PR1 → PR2 and PR4 in parallel → npm name claimed → PR3 last (its copy pins the published version).
PR3 may precede PR4's *publish execution* only if its copy ships behind the same "package not yet published" state as
today's wizard — simpler to hold PR3 until the name resolves.

**Phase 2 — honesty ADR (separate PR + ADR):** `sync_window_incomplete` kind across the three mirrored surfaces
(§6) **plus the local-agent gap sink** (`agent-ingest` writes a `connector_runs` row via `dedupeGaps`, un-dropping
`body.gaps` generally) and dashboard rendering through the existing `collectGaps` readers. Check `ls docs/decisions/`
for the next free ADR number at PR time — and re-check after final sync to main (numbering-collision lesson).

**Phase 3 — resident agent (demand-gated re-decision):** only if measured `last_success_at` cadence shows real
data loss vs the ½·retention rule. Re-attaches the §5.6 thin-collector inversion and its gate-1d ADR from the
2026-07-09 doc; wraps the Phase-1 pipeline unchanged (watcher/scheduler/tray around `sync`).

---

## Appendix — separation of evidence

- **Findings** (code-verified, cited file:line throughout): everything not otherwise marked.
- **Assumptions**: research A1–A8 carry over unchanged; plus [assumption] markers above (`REVEALYST_API` env twin,
  release-bumps-constant process, 14-day threshold's dependence on upstream `cleanupPeriodDays`).
- **Decisions** (deviations or choices the research left open, each marked [decision] in place): event-day pin over
  mtime; zero-events abort; two-command copy + ephemeral env fallback (both sides aligned); injected `send` over
  widening `getApiContext`; unscoped npm name (founder-flippable pre-publish); skip-unchanged dropped from MVP;
  wrote-rows recompute guard.
