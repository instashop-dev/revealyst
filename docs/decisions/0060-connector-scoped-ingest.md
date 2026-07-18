# 0060 — Connector-scoped ingest: `source_connector` in the metric_records key

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Desktop Agent workstream; founder gate-clearance for
  **Recommendation #10 / D-DA-8** (unblock live Claude-export import → sync).
- **Builds on:** **ADR 0002** (agent ingest: "a push is authoritative for its
  window", the delete-then-upsert restatement) and the frozen **metric_records**
  natural key (contracts-v1, `src/db/schema/tracking.ts`).

## Context

The desktop agent uploads **several distinct sources through ONE device
connection** — the live `claude-code-local` connector, the Claude data-export
importer (`claude_export`), the OTel receiver (`claude-code-otel`), and the
dormant `ai_tools`/`worktype` collectors. Every push runs a
**delete-then-upsert** restatement (`deleteWindowForConnection` then
`upsertRecords`).

Until now that window-delete was **connection-scoped, not connector-scoped**: it
erased EVERY metric_records row for the connection in the `min..max` day window,
regardless of `source_connector`. So a second source restating its window would
**clobber a sibling source's overlapping days**. This is the documented **D-DA-8**
hazard, and it is exactly why the Claude export importer shipped
**projection-only (no enqueue)** and why #7/#9's collectors ship dormant. (It is
also a latent bug today: an agent-ingest push already silently deletes the OTel
receiver's markers for overlapping days until the next OTel export re-lands them.)

`source_connector` already existed as a **NOT NULL, populated** column on every
row — it just was not part of the natural key, so it could not scope the delete.

## Decision

Add **`source_connector` to the `metric_records` natural key**, making ingest
connector-scoped end to end.

1. **Frozen key change (mig 0047).** The PK becomes
   `(org_id, subject_id, metric_key, day, dim, source_connector)`. **No data
   backfill:** the column has always been populated and the old key was already
   UNIQUE, so widening it can only make keys MORE unique — no existing row
   collides, nothing is merged or lost. A pure PK-index rebuild.

2. **Family-scoped window-delete.** `deleteWindowForConnection` takes a
   `sourceConnector` and filters the delete on its **family** — the module id
   BEFORE the `@version` (`split_part(source_connector, '@', 1)`). One source's
   restatement replaces ONLY its own family's rows. Family (not exact-version)
   scoping is deliberate: `source_connector` embeds a bumpable version
   (`claude-code-local@1` → `@2`), and a re-push after a version bump must still
   restate the older version's stale keys in its window — otherwise a dropped
   dim from `@1` survives and inflates a distinct-dims score (the pre-0060
   connection-wide delete removed these; exact-version scoping would regress it).
   Families are distinct module ids, so no family is a prefix of another and
   cross-source isolation holds. For every single-source, single-version
   connection (all admin-API connectors) the filter matches exactly the same
   rows as the old connection-wide delete — **byte-identical behavior**.

3. **Read-boundary MAX collapse (the double-count guard).** With the key
   widened, one subject can now hold the same `(day, metric, dim)` from two
   sources (e.g. `claude-code-local` and `claude_export` both report `prompts`
   for an overlapping day). To stop every downstream `.value` SUM
   (team/org score branches, maturity spend, capability evidence, spend
   governance, digests, dashboards, exec reports) from double-counting, the ONE
   read boundary they all load through — `metrics.records()` — collapses
   same-`(subject, day, dim)` rows to **MAX** (never SUM), carrying the LOWEST
   attribution of the group. This is the frozen **P0 dual-source convention**
   (`collapseDuplicateSignalRows`, `src/scoring/recompute.ts`) applied one level
   lower (per subject instead of per person). For a single-source org it is a
   strict **no-op that returns the input untouched** — proven byte-identical by
   the migration-equivalence test.

4. **Client contract (`agentIngestRequestSchema`).** A new **closed, optional**
   `source` discriminator (`claude-code-local` | `claude-export` | `ai-tools`),
   server-defaulted to `claude-code-local` when omitted. Each maps to a DISTINCT
   `source_connector` family.
   The client names a source; the SERVER composes the actual `source_connector`
   string (`agentSourceConnector`), so no free-form client value can pollute the
   key. Omitting `source` (an older agent) defaults to `claude-code-local` —
   fully backward compatible. A batch is single-source; the desktop splits its
   upload by source so each window-delete restates only its own rows.

5. **Live Claude-export import → sync enabled (D-DA-8 unblocked).** The desktop
   importer now **enqueues** its projected day-aggregates under `claude_export`
   instead of returning them; the sync engine tags each batch with its
   `source`; the server stamps `claude_export@1` and window-deletes only export
   rows. Sub-daily **signals** stay owned by the live `claude-code-local`
   source: `subject_day_signals` has no source column, so the export contributes
   **day-level records only** — it neither writes nor deletes signals
   (`deleteSignals: false`), and can never clobber the live connector's
   histograms. (Historical sub-daily granularity from the export is deliberately
   forgone to guarantee no clobber; the day-level metrics — the value of the
   import — are preserved.)

## Contracts affected

- **`src/db/schema/tracking.ts`** — `metric_records` PK widened (mig 0047).
- **`src/db/org-scope/metrics.ts`** — `upsertRecords` conflict target +=
  `source_connector` (and it leaves the SET, being a key column now);
  `deleteWindowForConnection` gains `sourceConnector` + `{ deleteSignals }`;
  `records()` collapses to MAX (`collapseSourcesToMax`).
- **`src/contracts/api.ts`** — `agentIngestRequestSchema.source` (closed enum,
  defaulted); `AGENT_INGEST_SOURCES` + `agentSourceConnector` helpers. The
  desktop ingest fixture regenerates with `source: "claude-code-local"`.

## Non-goals / what stays gated

- **#7 `ai_tools` and #9 `worktype` LIVE emission stay DORMANT.** This PR removes
  their shared D-DA-8 window-delete blocker only; each still has its own separate
  activation gate (real captured fixtures per rule 2 + per-pack sign-off). No
  fixtures are fabricated here. Note the two differ structurally: `worktype`
  rides INSIDE the `claude_code` connector's batch (same `source`, one delete +
  upsert — no clobber), so the mechanism alone unblocks it. `ai_tools` is a
  SEPARATE on-device connector that shares the device subject, so it also needs
  its own `source` family — this PR adds the `ai-tools` lane
  (`AGENT_INGEST_SOURCES` + `wire_source_for_connector`) so its future activation
  is safe, WITHOUT wiring its live emission (`run_cycle` still never calls it).
- Non-eng role expansion, Team-org enrollment (D-DA-2), and prompt-feature
  extraction (D-DA-5) are untouched.

## Workstreams to re-sync

Desktop Agent (owns the export importer + sync engine); the scoring/read
surface (the MAX collapse is now the load-bearing dual-source dedup for
team/org, not just person).
