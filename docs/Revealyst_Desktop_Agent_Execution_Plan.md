# Revealyst Desktop Agent — Execution Plan

> **For agentic workers:** execute one task per session (rule 3), in phase
> order, against this plan. Every task's requirements implicitly include §1
> (cross-cutting laws). Tasks carry objective / files / expected output /
> dependencies / tests / completion criteria. Read the
> [technical spec](product/desktop-agent-spec.md) and the
> [gap analysis](product/desktop-agent-gap-analysis.md) before starting any
> task — the spec's §29 hard rules are non-negotiable.
>
> Status: **plan approved for docs; build NOT started.** M0–M1 (repo
> enablement + non-collecting app shell) may proceed at any time; M2+ needs
> D-DA-1. The first shipped binary is gated on **D-DA-1**
> (resident-collector go/no-go) and any Team-org enrollment on **D-DA-2**
> (the Spec V4 §9.4 sub-case-C ADR). See §6.

## 0. Plan-on-a-page

**Goal:** a Tauri 2 cross-platform (macOS 13+/Windows 10 22H2+) background
tray utility that enrolls a device via browser PKCE, collects Claude Code
local signals, computes privacy-preserving analytics features on-device
(Analytics Only — never raw prompt/response text), queues them in an encrypted
local store, and syncs day-aggregate batches to the existing idempotent ingest
pipeline — released independently of the web app with signed, staged updates.

**Architecture:** maximal reuse of the shipped agent stack. The desktop agent
is the resident evolution of `packages/revealyst-agent` (Manual Sync CLI):
same `rva1.` device token, same `AgentIngestRequest` day-aggregate contract,
same `AGENT_COLLECTION_FIELDS` allowlist (bridged to Rust via generated JSON),
same `connector_runs` honesty gaps. New backend surface is thin: PKCE pairing
that mints the existing token, device metadata/heartbeat, signed remote
config, update manifest, diagnostics sink. The Rust core owns collection,
feature extraction, privacy enforcement, the encrypted queue, and sync; the
React UI is a thin shell over narrowly scoped Tauri commands.

**Tech stack:** Tauri 2 (tray, autostart, deep-link, single-instance, updater
plugins) · Rust (tokio, rusqlite+SQLCipher, keyring, reqwest, serde, ed25519
verify) · React + TypeScript + Vite (UI) · existing Next.js/Workers backend.

**Phases:** M0 repo enablement → M1 app foundation → M2 auth + device
identity → M3 privacy-first local pipeline → M4 sync + backend → M5 sources →
M6 updates + release → M7 hardening + rollout. M0–M1 can start immediately;
M2+ needs D-DA-1; Team-org enrollment needs D-DA-2.

## 1. Cross-cutting laws

Every task inherits these. A PR violating one is a review-blocker regardless
of scope.

1. **Spec §29 hard rules, verbatim** (see
   [the spec](product/desktop-agent-spec.md#29-ai-coding-agent-implementation-constraints-hard-rules-verbatim)):
   no browser extensions in Phase 1 · no raw prompt/response upload in the
   default mode · no raw prompt text in the local queue in Analytics Only ·
   no browser cookie/storage/history inspection · no network interception ·
   no screen capture · no keystroke monitoring · no clipboard monitoring · no
   provider-credential collection (Claude, Anthropic, OpenAI, Google, Cursor,
   or any other) · app presence is never proof of productive AI usage · never
   claim complete Claude Desktop coverage · undocumented local formats only
   behind a connector with fixtures + explicit fallback states · remote config
   never broadens collection without explicit authorization · no tokens in
   SQLite or frontend storage · no unrestricted Tauri filesystem/shell
   permissions · no signing secrets in PR workflows · no privileged background
   service in MVP · no final team capability scores computed in the agent ·
   no manager analytics displayed in the agent.
2. **Product constraints preserved:** cross-OS (macOS + Windows, Linux
   deferred) · lightweight (§21 targets) · easy to update (signed Tauri
   updater, staged) · user-friendly (plain-English copy, CLAUDE.md UX
   principles apply to the agent UI too) · **Analytics Only is the default and
   the only implemented mode in Phase 1**.
3. **Allowlist-first claims discipline (W3-N / invariant b):** any field that
   leaves the device is added to `src/lib/agent-collection-schema.ts` FIRST;
   the desktop "what leaves the device" screen, the transparency panel, and
   `/legal/what-we-collect` render from it. Never hand-write a collection
   claim. Allowlist, never blocklist — unknown fields are dropped by shape.
4. **Frozen contracts (rule 1):** new `CANONICAL_METRICS` keys, vendor ids,
   `authKind`/credential kinds, schema/org-scope/fixture changes each need an
   ADR in the same PR. A new org-scoped table needs the THREE registrations
   (tenant-isolation `SCOPED_READS` + non-vacuous B-org seed; ADR;
   `account-deletion.ts` purge registration). ADR and migration numbers are
   independent sequences — re-check `ls docs/decisions/` and `ls drizzle/*.sql`
   at PR time (next expected: ADR 0044, migration 0036).
5. **Repo isolation:** desktop code lives in top-level `desktop-agent/`; it is
   excluded from root `tsc`, root Vitest, and `check-org-scope` sweeps; the
   web app never imports from it and it never imports from `src/` (shared
   contracts cross via generated JSON artifacts checked in under
   `desktop-agent/src-tauri/generated/`). Backend changes live in `src/` as
   normal.
6. **Sequencing law (from W6):** phases whose PRs append to shared files
   (schema, allowlist, scope-claims) serialize their BUILDS, not just merges.
7. **Session mechanics:** verify branch before staging; review + apply fixes
   BEFORE `gh pr create` (merge-race); check CI state explicitly before merge;
   after stack merges verify the tip is an ancestor of `origin/main`.

## 2. Reuse ledger (migrate / reuse / new)

| Layer | Reused as-is | Modified | New |
|---|---|---|---|
| Auth | `agent-token.ts`, envelope credential storage, `paused→403` revocation | `authenticateDeviceToken` extracted to `src/lib/device-token.ts` | PKCE pairing endpoints + one-time-code table; consent screen |
| Devices | `connections` row = device | Settings device list (reads connections) | heartbeat route + per-device metadata columns (ADR) |
| Ingest | `POST /api/agent/ingest`, `AgentIngestRequest`, natural-key idempotency + delete-window, `connector_runs` gaps | allowlist + scope-claims entries for new fields | (Phase 1: nothing — day-aggregates ride the existing pipe) |
| Metrics | all existing `CANONICAL_METRICS` + `subject_day_signals` + OTel markers | — | feature-signal keys (task category etc.) via M5 ADR, gated D-DA-5 |
| Collection logic | CLI `parse/summarize/window/identity` as the executable reference + fixtures | — | Rust port + allowlist JSON bridge + byte-parity contract test |
| Privacy claims | `agent-collection-schema.ts`, `/legal/what-we-collect`, transparency panel, `data-confidence` | new rows/entries | agent-side policy engine, payload validator, quarantine |
| Config/updates | — | — | signed remote config (new Ed25519 key), Tauri update manifest + channels + staged rollout |
| CI/release | `release-agent.yml` as template; `check-adr-numbers`; frozen-contracts guard | root `tsconfig.json` exclude; `.gitignore` | `desktop-ci.yml`, `release-desktop.yml` + protected GitHub Environment |

## 3. Phased milestones & exit criteria

| Phase | Scope (spec §28 mapping) | Exit gate (evidence, founder-judged) |
|---|---|---|
| **M0 — Repo enablement** | tsconfig/gitignore/scaffold, desktop CI skeleton, external approvals fired | Root CI green with `desktop-agent/` present; unsigned build job compiles a hello-tray app on macOS+Windows runners; Apple Developer + Windows cert + GitHub Environment requests filed (rule 5) |
| **M1 — App foundation** | Tauri shell, tray lifecycle, windows, autostart, single-instance, structured logs, strict capabilities + CSP | Tray app runs on both OSes as non-admin; capability audit passes; logs structured + secret-free by construction |
| **M2 — Auth + device identity** | PKCE browser flow, deep link, enrollment, keychain storage, revoke | End-to-end pairing against a preview deploy; §26.4 deep-link/PKCE tests green; revoked device stops syncing (403 path) |
| **M3 — Privacy-first local pipeline** | policy engine, Analytics Only enforcement, extractor (shape+counts), encrypted queue, checkpoints, payload validator, privacy tests | Every §26.1 privacy test green and merge-blocking; proven: raw text never persisted, contradicting flags quarantined |
| **M4 — Sync + backend** | batch upload, retry taxonomy, splitting, heartbeat, signed remote config, diagnostics | §26.2 sync tests green; offline→reconnect→dedup proven against ingest; tampered config rejected, last-valid retained |
| **M5 — Initial sources** | Claude Code connector (validated surfaces), export importer, coverage UI, disclosures; feature-signal ADR | CLI↔Rust fixture parity; importer passes traversal/zip-bomb tests; coverage UI renders from scope-claims; new keys seeded + drift-tested |
| **M6 — Updates + release** | signed updater, manifest endpoint, channels, staged rollout, signing/notarization, halt | Signed update installs on both OSes; tampered manifest rejected; queue survives update; rollout halt demonstrated; PR workflows provably signing-secret-free |
| **M7 — Hardening + rollout** | §21 perf measurement, §26.3 platform matrix, security review, token rotation, internal beta → staged stable | Perf targets measured + recorded; §30 definition-of-done checklist all green; /gate-check-style evidence pack |

Personal-org enrollment ships at M5 exit. **Team-org enrollment ships only
after the sub-case-C ADR (D-DA-2) — regardless of phase progress.**

## 4. Critical path, parallelization, risks

**Critical path:** D-DA-1 sign-off → M2 (pairing endpoints freeze the device
contract) → M3 (privacy pipeline blocks all collection) → M5 → M6 signing
(external certs are the long pole) → M7.

**Fire immediately (rule 5, external, founder):** Apple Developer Program
enrollment + Developer ID cert (notarization lead time) · Windows code-signing
cert (OV/EV decision — EV avoids SmartScreen reputation lag) · GitHub
protected Environment `desktop-release` with required reviewer · Tauri updater
keypair + config-signing keypair generation (offline, stored as Environment
secrets).

**Parallelizable:** M1 (pure desktop) ∥ M2 backend endpoints (pure `src/`) ∥
M0 CI. Within M3–M5, Rust pipeline ∥ backend config/diagnostics endpoints.
Serialize any two tasks that both append to `schema.ts`/allowlist (law 6).

**Top risks:**

1. **Signing/notarization logistics** — external accounts, cert delivery,
   Apple notarytool flakiness. Mitigation: M0 files requests; M6 rehearses on
   internal channel first; unsigned CI builds keep development unblocked.
2. **Tauri 2 platform edges** — deep-link registration on Windows (registry)
   vs macOS (Info.plist/CFBundleURLTypes), tray behavior differences,
   autostart approval UX, WebView2 runtime presence on Win10. Mitigation:
   M1 spike proves all four plugins on both OSes before anything else builds
   on them; §26.3 matrix in CI via OS-matrix runners.
3. **SQLCipher bundling** — static linking per-platform is the classic Tauri
   pain point. Fallback (recorded, honest): OS-encrypted-at-rest file DB +
   application-layer field encryption for payload columns, with the delta
   disclosed in the privacy screen. Decision in T3.2.
4. **Allowlist drift across three surfaces** (app TS ↔ CLI TS ↔ Rust JSON) —
   mitigated by generation from the single TS source + a CI parity test; the
   generated JSON is a build artifact diffed in CI, never hand-edited.
5. **Prompt-feature extraction scope creep** — the extractor is the one place
   prompt-like content is in-process. Mitigation: M3 ships shape+counts only;
   text-reading heuristics are structurally separate (own module, own gate,
   D-DA-5); privacy tests assert the queue/wire never carry text either way.
6. **Repo-shape regressions** — root `tsc` sweep breaking on desktop TS
   (T0.1 exclude), vitest glob pickup, `wrangler versions upload` unaffected
   (no new queue consumers planned). Preview-deploy Hyperdrive 10021 flake is
   pre-existing — rerun, don't debug.
7. **Windows-dev vitest flakes** — known transient worker-exit/pseudonym
   flakes (CLAUDE.md); rerun in isolation before treating as regression.
8. **Better Auth has no OAuth-provider mode** — mitigated by not needing one:
   pairing rides the existing web session + custom authorize/exchange
   endpoints (gap analysis §4); no third-party OAuth server semantics.

## 5. Task specifications

Effort: S ≤ half day · M ≈ 1 day · L ≈ 2–3 days (one agent-session each).

### Phase M0 — Repo enablement

**T0.1 — Root build-config isolation** *(S)*
- **Objective:** make a `desktop-agent/` tree invisible to the web toolchain.
- **Files:** `tsconfig.json` (add `"desktop-agent"` to `exclude`);
  `.gitignore` (add `desktop-agent/src-tauri/target/`, `desktop-agent/dist/`,
  `desktop-agent/node_modules/`).
- **Output:** root `npm run typecheck` + `npm test` byte-identical results
  with an empty `desktop-agent/` scaffold present.
- **Dependencies:** none.
- **Tests:** run `npm run typecheck` and `npm test` with a dummy
  `desktop-agent/src/x.ts` containing web-invalid TS (e.g.
  `import.meta.env`); both must stay green.
- **Completion:** CI `check` job green on the PR; no root config other than
  the two files touched.

**T0.2 — Desktop app scaffold + own toolchain** *(M)*
- **Objective:** `create-tauri-app`-equivalent scaffold: Vite+React+TS
  frontend, `src-tauri` Rust crate, own `package.json` (independent version
  `0.1.0`), own `tsconfig.json` (so the post-edit typecheck hook resolves the
  nearest config), own `vitest.config.ts`.
- **Files:** `desktop-agent/package.json`, `desktop-agent/tsconfig.json`,
  `desktop-agent/vite.config.ts`, `desktop-agent/src/**` (App shell),
  `desktop-agent/src-tauri/{Cargo.toml,tauri.conf.json,src/main.rs,capabilities/default.json}`,
  `desktop-agent/README.md` (dev loop: `npm install && npm run tauri dev`).
- **Output:** `npm run tauri build -- --no-bundle` compiles locally; README
  documents the Windows dev-machine loop.
- **Dependencies:** T0.1.
- **Tests:** one placeholder Rust unit test (`cargo test`) + one Vitest UI
  smoke test run by the desktop config only.
- **Completion:** repo root CI green; `desktop-agent` tests runnable in
  isolation; CSP in `tauri.conf.json` set to the spec §22.3 policy from day
  one.

**T0.3 — Desktop CI workflow** *(M)*
- **Objective:** path-filtered PR checks for the desktop tree, no signing.
- **Files:** `.github/workflows/desktop-ci.yml` (triggers:
  `pull_request: paths: [desktop-agent/**, .github/workflows/desktop-ci.yml]`).
  Jobs: `rust` (fmt --check, clippy -D warnings, cargo test, cargo-deny or
  cargo-audit), `ui` (desktop-scoped tsc + vitest), `build` (matrix
  macos-latest/windows-latest, unsigned `tauri build`), `capability-audit`
  (fail if any Tauri capability file grants `fs:default`-wide, `shell`, or
  remote-domain `connect-src`; simple script check).
- **Output:** all four jobs green on a scaffold-only PR; rust caching
  (`Swatinem/rust-cache`) keeps runtime sane.
- **Dependencies:** T0.2.
- **Tests:** the workflow itself on the PR; intentionally-broken clippy lint
  on a scratch branch to prove the job fails.
- **Completion:** merged with branch protection able to require the new
  checks on `desktop-agent/**` PRs; root `ci.yml` untouched.

**T0.4 — External approvals + protected environment (founder actions)** *(S, founder)*
- **Objective:** file everything with lead time (rule 5).
- **Files:** `docs/approvals.md` (add rows: Apple Developer Program +
  Developer ID Application cert; Windows code-signing cert incl. OV-vs-EV
  recommendation = EV; GitHub Environment `desktop-release` with required
  reviewer; Tauri updater keypair + remote-config Ed25519 keypair stored ONLY
  as Environment secrets).
- **Output:** requests filed; ledger rows tracking status.
- **Dependencies:** none (do first).
- **Tests:** n/a (ledger).
- **Completion:** every row has an owner + date; secrets never appear in repo
  or PR-accessible secrets.

### Phase M1 — App foundation

**T1.1 — Tray lifecycle + single instance + autostart** *(M)*
- **Objective:** background utility skeleton per spec §19.1/§2.1.
- **Files:** `desktop-agent/src-tauri/src/{main.rs,tray.rs,lifecycle.rs}`;
  plugins: `tauri-plugin-single-instance`, `tauri-plugin-autostart` (opt-in
  toggle only — "after user approval"), tray via Tauri core.
- **Output:** tray menu with the spec's items (status line, last sync, Open
  Revealyst, Connection status, Privacy settings, Pause collection, Check for
  updates, Send diagnostics, Quit); windows hidden on close, app lives in
  tray.
- **Dependencies:** T0.2.
- **Tests:** Rust unit tests for menu-state derivation (AgentState → menu
  labels); manual matrix note for tray behavior per OS.
- **Completion:** runs as standard non-admin user on macOS 13 + Windows 10
  22H2; autostart OFF by default, toggled only from settings.

**T1.2 — Window shells + navigation + structured logging** *(M)*
- **Objective:** onboarding/status/privacy/diagnostics window shells (React)
  + `tracing`-based structured logs with a redaction layer.
- **Files:** `desktop-agent/src/{screens/*,components/*}`;
  `desktop-agent/src-tauri/src/logging.rs` (JSON lines, 7-day rotation,
  component/error-code fields; a `Redact` newtype so secrets can't be
  `Display`ed — spec §23.1).
- **Output:** navigable shells with plain-English placeholder copy following
  CLAUDE.md writing principles; log files under the platform data dir.
- **Dependencies:** T1.1.
- **Tests:** Rust test: formatting a `Redact<String>` yields `[redacted]`;
  UI smoke tests per screen.
- **Completion:** warm status-window open < 500 ms on dev hardware (first
  perf gauge, recorded).

**T1.3 — Agent state machine** *(S)*
- **Objective:** spec §20 `AgentState` with fixed precedence.
- **Files:** `desktop-agent/src-tauri/src/state.rs`; TS mirror type in
  `desktop-agent/src/lib/state.ts`.
- **Output:** `resolve_state(inputs) -> AgentState` pure function; tray +
  status screen consume it.
- **Dependencies:** T1.1.
- **Tests:** table-driven Rust tests covering every precedence pair (e.g.
  update_required beats paused; paused beats offline).
- **Completion:** all 10 states reachable in tests; precedence exactly the
  spec order.

### Phase M2 — Auth + device identity

**T2.1 — Backend: extract shared device-token verifier** *(S)*
- **Objective:** dedupe verification before a third caller exists.
- **Files:** new `src/lib/device-token.ts` (move `authenticateDeviceToken` +
  types from `src/lib/otel-receiver.ts`); update imports in
  `src/lib/otel-receiver.ts`; refactor `src/lib/agent-ingest.ts` inline
  verify to call it.
- **Output:** one verifier, three call sites, behavior byte-identical.
- **Dependencies:** none (backend-only; parallel with M1).
- **Tests:** existing otel-receiver + agent-ingest suites stay green
  (they pin 401-before-body and paused→403); add a direct unit test for the
  extracted function.
- **Completion:** `npm test` green; no route behavior change (same
  status codes, same ordering).

**T2.2 — Backend: PKCE pairing endpoints + ADR** *(L)*
- **Objective:** browser-session pairing that mints the existing device
  token (spec §8, gap-analysis §4).
- **Files:** `src/app/api/desktop/auth/start/route.ts` (POST: agent submits
  `code_challenge` (S256) + device metadata `{deviceDisplayName, platform,
  architecture, agentVersion, installationId}`; returns `pairingId` + the
  browser URL); `src/app/(app)/desktop/connect/page.tsx` (session-authed
  consent screen: shows device metadata + org picker for multi-org users;
  approve → one-time code bound to the challenge, redirect to
  `revealyst://desktop-auth/callback?code=…&state=…`);
  `src/app/api/desktop/auth/exchange/route.ts` (POST: `code` +
  `code_verifier`; verifies S256, single-use, ≤10-min TTL; creates the
  device `connections` row (`vendor: "claude_code_local"`,
  `authKind: "device_token"`) + `storeCredential(..., "device_token", ...)`;
  returns the composed `rva1.` token once); new table
  `desktop_pairing_codes` (org-scoped: challenge hash, code hash, consented
  user/org, device metadata, expiry, used_at) — mig 0036 (verify number);
  ADR 0044 (verify number) covering: pairing surface, member-level minting
  authz (member may mint only a self-owned device connection — the
  research-§5.5 gate 1(c) authz change), device-metadata columns on `connections` or
  the pairing table, deep-link scheme registration.
- **Output:** working pairing against `npm run dev:db`; the three
  registrations for the new table (tenant-isolation SCOPED_READS + B-org
  seed, ADR, account-deletion purge entry).
- **Dependencies:** T2.1; **serializes with any other schema-touching PR**
  (law 6). D-DA-1 must be signed before this merges (first
  product-behavior PR).
- **Tests:** route tests: S256 mismatch → 400; code reuse → 400; expired →
  400; cross-org code → 404; member minting a device for another user →
  403; token returned exactly once; frozen-contracts guard satisfied by the
  ADR in the same PR; tenant-isolation + account-deletion suites green.
- **Completion:** full PKCE dance executable with curl (documented in the
  ADR); audit-log rows written on consent + exchange.

**T2.3 — Agent: PKCE client + deep link + keychain storage** *(L)*
- **Objective:** spec §8 client side.
- **Files:** `desktop-agent/src-tauri/src/{auth.rs,deeplink.rs,secrets.rs}`;
  `tauri-plugin-deep-link` registration for `revealyst://`; `keyring` crate
  (macOS Keychain / Windows Credential Manager); onboarding Sign-in screen
  wiring.
- **Output:** verifier/state/nonce generation → system browser open →
  callback validation (state match, single fire, source path
  `desktop-auth/callback` only) → exchange → token in OS keychain; **token
  never touches SQLite, config files, logs, or the frontend** (Tauri command
  returns only a boolean).
- **Dependencies:** T2.2, T1.2.
- **Tests:** Rust: state-mismatch rejected; replayed callback ignored;
  malformed deep-link URL rejected (spec §26.4 items 1–2); secrets module
  round-trip behind a mock keyring in CI.
- **Completion:** end-to-end pairing against a preview deploy on both OSes;
  keychain entry visible in OS tooling; frontend cannot read the token.

**T2.4 — Devices in Settings + revoke + heartbeat** *(M)*
- **Objective:** spec §24.2 device management on existing machinery.
- **Files:** `src/app/(app)/settings/devices/page.tsx` (list this user's
  device connections: name, platform, agent version, last heartbeat, enrolled
  date; rename; revoke = pause connection + delete device_token credential);
  `src/app/api/desktop/heartbeat/route.ts` (device-token-authed POST
  `{agentVersion, queueDepth}` → updates heartbeat timestamp; counts only);
  nav entry under Settings.
- **Output:** revoked device's next sync/heartbeat gets 403 and the agent
  transitions to `authentication_required`.
- **Dependencies:** T2.2 (device rows exist), T2.1 (verifier).
- **Tests:** route tests: revoke stops ingest (403); rename persists;
  member sees only own devices, admin sees org devices count-only unless
  self (self-view discipline); heartbeat rejects non-numeric payloads.
- **Completion:** §27.4 "revoking one device does not affect others" proven
  in a test with two device connections.

### Phase M3 — Privacy-first local pipeline

**T3.1 — Allowlist bridge (TS → Rust)** *(M)*
- **Objective:** one source of truth for "what leaves the device" across
  app/CLI/desktop (law 3).
- **Files:** `scripts/generate-agent-allowlist-json.mjs` (emits
  `desktop-agent/src-tauri/generated/allowlist.json` from
  `src/lib/agent-collection-schema.ts`); `desktop-agent/src-tauri/src/allowlist.rs`
  (loads at compile time via `include_str!`, typed);
  extend `tests/agent-cli-contract.test.ts` (or sibling test) to assert the
  checked-in JSON matches a fresh generation (drift test).
- **Output:** Rust code can only reference allowlisted fields through this
  module; the generated file is a reviewed, checked-in artifact.
- **Dependencies:** T0.2.
- **Tests:** the drift test (fails if TS changed without regeneration);
  Rust test that a non-allowlisted field name is rejected by the projector.
- **Completion:** CI fails on manual JSON edits; generation documented in
  `desktop-agent/README.md`.

**T3.2 — Encrypted local store + queue** *(L)*
- **Objective:** spec §13 storage with the queue-before-checkpoint rule.
- **Files:** `desktop-agent/src-tauri/src/store/{mod.rs,queue.rs,checkpoints.rs,retention.rs}`;
  SQLCipher via `rusqlite` bundled-sqlcipher feature (fallback decision
  recorded here if bundling fails on a platform — risk #3); DB key generated
  at install, stored in the OS keychain (never in the DB or config).
- **Output:** `agent.db` with the spec §13.1 tables; enqueue commits before
  checkpoint advance (single transaction ordering); retention sweeper
  (events/receipts 30d, diag 7d).
- **Dependencies:** T0.2; T2.3 (keychain module).
- **Tests:** crash-recovery test (kill between enqueue and checkpoint →
  duplicate produced, never a gap); retention test with injected clock; a
  test that the DB file opened without the key is unreadable (header check).
- **Completion:** queue survives process kill + restart (§27.3);
  no plaintext payload bytes recoverable from the DB file in the test.

**T3.3 — Policy engine + payload validator + quarantine** *(L)*
- **Objective:** spec §16 enforcement before persistence.
- **Files:** `desktop-agent/src-tauri/src/privacy/{policy.rs,validator.rs,quarantine.rs}`.
- **Output:** `effective_policy = most_restrictive(platform, org, user,
  connector)`; only `analytics_only` implemented (other modes are enum
  variants that resolve to *deny*); validator runs at enqueue time: any
  prohibited field name (spec §12.2 list) or free-text-shaped value →
  event quarantined (counted, surfaced in diagnostics, never uploaded);
  contradiction check (`analytics_only` + `raw_prompt_included=true` →
  quarantine).
- **Dependencies:** T3.1, T3.2.
- **Tests:** every §26.1 bullet that applies agent-side: raw prompt field
  rejected; raw response field rejected; redacted/full modes refuse to
  activate without explicit policy (which Phase 1 never grants); queue
  persistence contains no raw text (scan test over the serialized rows);
  quarantined events excluded from sync batches.
- **Completion:** privacy tests wired as a distinct, merge-blocking CI job
  step in `desktop-ci.yml`.

**T3.4 — Local feature extractor (shape + counts only)** *(M)*
- **Objective:** spec §7 first slice WITHOUT prompt-text reads (D-DA-5 gate).
- **Files:** `desktop-agent/src-tauri/src/extract/{mod.rs,counts.rs}`.
- **Output:** per-event derived numbers available from source shape alone:
  char/word counts computed *streaming* over content the connector already
  has in hand, turn counts, tool-invocation counts, model name, token
  counts — content dropped immediately after counting (never stored, never
  passed on); day-aggregation into the existing metric keys.
- **Dependencies:** T3.3 (validator wraps extractor output).
- **Tests:** extractor output contains only numbers/enums (property test:
  serialize output, assert no string field exceeds 64 chars and none match
  source content substrings); aggregation matches the CLI's summarize
  fixtures for the same inputs.
- **Completion:** feature output passes the validator by construction;
  classifier heuristics (taskCategory etc.) explicitly ABSENT — stubbed
  `unknown` pending D-DA-5.

### Phase M4 — Sync + backend

**T4.1 — Sync engine (batches, retry taxonomy, splitting)** *(L)*
- **Objective:** spec §14 client on the existing ingest contract.
- **Files:** `desktop-agent/src-tauri/src/sync/{mod.rs,batch.rs,retry.rs}`;
  reuses `AgentIngestRequest` shape (generated JSON schema or hand-mirrored
  struct + a contract test against fixture JSON produced by the TS zod
  schema).
- **Output:** day-aggregate batch build from queue; gzip; 250-event/1MB
  caps; single in-flight upload; retry on 408/425/429/5xx/network with
  exponential backoff + jitter; no blind retry on 400/401/403/409/422;
  413/422 → bisect-split; receipts recorded; `paused`/revoked → state
  `authentication_required`.
- **Dependencies:** T3.2, T2.3.
- **Tests:** every §26.2 bullet: offline queueing, restart recovery,
  duplicate retry (server sees identical natural keys — asserted against a
  local mock of ingest), batch splitting, token-auth failure paths, backoff
  schedule (jitter within bounds, injected clock).
- **Completion:** end-to-end against preview deploy: kill network mid-sync,
  reconnect, verify no data loss and no double-counting (idempotency).

**T4.2 — Backend: signed remote config** *(M)*
- **Objective:** spec §17 with the never-broaden law.
- **Files:** `src/app/api/desktop/config/route.ts` (GET, device-token-authed;
  Ed25519-signed JSON body: configurationVersion, issuedAt/expiresAt,
  minimumAgentVersion, defaultContentMode always `analytics_only`, connector
  enablement/intervals, updateChannel, emergency shutdown flag);
  `src/lib/desktop-config.ts` (config composition + signing; private key
  from a Worker secret `DESKTOP_CONFIG_SIGNING_KEY` — new, synced in
  `deploy.yml` secret step); public key baked into the agent at build time.
- **Output:** agent-side `config.rs` verify + cache + expiry semantics
  (invalid signature → keep last valid unexpired; none → restrictive
  built-ins); config can DISABLE but never widen (agent asserts
  `defaultContentMode` ≤ local mode; violation → `policy_blocked`).
- **Dependencies:** T2.1 (verifier); agent side T3.3.
- **Tests:** backend route test (signature verifies against the public
  key); agent tests: tampered signature rejected; expired config discarded;
  broaden attempt (`full_content` in config) → `policy_blocked`, never
  applied (spec §26.1 "remote config cannot silently broaden policy").
- **Completion:** rotation procedure documented (key versioned like the KEK
  pattern, but a distinct key).

**T4.3 — Backend: diagnostics sink** *(S)*
- **Objective:** spec §23.2 explicit-action bundle, counts only.
- **Files:** `src/app/api/desktop/diagnostics/route.ts` (device-token-authed
  POST; zod-validated: version, platform, arch, connector states, queue
  counts, last sync, config/policy versions, update state, sanitized log
  tail with a server-side re-scrub + size cap); storage as a
  `connector_runs`-style append or Workers Logs (decide in-task; no new
  org-scoped table unless append rows — if a table, three registrations).
- **Output:** "Send diagnostics" in the tray works end-to-end; bundle
  excludes activity payloads by default (schema has no payload field at
  all — structurally impossible).
- **Dependencies:** T2.1.
- **Tests:** route rejects any body with unexpected keys (strict zod);
  oversized bundle → 413; agent-side test that the bundle builder never
  includes event payloads.
- **Completion:** invariant-b review: nothing in the bundle can carry
  content.

### Phase M5 — Initial sources

**T5.1 — Claude Code connector (Rust port) + fixture parity** *(L)*
- **Objective:** spec §11.3.1 against the validated local surface the CLI
  already parses.
- **Files:** `desktop-agent/src-tauri/src/connectors/{mod.rs,claude_code.rs}`
  (SourceConnector trait per spec §11.1: descriptor/detect/permissions/
  checkpoint/collect/health/disconnect); fixtures copied from
  `packages/revealyst-agent/tests/fixtures/**` (adding coverage is fine;
  changing shapes is an ADR).
- **Output:** detection of the Claude Code local data dir; incremental
  collection via checkpoints; allowlist projection identical to the CLI;
  unknown format version → `unsupported_version` state + honesty gap (never
  partial parse). Spec §10.3 ambiguous-shared-session handling: a "this
  computer is shared" declaration in onboarding/privacy settings demotes the
  device's events from `person` to `account` attribution (the existing
  ladder — never a guessed person) + an honesty gap; automatic multi-person
  detection is NOT attempted in Phase 1.
- **Dependencies:** T3.1–T3.4, T4.1.
- **Tests:** golden-file parity: for every CLI fixture, the Rust
  summarize-output equals the CLI's summarize output (records + signals +
  gaps); unsupported-version fixture → state transition, zero events.
- **Completion:** a real machine's Claude Code activity lands in the
  dashboard via the desktop agent in dogfood; `connector_runs` shows
  `agent_ingest` runs with honest gaps.

**T5.2 — Feature-signal contract ADR (gated on D-DA-5)** *(M)*
- **Objective:** the new `CANONICAL_METRICS` keys + allowlist rows for
  taskCategory/workflowType/complexityBand/prompt-structure daily counts.
- **Files:** `src/contracts/metrics.ts` (+ seed migration, next number at PR
  time); `src/lib/agent-collection-schema.ts` (new rows, honest wording);
  `packages/revealyst-agent/src/allowlist.ts` (kept byte-identical);
  `docs/decisions/00XX-desktop-feature-signals.md`;
  `src/connectors/scope-claims.ts` update.
- **Output:** keys seeded + constant-drift-tested; `/legal/what-we-collect`
  reflects new rows automatically.
- **Dependencies:** **D-DA-5 signed**; T5.1; serializes with schema PRs.
- **Tests:** metric-catalog drift test; agent-cli-contract byte-parity;
  frozen-contracts guard satisfied by the ADR.
- **Completion:** extractor's classifier module activated behind the new
  keys; validator updated to accept exactly the new bounded enums.

**T5.3 — Claude export importer** *(L)*
- **Objective:** spec §11.3.2 hardened manual import.
- **Files:** `desktop-agent/src-tauri/src/connectors/claude_export.rs`;
  import UI screen (file picker → progress → imported/skipped/failed
  counts).
- **Output:** archive validation (magic bytes), per-entry path-traversal
  rejection (no `..`, no absolute paths, no symlinks), decompressed-size +
  file-count limits with early abort, streaming local parse → Analytics
  Only projection → queue → temp files deleted (verified) — raw
  conversation text never queued or uploaded.
- **Dependencies:** T3.3, T3.4.
- **Tests:** §26.4 archive path traversal (crafted zip); zip-bomb (limit
  abort); malformed JSON entries → skipped counted; post-import temp-dir
  empty assertion; queue-scan shows no text.
- **Completion:** manual import of a real Claude export produces sane
  day-aggregates in dogfood.

**T5.4 — Coverage UI + disclosures + web sync-status integration** *(M)*
- **Objective:** spec §19.3/§19.4 honesty surfaces.
- **Files:** `desktop-agent/src/screens/{status,privacy}.tsx` (render from
  the allowlist bridge + connector states — no hand-written claims);
  `src/connectors/scope-claims.ts` (desktop source entry incl. "Claude
  Desktop: detailed conversation sync is not available in Phase 1");
  web-side Connections page shows the desktop device's last sync (existing
  connection card machinery).
- **Output:** privacy screen sections "what leaves this computer" / "what
  never leaves" generated from `allowlist.json`; pause collection; delete
  pending local data (queue purge with confirm); disconnect device
  (keychain wipe + server revoke call).
- **Dependencies:** T3.1, T2.4, T5.1.
- **Tests:** UI test: privacy screen lists exactly the allowlist's
  `sent:true` fields; pause stops the collector loop (state test); delete
  pending empties the queue table.
- **Completion:** copy reviewed against plain-English rules; no claim not
  derivable from a registry.

### Phase M6 — Updates + release

**T6.1 — Update manifest endpoint + updater integration** *(L)*
- **Objective:** spec §18 signed updates with channels + staged rollout.
- **Files:** `src/app/api/desktop/updates/[platform]/[arch]/[channel]/[version]/route.ts`
  (or static-manifest-on-R2 decision recorded in-task) serving Tauri
  updater JSON (version, notes, pub_date, per-target url+signature);
  rollout gate: deterministic cohort = FNV/SHA hash of
  `installationId + releaseId` mod 100 vs the release's rollout percentage
  (reuse the `src/lib/experiments.ts` deterministic-bucketing pattern);
  agent-side `tauri-plugin-updater` wiring (startup + 6-hourly check,
  background download, install on idle/restart, queue preserved).
- **Output:** internal-channel update installs end-to-end; halt = set
  rollout 0 / pull manifest; mandatory-update flag drives
  `update_required` state (blocks sync until updated for
  security/privacy/protocol-critical releases only).
- **Dependencies:** T4.2 (channel comes from config), T0.4 (updater
  keypair).
- **Tests:** tampered manifest signature → rejected (§26.4); cohort
  determinism test (same installation+release → same bucket); queue
  survival across an update (integration, one OS minimum).
- **Completion:** documented halt procedure; §27.6 all demonstrable.

**T6.2 — Release workflow + signing + notarization** *(L)*
- **Objective:** spec §25.2 protected release pipeline.
- **Files:** `.github/workflows/release-desktop.yml` — trigger: tag
  `desktop-v*` (+ `workflow_dispatch`); jobs: full desktop test suite →
  matrix build → **sign** (macOS Developer ID + notarytool staple; Windows
  signtool) → verify signatures → checksums → signed updater manifest →
  publish GitHub Release (internal channel) → manual promote steps
  (beta/stable) — signing/publish jobs run under
  `environment: desktop-release` ONLY (secrets: `APPLE_*`,
  `WINDOWS_CERT_*`, `TAURI_SIGNING_PRIVATE_KEY*`).
- **Output:** first signed internal release `desktop-v0.1.0-internal`.
- **Dependencies:** T0.4 (certs + environment exist), T6.1.
- **Tests:** a dry-run dispatch on a branch with signing skipped proves job
  wiring; `gh api` check that PR-triggered workflows cannot reference the
  environment; post-sign `codesign --verify` / `signtool verify` steps in
  the workflow itself.
- **Completion:** notarized .dmg + signed .msi/.exe attached to a GitHub
  Release; SmartScreen/Gatekeeper accept on clean VMs; PR workflows
  provably signing-free (spec §25.2 law).

### Phase M7 — Hardening + rollout

**T7.1 — Performance measurement harness** *(M)*
- **Objective:** spec §21 targets measured, not asserted.
- **Files:** `desktop-agent/tests/perf/**` + a CI job (or beta-telemetry
  counters in diagnostics) recording installed size, idle RSS, idle/active
  CPU, startup-to-tray, warm window open, idle network.
- **Output:** a recorded table vs targets in the release evidence pack;
  regressions fail desktop CI (size budget check is easy: artifact size).
- **Dependencies:** M6 (measure release builds).
- **Tests:** the harness itself; artifact-size gate in CI (< 40 MB per
  arch).
- **Completion:** all seven §21 rows have a measured value; misses either
  fixed or founder-accepted in the ledger.

**T7.2 — Security test pass + token rotation** *(L)*
- **Objective:** finish §26.4 + retire the D-DA-4 deviation.
- **Files:** rotation: `src/app/api/desktop/auth/refresh/route.ts` (device
  token exchanges for a short-lived access JWT used on sync calls; device
  token becomes the refresh credential; server-side rotation on re-pair) +
  agent `auth.rs` update; security tests: local DB tampering (integrity
  check → safe reset path), Tauri command authorization matrix (every
  command rejects calls from unexpected webview origins), frontend
  injection attempt (CSP verified at runtime).
- **Dependencies:** M2–M6 complete.
- **Tests:** replayed refresh rejected; revocation invalidates outstanding
  access tokens within TTL; tampered `agent.db` detected on open.
- **Completion:** §26.4 matrix fully green; D-DA-4 row closed in the
  ledger.

**T7.3 — Platform matrix + beta + staged stable rollout** *(L, founder-gated exit)*
- **Objective:** spec §26.3 + §27/§30 close-out.
- **Files:** test-evidence doc `docs/desktop-agent-release-evidence.md`
  (per-cell results: mac arm64/x64, Win10/11, non-admin, sleep/resume,
  offline startup, corporate proxy via env-var + system proxy honors,
  Unicode user/path, multiple OS users); Spec V4 §10.x product-contract
  section + `docs/product/requirements.csv` status flips ride the
  ship-announcement PR.
- **Output:** internal → beta → 5/25/50/100% stable rollout with halt
  rehearsed once.
- **Dependencies:** T7.1, T7.2; D-DA-1/D-DA-2 as applicable.
- **Tests:** the matrix itself; §30 definition-of-done checklist appended
  to the evidence doc with links.
- **Completion:** founder judges the evidence pack (rule 4); CLAUDE.md
  banner updated; memory/state docs updated.

## 6. Founder decision ledger

Queued as pending rows in `docs/product-signoffs.md` (D-DA-1…7). Summary:

| ID | Decision | Default if unsigned |
|---|---|---|
| D-DA-1 | Resident-collector go/no-go (SYNC-007/TEL-017/OQ-6): does daily-habit framing + measured Manual Sync cadence clear the documented demotion? | **Blocked** — M0–M1 non-collecting foundation only (repo enablement + app shell; no data collection, no pairing); no product-behavior PR merges |
| D-DA-2 | Sub-case-C ADR (V4 §9.4 a/b/c) authorizing Team-org desktop enrollment | **Personal orgs only**; Team-org enrollment UI never rendered |
| D-DA-3 | Day-aggregate ingestion adaptation (vs spec §12 per-event server schema) | **Day-aggregate stands**; per-event server storage on the Future ledger |
| D-DA-4 | Static `rva1.` device token for Phase 1 (vs spec §22.1 short-lived + rotating) | **Deviation stands until M7**; T7.2 retires it |
| D-DA-5 | Prompt-feature extraction boundary: may the extractor read prompt TEXT on-device (emitting only bounded enums), beyond today's shape-only reads? | **Shape+counts only**; classifier fields stay `unknown`; T5.2 blocked |
| D-DA-6 | Auto-update acceptability for individually-installed agents (BetrVG change-disclosure note from research R2) | **Proceed for Personal orgs** (user-controlled install); Team-org devices inherit D-DA-2's gate |
| D-DA-7 | Windows cert type (EV vs OV) + Apple Developer account owner | **EV recommended**; blocked on founder purchase either way |

## 7. Documentation updates

- This plan + [spec](product/desktop-agent-spec.md) +
  [gap analysis](product/desktop-agent-gap-analysis.md) +
  [requirements registry](product/desktop-agent-requirements.csv) — this PR.
- CLAUDE.md doc-index entry + planning banner; AGENTS.md resync — this PR.
- `docs/product-signoffs.md` D-DA rows — this PR.
- ADRs (0044+…), `docs/decisions/README.md` rows, compliance addenda
  (`docs/compliance/*` per-channel disclosure), Spec V4 §10.x section,
  `docs/product/requirements.csv`/`traceability.csv` flips,
  `docs/approvals.md` rows — build PRs (owning task noted in §5).
- `desktop-agent/README.md` — dev loop, allowlist-bridge regeneration,
  release/signing runbook (T0.2, T6.2).

## 8. Deferred / gated ledger (do not build)

- **Redacted Summary + Full Content modes** — enum reserved, resolve-to-deny;
  each is a future founder privacy analysis (spec §1.3, research §5.6).
- **Per-event server-side ingestion** (spec §12 `RevealystActivityEvent`
  table + normalization worker) — D-DA-3 default keeps day-aggregates.
- **Browser extensions** — Phase 2 at the earliest; tripwire until then.
- **Linux distribution, mobile collection, privileged service, local
  analytics dashboard** — spec §2.3 non-goals.
- **Process-presence connector** — default off, no product case (spec
  §11.3.3, research R2).
- **Claude API connector via desktop** — the web-side connector direction
  covers it (spec §1.5).
- **Non-Claude-Code sources** (Codex/Cursor/Gemini CLIs) — each is a new
  allowlist + scope-claims + `what-we-collect` claim; demand unverified
  (research OQ); one ADR per source.
- **Device-key request signatures** (spec §22.1) — rides the D-DA-4/T7.2
  token-rotation work; not an MVP blocker.
- **Small local ML classifier** (spec §7.4 later option) — bundle-size, CPU,
  and privacy review first; heuristics-v1 must prove insufficient.
