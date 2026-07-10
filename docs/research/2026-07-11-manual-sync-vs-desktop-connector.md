# Manual Sync vs. Desktop Connector — Integration Architecture Evaluation

**Date:** 2026-07-11 · **Author:** Integration architecture (AI-assisted; eight parallel single-ownership evidence streams: architecture, telemetry, desktop/browser capability research, UX, security & privacy, platform, performance, implementation) · **Status:** Research → recommendation. Evaluates whether the desktop collector approved in [2026-07-09-desktop-collector.md](2026-07-09-desktop-collector.md) (§5.5 sub-case (C), §5.6 thin-collector directive) can be replaced by an on-demand **Manual Sync** initiated from the Revealyst app, eliminating the continuously-running desktop connector.

**Question:** Can a user-initiated "Sync now" from app.revealyst.com replace the resident background collector — and if so, what telemetry is lost, what is the preferred architecture, and what should ship?

---

## 0. Executive summary

**Verdict: yes — Manual Sync is viable, and it should replace the resident desktop connector as the shipping plan.** The decisive fact is that Revealyst already owns ~90% of a manual-sync product: the shipped `revealyst-agent` CLI's `sync` command *is* an on-demand, stateless, idempotent manual sync against the frozen `POST /api/agent/ingest` contract. Wrapping it in a first-class in-app "Sync" flow is roughly **3 engineer-days with zero frozen-contract changes** for the Personal plan. The resident agent (4–6 engineer-weeks plus signing/distribution/auto-update) is demoted from "build next" to a **demand-gated retention upsell**, and — because the CLI-on-demand variant is a strict subset of the resident agent (the daemon would re-invoke the same pipeline, token, and push path) — this decision is fully reversible with no throwaway work.

**The one real loss is continuous history.** Claude Code prunes local logs (`cleanupPeriodDays`, default 30 days, deleted at startup); a user who doesn't sync inside the retention window permanently loses those days. That was the resident agent's headline advantage (prior doc, F2 last row), and Manual Sync forfeits it in exchange for: the smallest security surface of any variant (§4 of the security stream: on-demand signed-binary run, no always-on process, no standing browser grant), the strongest consent artifact (every upload is an affirmative user act), zero distribution burden today (`npx`, no code-signing fleet), a *better* format-treadmill story than residency (each sync runs a freshly-resolved parser — no stale-binary wrong-numbers risk, which defers the §5.6 event-schema inversion entirely), and the cheapest build by an order of magnitude.

**Three defects must be fixed for Manual Sync to be honest and safe** (all found by inspecting the shipped code, all client- or route-level, none contract-breaking):

1. **Window pinning.** The ingest is delete-then-upsert, authoritative for its declared window. The CLI declares a fixed `--days` lookback — so whenever the requested lookback **exceeds local log retention** (`--days 90` against the 30-day default, or a user-lowered `cleanupPeriodDays`), the sync *deletes previously-captured days whose logs are already pruned* and upserts nothing in their place. At the default 30/30 config an ordinary gap is safe — a day leaves the trailing window no later than its log is pruned — but the CLI accepts up to `--days 90` today with no guard. The client must pin `window.start` to the earliest surviving log day.
2. **Staleness honesty.** An unsynced week currently renders as a measured-zero week (invariant-(b) conflation of "not synced" with "didn't use AI"), and no UI surface warns: `SyncStatusBadge` has no staleness threshold and the dashboard has no "data as of" banner. Ship the staleness UX with the MVP; add a `sync_window_incomplete` honesty-gap kind as an ADR-gated fast-follow.
3. **Score latency.** The agent-ingest route never enqueues a score recompute (only the nightly cron and connector polls do), so the "click Sync → watch your score" payoff is delayed up to ~24h. Wire the recompute enqueue into the ingest path.

Of the three manual-sync mechanisms evaluated, **on-demand CLI (c) wins**; browser File System Access (a) is technically possible (`~/.claude` is verifiably *not* on Chromium's blocklist) but is Chromium-desktop-only and a genuine security downgrade (a persistent browser grant to a prompt-laden directory outlives the network-delivered code that requested it, and the app currently ships **no CSP**); raw folder upload (b) is **categorically rejected** — raw JSONL contains full prompt content, so uploading it breaks the rule-7 tripwire, ADR 0002's by-shape guarantee, and the "No prompt content. Ever." landing/DPIA claims regardless of how fast the server strips it. The org-owned **OTel receiver channel is unaffected** by this entire decision (it is vendor config, not a desktop app).

---

## 1. Feasibility assessment

Findings below are grounded in repo evidence (file:line) or cited web sources; assumptions are collected in §8.

### 1.1 The baseline is already manual

- The frozen ingest contract is transport-agnostic: Bearer device token `rva1.<orgId>.<connectionId>.<secret>`, body = `agentIngestRequestSchema` (subjects, metric records, sub-daily signals, honesty gaps — no field can carry content) (`src/contracts/api.ts:115-128`, `src/lib/agent-ingest.ts:51-100`, ADR 0002). Nothing cares whether the caller is a CLI, a browser, or a helper.
- Writes are transactional delete-then-upsert within the declared window — "a push is authoritative for its window" (`src/lib/agent-ingest.ts:144-209`). The natural PK `(org, subject, metricKey, day, dim)` makes re-syncs idempotent. **Consequence: no sync cursor is needed.** Any manual sync simply re-summarizes and restates a trailing window; "what's new since last time?" is a non-question.
- The shipped CLI (`packages/revealyst-agent/src/cli.ts:74-145`: `sync [--days 30] [--dry-run]`) is run-on-demand and stateless. The onboarding wizard already mints a device token and prints a run command (`src/components/onboarding-wizard.tsx:279-417`). Manual Sync as a product is a packaging problem, not an engineering program.
- The content-stripping privacy line already lives on-device, exactly where §5.6 requires it: `parse.ts:1-12` ("THE PRIVACY LINE LIVES HERE") — allowlist reader, denylisted content/paths/titles never read, `sanitizeModel` charset+length clamp, with the server's `dim` bound (≤128 chars, space/control chars rejected, `agent-ingest.ts:132-141`) as the second line.

### 1.2 Mechanism verdicts

**(a) Browser File System Access API — feasible, deferred.** Verified from Chromium source: the FSA blocklist blocks the home-directory *root* (`kDontBlockChildren`) and fully blocks `.ssh`/`.gnupg`, but **`~/.claude` is not blocklisted** — a user can grant it, and Chrome 122+ persistent permissions let the stored directory handle survive across visits (with a lightweight re-confirmation prompt on return). But: the picker APIs exist **only in desktop Chromium** — no Firefox, no Safari, no mobile (~27% global availability); OS pickers hide dot-folders by default (macOS needs Cmd+Shift+. per dialog); and the security stream's analysis is a downgrade verdict — the projection code is re-fetched from the web origin on every load, so any XSS/bundle compromise inherits a live pre-authorized read handle to a directory full of raw prompts, and the repo currently has **no Content-Security-Policy at all** (zero grep hits). Ship-gates if ever pursued: strict CSP + SRI, never request persistent permission, session-cookie auth with CSRF defense (a new route contract → ADR). Its FSA discovery layer is also throwaway if residency is built later.

**(b) Raw folder upload / drag-drop — categorically rejected.** `~/.claude/projects/*.jsonl` holds full plaintext transcripts. Uploading raw logs — even with immediate server-side stripping — simultaneously (i) trips the rule-7 no-prompt-content tripwire, (ii) structurally defeats ADR 0002's guarantee that the ingest *shape cannot carry* content, (iii) falsifies "No prompt content. Ever." (`src/app/page.tsx:145,265`), the compliance page's "hard architectural guarantee" (`src/app/(app)/compliance/page.tsx:37`), and the DPIA's "summarizes Claude Code logs locally" (`docs/compliance/dpia-template.md:49`), and (iv) creates a prompt-content breach surface across TLS ingress, edge logs, queues, and `raw_payloads`. A further trap verified in the research stream: `webkitdirectory`/drag-drop uploads include hidden files under the picked tree even when the picker UI doesn't display them — a user who picks their home directory to reach `.claude` uploads *everything*. If projection runs client-side first, this collapses into (a) minus persistence. Not a close call; out.

**(c) On-demand CLI, surfaced by an in-app Sync flow — feasible, recommended.** Exists end-to-end today. Safest surface of the three (same signed-binary trust class as the resident agent, *minus* persistence). Handles the multi-directory discovery (`~/.config/claude`, `CLAUDE_CONFIG_DIR`) that browser pickers can't. Optional later convenience: a `revealyst://sync` protocol handler behind the web button — feasible on all three OSes, but Chrome prompts on **every** launch (no per-origin "always allow" since Chrome 77) and the URI is an argument-injection surface (accept only an opaque allowlisted verb, never forward URI components as flags).

### 1.3 Known defects in the current path (found by this evaluation)

- **Broken onboarding copy (live bug):** `onboarding-wizard.tsx:372` tells users to run `REVEALYST_TOKEN=… npx revealyst-agent sync`, but `sync` reads its token only from the `login`-written config (`cli.ts:88`, `config.ts:34-53`) — users following the copy hit "not logged in".
- **Whole-file reads crash on pathological logs:** `cli.ts:104` `readFileSync(…, "utf8")` materializes one string; V8's ~0.5 GB string ceiling means the documented multi-GB session files (claude-code#18905, #22365) throw before parsing. Needs a streaming line reader.
- **`--days` bounds aggregation, not I/O:** `window.ts:6` + `summarize.ts:117` filter *after* parsing everything on disk; `discover.ts:69` already collects `sizeBytes`/`mtimeMs` per file but `sync` never skips unchanged files. Fine at typical volumes, wasteful at heavy ones.
- **No score-recompute after ingest:** recompute is enqueued only by the nightly cron (`src/worker.ts:157`) and connector polls (`src/poller/run.ts:108-124`) — never by `POST /api/agent/ingest`.
- **The package isn't published:** `packages/revealyst-agent` is `private: true`; `npx revealyst-agent` cannot resolve today.

---

## 2. Telemetry & capability impact matrix

What Manual Sync changes relative to the resident collector. "Within window" = days whose logs still exist locally at sync time.

| Telemetry / capability | Under Manual Sync | Why |
|---|---|---|
| Per-model tokens (`model_tokens`/`model_requests`) | **UNCHANGED** within window | Same summarizer over the same logs |
| `spend_cents_estimated` | **UNCHANGED** | Same list-price estimate (`summarize.ts`) |
| Sessions, prompts, `active_day` | **UNCHANGED** within window | Same distinct-session / row derivation |
| Sub-daily 24-slot histogram | **DEGRADED** | Present for synced days; gap days have no row (honest absence) |
| Peak concurrency | **DEGRADED** | Same: correct where synced, missing in holes |
| Retries | **UNCHANGED (still absent)** | Never emitted by the local path; OTel-only |
| True edit accept/reject | **UNCHANGED (still absent)** | OTel `tool_decision` only; not on the local path in either plan |
| Real active time | **UNCHANGED (still absent)** | OTel-only; local proxy not emitted today |
| **Continuous history past log retention** | **LOST** | The resident agent's sole unique advantage; gaps > `cleanupPeriodDays` are permanent holes |
| Freshness | **DEGRADED** | Data is as stale as the last click; resident ≈ continuous |
| Shared-account signals (histograms feeding W2-K) | **DEGRADED** | Holey histograms; limited Team exposure under §5(C) self-view-only |
| Benchmark corpus contribution | **DEGRADED** | Sparser, staler subject-days; still contributes |
| Consent artifact quality | **IMPROVED** | Every upload is an affirmative act (WP29 standard); `--dry-run` = inspect-before-send |
| Security surface | **IMPROVED** | No always-on process, no autostart/tray/service, no fleet auto-update channel |
| Parser freshness (treadmill) | **IMPROVED** | Each sync resolves the latest published parser; no stale-binary wrong-numbers mode |
| No-install ingestion from an arbitrary machine | **NEWLY ENABLED (marginal, deferred)** | Only via the browser-FSA variant, within its retention window |

**Cadence math (finding):** completeness requires syncing at least once per `min(cleanupPeriodDays)` across the user's machines — and pruning fires at Claude Code startup, so a safe rule is cadence ≤ ½ retention. Default settings → sync at least fortnightly-to-monthly; a user who set `cleanupPeriodDays: 7` needs weekly; transcripts-disabled machines are uncoverable at any cadence.

**Scoring impact (finding):** the ratio components that need `suggestions_*`/`spend_cents` are *already* gap-omitted for local-only orgs (the local path never emits them — `suggestions_*` is an OTel capability, `spend_cents` is vendor billing-API data; the local path emits only `spend_cents_estimated`), so Manual Sync changes nothing there. The exposure is plain metrics: absence floors to 0 by design (`tests/scoring-evaluate.test.ts` honesty rules), so an unsynced week scores as a measured-zero week. Mitigations: the staleness banner (MVP) and a `sync_window_incomplete` honesty-gap kind (fast-follow ADR; `HonestyGap` lives in frozen `src/contracts/connector.ts:24-33`).

**OTel channel:** unaffected in both directions, confirmed. Team-visible fidelity data (accept/reject, retries, active time) was never on the local path and does not enter this trade.

---

## 3. Trade-offs across the evaluation dimensions

| Dimension | Desktop connector (resident) | Manual Sync (CLI-on-demand, recommended variant) |
|---|---|---|
| **Technical feasibility** | Buildable; 4–6 eng-weeks + signing/update pipeline | **Ships in days** — ~90% exists; zero frozen-contract changes for Personal |
| **Accessible data sources** | `~/.claude` (+ `~/.codex`, Gemini CLI, opencode later), continuously | Identical sources, snapshot-at-click, bounded by log retention |
| **Platform limitations** | Per-OS service/autostart/tray work; Win/macOS/Linux parity effort | None beyond Node ≥ npx; browser-FSA variant would be Chromium-desktop-only |
| **User experience** | Invisible day-2; best data completeness; install friction up front | Low onboarding friction (wizard exists); ongoing memory burden; staleness must be surfaced honestly |
| **Security & privacy** | Signed binary, stable code boundary; always-on process to defend | **Smallest surface**: no persistence, no listener, no standing grant; stripping stays on-device |
| **Permissions** | No macOS TCC prompt for `~/.claude` (home dot-dirs unprotected); OS autostart approval | None at all for the CLI; FSA variant needs per-visit browser grants |
| **Reliability** | Silent-daemon-death mode needs health signals | No daemon to die; reliability risk shifts to *human cadence* (permanent data holes) |
| **Performance** | Small frequent pushes; never near platform limits | ~50 KB aggregate payload, ~9-10 DB round trips (~5-7 s at the measured ~500-670 ms/RT floor); typical heavy-user first sync ≈ 5-10 s client-side parse; multi-GB pathological files need the streaming fix |
| **Maintenance** | **Worst treadmill story**: JSONL/pricing churn requires fleet binary updates; stale agents silently emit wrong numbers (invariant-b risk §5.6 exists to kill) | **Best treadmill story**: fresh parser per sync; §5.6 event-schema inversion deferrable until residency actually builds |
| **Distribution** | Code-signing (~$250–1,000/yr), notarization, auto-update channel, per-OS installers | `npm publish` (net-new but trivial); no signing for `npx` |
| **Long-term scalability** | Scales to "always complete" data; required for users who won't sync | Scales fine on the platform side (today's synchronous ingest is adequate at aggregate payloads; the 202-accept + queue-normalize + per-day-chunk design is the documented upgrade path if/when event-level payloads arrive); does **not** scale past human forgetfulness |

**Platform note (finding):** today's agent-ingest path is fully synchronous — no queue (`src/app/api/agent/ingest/route.ts:24-30`, 10 MB self-imposed body cap). At the current *aggregate* payload (~50 KB per 30 days) this is comfortably inside every Cloudflare limit. The risks the prior doc flagged (Workers body limits, queue sizing) bind only the hypothetical event-level schema (~500× larger payloads, est. ~24 MB/30 days), where the binding ceiling is Hyperdrive's 60 s statement kill on an un-chunked burst, and where two window-semantics traps apply: N chunks sharing one wide window clobber each other under delete-then-upsert (rule: one chunk = one UTC day = its own window), and queue messages must carry `raw_payloads` pointers, never events (128 KB message cap). All deferred along with the event schema.

---

## 4. Recommended architecture

**Shape: keep the thick client, on demand.** Manual Sync deliberately does *not* adopt the §5.6 thin-collector event inversion yet. The inversion exists to fix the stale-resident-binary problem; a manual sync has no stale binary (each `npx` run resolves the latest published parser — see assumption A6). Deferring it means: no event-level ingest schema, no server-side sessionizer/pricer, no `raw_payloads` replay job, no gate-1d ADR — the frozen aggregate contract carries the whole MVP. The §5.6 directive is *not* overturned: it re-attaches the moment a resident agent ships, and the prior doc's design for it stands.

**Data flow (unchanged from today, plus two fixes):**

```
User clicks "Sync" in app.revealyst.com (Connections page)
  → page shows copy-paste command (token minted via existing
    POST /api/connections/:id/agent-token)
  → user runs: npx revealyst-agent sync          [--dry-run to inspect first]
      discover (~/.claude, ~/.config/claude, CLAUDE_CONFIG_DIR)
      → stream-parse JSONL, allowlist-project (content never leaves device)
      → summarize to metric rows + subject_day_signals
      → window.start = max(requested lookback, earliest surviving log day)   ← FIX 1
      → POST /api/agent/ingest (Bearer device token)
  → server: validate shape → raw_payloads insert → delete-then-upsert
    within declared window → mark synced
    → enqueue score-recompute for the org                                    ← FIX 2
  → UI polls existing connection status; SyncStatusBadge flips to
    "Synced just now"; dashboard banner shows data-as-of
```

**Authentication:** unchanged — device tokens for the CLI (headless, bearer-only, CSRF-immune by construction, timing-safe compare). If the browser-FSA variant is ever built, it must use the **session cookie** on a new session-authed ingest sibling route (immediate revocation, no long-lived secret in browser-reachable storage) with explicit Origin/CSRF verification — a new route contract requiring an ADR. Never mint device tokens into browser storage.

**Sync protocol:** full-window restatement, no cursor. Idempotent under retry by the natural PK. Window pinned to earliest-surviving-log (Fix 1) so a post-gap sync can never destroy previously-captured history. Incremental speed-up (skip files whose `{path, size, mtime}` are unchanged) is a pure client optimization, fast-follow.

**User workflow:** Connections page gains a first-class Sync surface for the local agent (today `claude_code_local` renders no `SyncNowButton` — the UI comment says "the local agent pushes, it isn't polled", `connections/page.tsx:88-90`). First run: mint token → copy one command block (`login` + `sync`, fixing the env-var bug). Repeat runs: `npx revealyst-agent sync`. Staleness is surfaced honestly (badge threshold + dashboard banner), and the banner doubles as the resident-agent upsell slot later ("Never see this again — turn on background sync"). Nudge emails are explicitly *not* MVP: no email infra beyond auth exists, and the UX stream's judgment is that nudges relocate the burden rather than remove it.

**Migration path:** nothing migrates — existing device tokens, config files, and CLI behavior are unchanged. The Team-org self-view opt-in (§5.5 gates 1–4 of the prior doc) is untouched by this decision and still gates on its ADR. If demand later justifies residency, the resident agent wraps this exact pipeline (watcher + scheduler + tray around `sync`), inheriting every MVP fix; at that point the §5.6 thin-collector inversion and its gate-1d ADR re-enter scope.

---

## 5. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Human cadence** — users forget; > retention-window gaps are permanent holes | High (the structural cost of this decision) | Honest staleness UX (MVP); measure real cadence via `last_synced_at`; resident-agent upsell is the durable fix; decision reversible |
| R2 | **History self-destruction** — delete-then-upsert wipes captured days whenever the requested lookback exceeds local log retention (`--days 90` at 30-day retention, or lowered `cleanupPeriodDays`; safe at default 30/30) | High if unfixed | Fix 1 (window pinning), MVP-blocking; regression test in the CLI contract suite |
| R3 | **Measured-zero conflation** — unsynced days score as zero-usage days (invariant b) | High | Staleness banner (MVP) + `sync_window_incomplete` honesty-gap kind (fast-follow ADR — frozen `connector.ts`) |
| R4 | **Pathological log files** crash `readFileSync` (multi-GB sessions, documented upstream) | Medium | Streaming line reader (MVP) |
| R5 | **Stale scores after sync** — no recompute enqueue on ingest | Medium (kills the interactive payoff) | Fix 2 (MVP) |
| R6 | **Onboarding copy bug** (`REVEALYST_TOKEN`) already strands users | Medium (live today) | Fix in MVP (env support or two-command block) |
| R7 | **npm supply chain** — publishing `revealyst-agent` creates a package-takeover surface | Medium | 2FA/provenance on publish, CI-only release, pinned instructions can name a version |
| R8 | **Upstream retention changes** — `cleanupPeriodDays` semantics or JSONL fields shift | Medium (existing treadmill) | Already lived-with; manual sync improves propagation of parser fixes |
| R9 | If pursued later: FSA standing grant + no CSP = prompt-content exfil channel on web-app compromise | High (deferred variant) | Don't build (a) without CSP+SRI, per-session grants only, ADR for the cookie-authed route |
| R10 | If pursued later: `revealyst://` argument injection | Medium (deferred) | Opaque allowlisted verb only; never forward URI parts as argv/flags |

---

## 6. MVP scope (~3 engineer-days, Personal plan, zero frozen-contract changes)

1. **Connections-page Sync flow** — evolve `AgentConnectCard` into a reusable Sync surface: mint/rotate token, copy-paste command block, last-synced state. (0.5 d)
2. **Fix the token-env bug** — `sync` honors `REVEALYST_TOKEN`, or the copy emits `login && sync`. (0.5 d)
3. **Window pinning (Fix 1)** — clamp `window.start` to the earliest surviving log day; contract test covering the lookback-exceeds-retention restatement case (note: a default-config 30/30 gap does *not* reproduce the loss — the test must use a lookback wider than the surviving logs, or it passes vacuously). (0.5 d)
4. **Streaming parse** — replace `readFileSync` with a line-stream; skip-unchanged-files via already-collected `sizeBytes`/`mtimeMs` if trivial. (0.5 d)
5. **Score-recompute enqueue (Fix 2)** — ingest route chains the same org-recompute message connector polls use. (0.25 d)
6. **Staleness UX** — `SyncStatusBadge` threshold state + dashboard "data as of your last sync" banner for local-agent-fed orgs. (0.5 d)
7. **Publish `@revealyst/agent` to npm** — CI release with provenance. (0.25 d)
8. **Transparency** — surface `--dry-run` in the Sync page copy as the "inspect what this sends" affordance (gate-4 spirit, no new UI build).

**Fast-follows (post-MVP, in order):** `sync_window_incomplete` honesty-gap ADR → incremental file cursor → `revealyst://sync` deep link (with the R10 constraints) → resident-agent go/no-go **decided on measured sync-cadence data** (if median cadence comfortably beats ½·retention, residency may never be needed for most users).

**Explicitly out of scope:** event-level ingest schema and server-side normalizer (deferred with residency); browser-FSA variant; raw upload (rejected); Team-org self-view opt-in surface (separate track, §5.5 gates); OTel receiver (own track, unaffected).

## 7. Implementation plan

- **Phase 1 (MVP, one PR chain):** items 1–8 above. Only ordinary review applies — no ADR needed: no `src/contracts/**`, `src/db/schema.ts`, or ingest-schema changes; the ingest *route behavior* gains a recompute enqueue (not a contract change, mirrors `connectionsPoll` semantics). Tests: extend `tests/agent-cli-contract.test.ts` (window pinning, env token), `tests/agent-ingest.test.ts` (recompute enqueue), a component test for the badge threshold.
- **Phase 2 (honesty ADR):** `sync_window_incomplete` gap kind — touches three frozen/shared surfaces (`HonestyGap` in `src/contracts/connector.ts:24-33`, `honestyGapSchema` in `src/contracts/api.ts:103-113`, and the agent package's `types.ts` mirror) → ADR + dashboard rendering of the gap.
- **Phase 3 (demand-gated, re-decision):** resident agent per the prior doc's R1-step-1 + §5.6 thin-collector design, *if* cadence telemetry shows real data loss; it wraps Phase 1's pipeline unchanged.
- **Copy discipline (W3-N):** audit user-facing prose when the MVP ships. No landing-page claim currently present-tenses a resident companion (the "desktop companion, not polling" line is a *source comment* at `src/app/page.tsx:68-70`, not user prose) — keep it that way: describe the channel as a manual, user-run sync, and update the comment for accuracy while touching the file.

## 8. Assumptions (explicitly not verified)

- **A1** Effort figures (~3 d MVP; 4–6 wk residency) are synthesized estimates; this team's parallel-agent workflow may compress them.
- **A2** `cleanupPeriodDays` semantics (default 30, startup-triggered deletion) per Claude Code docs and issue tracker; upstream can change them at any time.
- **A3** Volume anchors (heavy user ≈ 8 MB/day JSONL, ~240 MB/30 d; event-schema payload ≈ 24 MB/30 d) are modeled from cited session sizes, not measured on a real corpus; ±3× plausible.
- **A4** Chromium FSA blocklist read from current source (`~/.claude` not listed); the blocklist is unversioned and could add it.
- **A5** Chrome persistent-permission and protocol-handler prompt behaviors verified for Chrome; assumed similar in Edge/Opera.
- **A6** `npx` resolves a recent published version for new users; a warm npx cache can lag — "fresh parser per sync" is directionally true, not a guarantee. Pinning instructions to a minimum version tightens it.
- **A7** Better Auth cookies are SameSite with `trustedOrigins` enforced on POST — must be re-verified before any cookie-authed ingest variant.
- **A8** No customer evidence on sync-cadence discipline exists yet; R1's severity is reasoned, not measured — which is why the MVP instruments it before the residency re-decision.

---

## Appendix — evidence streams

Eight parallel single-ownership streams produced the underlying evidence (full outputs in the session transcript): **architecture** (ingest seam, restatement semantics, code-reuse map), **telemetry** (impact matrix, cadence math, scoring/honesty exposure), **desktop/browser research** (FSA blocklist verification, support matrices, protocol handlers, log-retention facts — web-cited), **UX** (journey comparison, staleness/nudge analysis), **security & privacy** (per-mechanism verdicts, works-council delta, auth), **platform** (Cloudflare limits, burst-ingest design), **performance** (volume/latency budgets, crash modes, score-recompute gap), **implementation** (reuse inventory, MVP scoping, ADR touchpoints). Adversarially fact-checked against the codebase before merge per the W3-N content rule.
