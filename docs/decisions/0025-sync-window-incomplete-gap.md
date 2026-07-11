# 0025 — `sync_window_incomplete` honesty gap + a gap sink for the local agent

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** founder (Manual Sync Phase 2, per docs/manual-sync-plan.md §6 Phase 2 / §5)

## Context

Manual Sync (Phase 1, PRs #170/#172/#174 + the npm publish PR) made the local
Claude Code channel a user-run, on-demand sync. Two honesty problems remained:

1. **Measured-zero conflation (plan R3).** An unsynced or partially-covered
   stretch renders as zero usage — plain metrics floor to 0 on absent rows by
   design. Phase 1 shipped the staleness badge/banner for the *time* dimension
   ("you haven't synced lately"); nothing yet covers the *coverage* dimension:
   a sync whose requested lookback exceeded the surviving local logs restates
   less history than the user asked for. The CLI's window pin (PR1) makes that
   safe — pinned-out days are left untouched, never deleted — but nothing
   *says* so. `HonestyGap` is the frozen vocabulary for exactly this class of
   disclosure, and it had no fitting kind.

2. **The local agent's gaps were silently dropped.** `POST /api/agent/ingest`
   validates `body.gaps` (frozen `agentIngestRequestSchema`) and then buries
   them inside the `raw_payloads` blob. Both dashboard gap readers
   (`readDashboardView` and `dashboardSummary`, via `collectGaps` in
   `src/lib/honesty-gaps.ts`) collect gaps **only** from `connector_runs.gaps`
   — which the agent path never wrote. Every gap the CLI has ever emitted
   (spend-estimate disclaimer, parse-drift counters) was invisible to every
   surface. Adding a new kind without a sink would be a no-op.

## Decision

1. **New `HonestyGap` kind `sync_window_incomplete`** across the three
   mirrored surfaces (all in this PR):
   - `src/contracts/connector.ts` `HonestyGap["kind"]` union (frozen);
   - `src/contracts/api.ts` `honestyGapSchema` enum (frozen);
   - `packages/revealyst-agent/src/types.ts` mirror.
   The compile-enforced `HONESTY_GAP_GLOSSARY` (`src/lib/metrics-glossary.ts`)
   gains the matching user-facing label — the Record's exhaustive key type is
   the tripwire that keeps kind-union and glossary in lockstep.

2. **Emission (client-side, where the knowledge lives):** `buildIngestRequest`
   emits the gap whenever the window pin narrowed the requested window
   (`window.start` moved), with a detail naming both dates. The server cannot
   emit this — it never sees the requested lookback, only the final window.

3. **Gap sink: agent ingest writes a `connector_runs` row per accepted push**
   (`kind: "agent_ingest"`, status success, window + counts + `body.gaps`),
   inside the ingest transaction, via the existing org-scoped
   `connectorRuns.start`/`finish` API. The existing readers then surface
   agent gaps with zero reader changes. This also un-drops `body.gaps`
   generally (problem 2), and gives the local channel the same append-only
   run evidence connectors have. Like `poll` rows (and unlike bounded
   one-shot `backfill` history), `agent_ingest` rows are subject to the
   90-day `connector_runs` retention purge (`src/db/system.ts`) — a
   re-runnable channel must not grow unbounded.

4. **`connector_runs.kind` gains `"agent_ingest"`** in `src/db/schema.ts`
   (frozen). This is a **type-level** Drizzle enum on a plain `text` column —
   no SQL migration exists or is needed; drizzle-kit generates no diff. No new
   table → no tenant-isolation/account-deletion registrations (connector_runs
   is already registered).

## Contracts affected

- `src/contracts/connector.ts` — `HonestyGap` kind union (+1 member, additive).
- `src/contracts/api.ts` — `honestyGapSchema` enum (+1 member, additive).
  Old CLIs remain valid (they simply never send the new kind); new CLIs
  against an old server would 400 — hence the server merges first, and the
  CLI ships in `@revealyst/agent` 0.2.1 published after this merges.
- `src/db/schema.ts` — `connector_runs.kind` (+`"agent_ingest"`, additive,
  type-level only, no migration).
- Agent package `types.ts` mirror (not frozen). Lockstep enforcement:
  `tests/agent-cli-contract.test.ts` builds a pinned batch that actually
  EMITS `sync_window_incomplete` and validates it under the frozen zod
  schema + lands it through `ingestAgentBatch` — an explicit assertion on
  the emitted gap keeps this non-vacuous (a schema-only or mirror-only
  drift fails the suite).

## Consequences / workstreams to re-sync

- Dashboards now show local-agent honesty gaps (including the long-dropped
  spend-estimate and parse-drift notes) — intended, honest, and consistent
  with every polled connector.
- `connectorRuns.list()` consumers see `kind: "agent_ingest"` rows; the two
  TS narrowings on kind (`"backfill"` checks in the poller) are unaffected
  (additive union member).
- Read-window crowding considered: both dashboard readers collect gaps from
  the most-recent 200 org runs. Poll cadence keeps every live connector's
  rows inside that window, and the retention purge bounds `agent_ingest`
  volume; only >200 manual syncs between two polls of a connector could
  crowd its gaps out — abuse territory already earmarked for the
  per-connection rate-limit fast-follow (plan §7.4).
- In-app copy keeps pinning `^0.2.0` until 0.2.1 is live on npm (a version
  floor ahead of the registry breaks `npx` resolution for everyone); the
  caret range auto-adopts 0.2.1 the moment it publishes.
- No active parallel workstream builds on the gap vocabulary; none to re-sync.
- Phase-3 residency (if ever built) inherits the same sink unchanged.
