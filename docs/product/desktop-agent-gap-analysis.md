# Desktop Agent — gap analysis against the technical specification

> Source spec: [desktop-agent-spec.md](desktop-agent-spec.md) (transcribed from
> the founder-provided docx, 2026-07-16). Companion registry:
> [desktop-agent-requirements.csv](desktop-agent-requirements.csv). Build plan:
> [Revealyst_Desktop_Agent_Execution_Plan.md](../Revealyst_Desktop_Agent_Execution_Plan.md).
> Method: three independent deep-analysis passes (backend surfaces; CI/repo
> rules; product-direction alignment) over the repo at `main` c33195f
> (2026-07-16, latest migration 0035, latest ADR 0043), reconciled here.
> Registry statuses: EXISTS (reuse as-is) · MODIFY · NEW · ADAPTED (spec
> requirement satisfied by a different existing mechanism) · GATED (blocked on
> a founder decision or external prerequisite).

## 1. Executive summary

The Desktop Agent is **not a new product category** — it is the resident
evolution of an already-founder-decided direction (the 2026-07-09
desktop-collector research, sub-case C: individual-opt-in-only, content-free
by shape, self-view-only inside Team orgs) and of two shipped telemetry
channels: the `packages/revealyst-agent` CLI (Manual Sync) and the Claude Code
OTel receiver (`POST /v1/metrics` + `/v1/logs`, ADR 0039). Roughly **the entire
backend data plane already exists**: device-token auth, envelope-encrypted
credential storage, an idempotent ingestion contract with restatement
semantics, the content-free collection allowlist and its public claim surface,
and every metric key the Phase-1 Claude Code connector needs.

What is genuinely new splits into three buckets:

1. **The desktop app itself** — a Tauri 2 Rust/React tray utility (new
   top-level `desktop-agent/` tree, new toolchain, new signing/release
   machinery). Nothing like it exists; the CLI is the reference
   implementation to port.
2. **A thin backend extension** — browser PKCE pairing endpoints that mint the
   *existing* device token, per-device metadata/heartbeat/revoke surfaces, a
   signed remote-config endpoint, an update-manifest endpoint, and a
   diagnostics sink.
3. **Governance** — one contract ADR (device pairing + desktop ingest scope),
   the still-unwritten Spec V4 §9.4 "sub-case-C ADR" (gates any Team-org
   surface), and a founder go/no-go on the resident-collector cadence gate
   (SYNC-007/TEL-017 documented the resident agent as *demoted*; this plan
   must clear that gate explicitly, not assume it).

**Two deliberate adaptations** of the spec (both `[INFERRED]` in the source)
are recorded as conflicts below rather than silently applied: the repo layout
(§4) and the event-level ingestion schema (§12) — the shipped, founder-directed
architecture is day-aggregate ingestion with server-side processing, and
Phase 1 keeps it.

## 2. What already exists (reuse as-is)

| Spec area | Existing implementation | Evidence |
|---|---|---|
| Device auth token (§8, §24.1-partial) | `rva1.<orgId>.<connectionId>.<secret>` scheme; mint/parse/verify pure WebCrypto; constant-time compare | `src/lib/agent-token.ts` (ADR 0002) |
| Token verification on ingest routes | `authenticateDeviceToken(db, env, bearer)` — 401/403 before body parse; `paused → 403` is a working revocation path | `src/lib/otel-receiver.ts` |
| Secret storage (server side) | AES-256-GCM envelope, AAD-bound `orgId:connectionId:device_token`, KEK rotation | `src/lib/credentials.ts` + `connection_credentials` (frozen) |
| Device record | A "device" is a `connections` row (`authKind="device_token"`, `vendor="claude_code_local"`); multiple devices per user = multiple rows (anticipated in schema comment) | `src/db/schema/connections.ts` |
| Token minting (session-authed) | `POST /api/connections/:id/agent-token` — CSRF-origin-checked, secret returned once, audit-logged | `src/app/api/connections/[id]/agent-token/route.ts` |
| Ingestion batch + idempotency (§14) | `POST /api/agent/ingest` → `ingestAgentBatch`: zod-validated `AgentIngestRequest`, transactional, **content-addressed idempotency** (natural key `(org,subject,metric,day,dim)` upsert + delete-window restatement) — a redelivered batch is safe by construction | `src/lib/agent-ingest.ts`, `src/db/org-scope/metrics.ts` |
| Honesty/coverage metadata (§19.3, §23) | `connector_runs` append-only runs with `gaps` → Data Confidence disclosures | `src/lib/data-confidence.ts`, `collectGaps` |
| Content-free allowlist + claim surface (§6, §19.4) | `AGENT_COLLECTION_FIELDS` / `AGENT_NEVER_COLLECTED`; CLI↔app byte-identity CI-pinned; public page generated from it | `src/lib/agent-collection-schema.ts`, `packages/revealyst-agent/src/allowlist.ts`, `tests/agent-cli-contract.test.ts`, `src/app/legal/what-we-collect/page.tsx` |
| Claude Code local parsing/summarizing (§11.3.1) | The CLI's allowlist projection → day-aggregate records; the reference implementation for the Rust port | `packages/revealyst-agent/src/{parse,summarize,window,identity,push}.ts` |
| Metric vocabulary (§7, §12.2) | All Phase-1 Claude Code signals map onto existing `CANONICAL_METRICS` keys (sessions, prompts, tokens_*, model_*, agent_*, spend) + `subject_day_signals` hour histograms + OTel `markers` | `src/contracts/metrics.ts` |
| Attribution to the Revealyst user (§10) | Person-attribution via the attribution ladder; device token binds org+connection; OTel subject resolution `user.id → email → developer.name` | `src/contracts/attribution.ts`, `src/lib/otel-ingest.ts` |
| Self-view-only enforcement pattern (§29 "no manager analytics") | `assertTeamOnlyPseudonymized` runtime tripwire; self-view-only precedents ADR 0036/0038 | `src/lib/visibility.ts` |
| Per-vendor coverage claims (§19.3) | `SCOPE_CLAIMS` registry (`claude_code_local` entry exists) | `src/connectors/scope-claims.ts` |
| Independent in-repo release precedent (§4) | `packages/revealyst-agent` + `release-agent.yml` (workflow_dispatch, own version, npm provenance) | `.github/workflows/release-agent.yml` |

## 3. What must be modified

| Item | Change | Why |
|---|---|---|
| `authenticateDeviceToken` location | Extract to `src/lib/device-token.ts`; have `agent-ingest.ts` call it (today the parse+verify logic is duplicated inline there) | Dedup before a third caller (desktop endpoints) lands |
| `src/lib/agent-collection-schema.ts` | Add rows for any new locally-derived feature field the desktop agent sends (task category, workflow type, complexity band, prompt-structure booleans → daily counts) | Allowlist-first discipline: the public page and transparency panel derive from it; hand-editing the page is forbidden (W3-N) |
| `src/connectors/scope-claims.ts` | Extend/add the desktop-agent source entry incl. the honest "Claude Desktop: detailed conversation sync not available in Phase 1" limitation | Coverage claims are a registry, never copy |
| Root `tsconfig.json` | Add `"desktop-agent"` to `exclude` | The `**/*.ts` include sweeps everything; Tauri/Vite TS must not compile under Next settings (breaks root `npm run typecheck` and therefore ALL PRs) |
| `.gitignore` | Add `desktop-agent/src-tauri/target/`, `desktop-agent/dist/`, bundle outputs | Rust build artifacts |
| `docs/compliance/*` (DPIA template, works-council notification) | Per-channel addendum disclosing the desktop channel + self-view boundary | Desktop-collector research §5.5 gate 3; prose is a claim surface (W3-N) |
| Better Auth `trustedOrigins` / redirect handling | The PKCE callback is a custom URI scheme (`revealyst://`), delivered via a code the browser page hands off — the authorize endpoint needs its own strict redirect allowlist (only the registered scheme+path) | §8.2 validation list |

## 4. What is genuinely new

**Backend (each frozen-contract touch = ADR; each new org-scoped table = the
three registrations):**

- `POST /api/desktop/auth/start` + `POST /api/desktop/auth/exchange` — PKCE
  pairing: the *human* authenticates via the existing web session in the
  system browser; a consent screen mints a one-time code bound to the
  `code_challenge`; the exchange endpoint verifies `code_verifier` and mints
  the existing `rva1.` device token for a freshly created device connection.
  Needs a short-lived one-time-code store (new small table or existing KV
  pattern).
- Device management: list/rename/revoke devices in Settings (reads
  `connections` rows), `POST` heartbeat (new lightweight route; per-device
  `last_heartbeat_at`).
- `GET /api/desktop/config` — **signed** remote config (Ed25519; a NEW signing
  key pair, never the credential KEK) with `configurationVersion`, expiry,
  connector enablement, minimum agent version, poll intervals.
- Update manifest endpoint for the Tauri updater (its own Ed25519 update key —
  Tauri's updater scheme, distinct from the config-signing key).
- `POST /api/desktop/diagnostics` — device-token-authed, counts/status only
  (invariant b: no activity payloads).

**Desktop app (all new, top-level `desktop-agent/`):**

- Tauri 2 shell: tray, onboarding/status/privacy/diagnostics windows,
  autostart, single-instance, deep link, strict capability permissions + CSP.
- Rust core: connector runtime (SourceConnector trait), Claude Code connector
  (port of the CLI parser — allowlist projection, never blocklist), Claude
  export importer (zip-hardened), local feature extractor (bounded
  enums/counts only), privacy processor + payload validator (quarantine),
  encrypted SQLite queue (SQLCipher), sync engine (backoff+jitter, batch
  split), keychain/DPAPI token storage, structured logs with secret-free
  invariant.
- An allowlist bridge: `AGENT_COLLECTION_FIELDS` exported to generated JSON
  consumed by the Rust parser + a contract test pinning byte-parity (extends
  the existing CLI↔app drift test to a third surface).

**CI/CD (new, isolated):**

- `desktop-ci.yml` — path-filtered PR checks: fmt/clippy/cargo test, desktop
  TS lint+typecheck+tests, privacy-payload tests, Tauri capability audit,
  cargo-deny/audit, unsigned macOS+Windows builds. No signing secrets.
- `release-desktop.yml` — tag-triggered, full test suite → build → sign →
  notarize → verify → signed update manifest → channel publish → staged
  rollout. First use of a **protected GitHub Environment** in this repo
  (signing secrets live only there).

**Governance (new docs):**

- ADR 0044 (number to re-verify at PR time): desktop pairing endpoints +
  device-connection semantics + new allowlist fields/metric keys.
- The Spec V4 §9.4 **sub-case-C ADR** (exclusion audit predicate + dual-source
  dedup + surfaced-not-billed) — required before any Team-org desktop surface.
- Founder ledger rows D-DA-1…D-DA-7 in `docs/product-signoffs.md`.

## 5. Conflicts and deliberate adaptations

Numbered like prior gap analyses; each row feeds the founder ledger. "Adapted"
rows are resolved by the execution plan; "Gated" rows block scheduled work.

### C1 — Resident collector vs the documented demotion (GATED → D-DA-1)

`docs/product/requirements.csv` **SYNC-007** (Future): the resident agent is
"demoted not dead; go/no-go decided by `last_success_at` cadence telemetry."
**TEL-017** (Kill): "no always-on resident collector" *as a near-term lever*.
Spec V4 §16 OQ-6 makes the go/no-go a measured decision. The Desktop Agent
**is** that resident collector. Building it requires an explicit founder
green-light that the daily-habit framing + measured Manual Sync cadence clears
the gate — the plan schedules foundation work but ties the first shipped
binary to this sign-off.

### C2 — Team-org surface gated on the unwritten sub-case-C ADR (GATED → D-DA-2)

Spec V4 §9.4: desktop/local data from an opted-in Team-org member feeds
**only that person's private self-view** until an ADR lands (a) a provable
exclusion audit predicate, (b) dual-source dedup, (c) surfaced-not-billed.
That ADR does not exist (0001–0043 checked). The spec's §29 rules ("no manager
analytics in the agent", "attribute to the Revealyst user") are compatible —
but the *server-side* Team-org handling needs the ADR. **Sequencing:
Personal-org slice first** (lighter gate per the research §5.5), Team-org
enrollment second, behind the ADR.

### C3 — Event-level schema (§12) vs shipped day-aggregate ingestion (ADAPTED → D-DA-3)

The spec defines a per-event `RevealystActivityEvent` + server normalization
pipeline. The shipped, founder-directed architecture (research §5.6 +
ADR 0002) is: on-device allowlist projection → **day-aggregate**
`AgentIngestRequest` (records + hour-histogram signals + gaps) → existing
idempotent ingest. Phase 1 keeps day-aggregates: every §6.2 Analytics Only
field maps to a daily metric/dim or histogram; §27 acceptance criteria are
satisfiable without per-event rows; and no new org-scoped event table is
needed. The desktop agent still queues *locally* at event granularity
(spec §13 `pending_events`) and aggregates at sync time. Event-level
**server** ingestion is deferred to the Future ledger (it would need its own
ADR + table + purge/tenancy registrations). If the founder wants per-event
server storage in Phase 1, D-DA-3 reverses this adaptation.

### C4 — Short-lived access + rotating refresh tokens (§22.1) vs static device token (ADAPTED → D-DA-4)

The live scheme is a single long-lived `rva1.` secret (rotated on re-mint,
revoked by pause/credential delete), stored in the OS keychain on the client.
Phase 1 keeps it — it is prod-proven, and the spec's real security goals
(revocability, no plaintext at rest, no tokens in SQLite/frontend) are all
met. Token rotation (short-lived access minted from the device secret) is
scheduled as an M7 hardening item, not an MVP blocker. Recorded as a
deviation, not silently.

### C5 — Repo layout (§4) (ADAPTED — no founder row)

The spec's `apps/ + packages/ + services/` monorepo split does not exist and
will not be retrofitted. Placement: top-level **`desktop-agent/`** (outside
`src/**`, outside `packages/*/tests` vitest glob, excluded from root
tsconfig), backend endpoints stay in the existing `src/` monolith. The spec's
actual requirement — "same repository must not mean same release lifecycle" —
is met via the independent version + path-filtered CI + separate release
workflow (the `release-agent.yml` precedent).

### C6 — Spec §24 route names (ADAPTED — no founder row)

`POST /v1/desktop/ingestion/batches` → the existing `POST /api/agent/ingest`.
Device CRUD under `/v1/users/me/devices` → session-authed Settings routes in
the existing `/api` convention. New endpoints follow repo conventions
(`/api/desktop/*`), not the spec's inferred `/v1/desktop/*` naming — except
where the unauthenticated-prefix `/v1/*` pattern already exists (OTel).

### C7 — "Partial batch acceptance" (§26.2/§27.3) (ADAPTED)

`ingestAgentBatch` is transactional all-or-nothing; a rejected batch returns
a typed error and the client retries or splits. Because idempotency is
content-addressed, full-batch retry is always safe — "partial acceptance"
is satisfied by client-side batch splitting on 413/422 rather than
server-side per-event accept lists. Documented so the acceptance test asserts
the real mechanism.

### C8 — Prompt-feature extraction boundary (GATED → D-DA-5)

Spec §7 has the extractor read prompt-like content in-process and emit bounded
enums/booleans. The shipped pattern already reads content-block *type* without
reading contents (`content_block_type`, `sent: false`), and the tripwire is
"no prompt-content **ingestion**" (nothing content-shaped leaves the device or
reaches the server). The extractor is compatible **iff** every output is a
bounded enum/number from the allowlist projection, any free-text-shaped field
is dropped by default, and no cloud LLM is called. Whether reading prompt
*text* on-device (vs today's shape-only reads) is an incremental step or the
"richer payload" that research §5.6 says needs a fresh founder privacy
analysis is a founder call — Phase 1 M3 implements shape-only + length/word
counts first (no prompt-text reads), and the heuristic classifier over prompt
text ships only after D-DA-5 is signed.

### C9 — New metric keys and allowlist fields are frozen-contract changes (scheduled, not a conflict)

Task category / workflow type / complexity / prompt-structure daily counts are
new `CANONICAL_METRICS` keys (constant + seed migration, drift-tested) and new
allowlist rows — each an ADR-bearing change bundled into the M5 contract ADR.

## 6. Requirement intersections (existing registries)

| Req | Status today | Desktop Agent impact |
|---|---|---|
| SYNC-007 (resident agent, Future) | gated on cadence telemetry | This plan is its execution; flips to In-progress only after D-DA-1 |
| TEL-017 (Kill: always-on collector) | kill-as-near-term-lever | Superseded by D-DA-1 if signed; registry row updated then, not now |
| SYNC-001 (Manual Sync) | shipped | Remains the fallback path; desktop agent must not regress it |
| TEL-008 / V1-001 / ARCH-007 (OTel receiver) | shipped | Dual-source overlap: same person may emit OTel markers AND desktop records — dedup design in the sub-case-C ADR (distinct metric keys is the existing precedent) |
| POP-007 (sub-case-C ADR prerequisites) | V1-gated | = C2 |
| PRIV-001 / PRIV-008 / NOT-002 / NOT-003 / NOT-009 | frozen/kill | Phase-1 scope complies (no extension, no MDM, no raw upload, content-free) |
| OQ-003/OQ-004 (role expansion / conversation structure) | open | Explicitly NOT unlocked by the desktop agent (it is eng-tool-shaped); stated to avoid overclaim |
| D-TCI-1 / D-TCI-2 (manager-visible per-person data) | pending, default no | Desktop agent stays on the "no" side; no interaction |

## 7. Documentation impact

Created in this PR: this analysis, [desktop-agent-spec.md](desktop-agent-spec.md),
[desktop-agent-requirements.csv](desktop-agent-requirements.csv), the
[execution plan](../Revealyst_Desktop_Agent_Execution_Plan.md), founder ledger
rows (D-DA-1…7), CLAUDE.md + AGENTS.md doc-index entries. Deferred to build
PRs: ADRs, `docs/decisions/README.md` index rows, compliance addenda,
`requirements.csv`/`traceability.csv` status flips, Spec V4 §10.x product-
contract section (after D-DA-1), and all code/allowlist/scope-claims changes.
