import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { lowestAttribution } from "../../contracts/attribution";
import type { Db } from "../client";
import { metricRecords, subjectDaySignals, subjects } from "../schema";

type MetricRecordRow = typeof metricRecords.$inferSelect;

/**
 * Collapse rows that share the same (subject, day, dim) but come from two
 * different `source_connector`s down to ONE row per key, keeping the MAX
 * value — the dual-source dedup (ADR 0060), applied at the single read
 * boundary so no downstream SUM double-counts.
 *
 * Since `source_connector` joined the natural key (mig 0047), one subject can
 * hold the same (day, metric, dim) from e.g. `claude-code-local@1` AND
 * `claude_export@1`. MAX (never SUM) matches the frozen P0 convention: when
 * two sources report the same day the larger is the authoritative superset,
 * so MAX collapses the double-count to the true figure and never exceeds the
 * sum (it can under- but never over-count — invariant b). The survivor carries
 * the LOWEST attribution of the collapsed group (a degraded input is surfaced,
 * never laundered up — the frozen propagation rule). Ties on value break on the
 * lexicographically smallest `source_connector` so the result is deterministic
 * regardless of DB row order.
 *
 * For the common SINGLE-source org every key has exactly one row, so this is a
 * strict no-op that returns the input array UNTOUCHED (same order, same
 * objects) — byte-identical to pre-0060 reads (proven by the
 * migration-equivalence test).
 */
export function collapseSourcesToMax(
  rows: MetricRecordRow[],
): MetricRecordRow[] {
  // Fast path: no two rows share a (subject, day, dim) key ⇒ nothing to
  // collapse ⇒ return the exact same array (preserves order + identity).
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const r of rows) {
    const key = `${r.subjectId}|${r.day}|${r.dim}`;
    if (seen.has(key)) {
      hasDuplicate = true;
      break;
    }
    seen.add(key);
  }
  if (!hasDuplicate) return rows;

  const survivors = new Map<string, MetricRecordRow>();
  const groupAttributions = new Map<string, MetricRecordRow["attribution"][]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = `${r.subjectId}|${r.day}|${r.dim}`;
    const attrs = groupAttributions.get(key);
    if (attrs) {
      attrs.push(r.attribution);
    } else {
      groupAttributions.set(key, [r.attribution]);
      order.push(key);
    }
    const existing = survivors.get(key);
    const wins =
      !existing ||
      r.value > existing.value ||
      (r.value === existing.value &&
        r.sourceConnector < existing.sourceConnector);
    if (wins) survivors.set(key, r);
  }
  // Re-emit in first-occurrence order to keep the shape stable for callers.
  return order.map((key) => ({
    ...survivors.get(key)!,
    attribution: lowestAttribution(groupAttributions.get(key)!),
  }));
}

/** What Connector.normalize() emits — upserted on the metric_records PK. */
export type MetricRecordUpsert = {
  subjectId: string;
  metricKey: string;
  day: string; // YYYY-MM-DD, UTC calendar day
  dim?: string;
  connectionId: string;
  value: number;
  attribution: (typeof metricRecords.attribution.enumValues)[number];
  sourceConnector: string;
  rawPayloadId?: string | null;
};

export type SubjectDaySignalUpsert = {
  subjectId: string;
  day: string;
  hours?: number[] | null;
  peakConcurrency?: number | null;
  sourceGranularity: (typeof subjectDaySignals.sourceGranularity.enumValues)[number];
};

export function metricsNamespace(db: Db, orgId: string) {
  return {
    /**
     * The frozen ingestion contract: idempotent upsert on the natural PK
     * (org, subject, metric, day, dim). Every vendor restates recent
     * days, so re-polls always overwrite. org_id is part of the PK, so a
     * cross-org conflict is a different key by construction — no extra
     * update-path guard needed (unlike subjects/credentials, whose
     * conflict keys omit org_id); the insert path is composite-FK-bound.
     */
    async upsertRecords(records: MetricRecordUpsert[]) {
      // Batched multi-row upsert (ADR 0003): a backfill chunk carries
      // thousands of rows; per-row round-trips over Hyperdrive were the
      // unmodeled half of the queue wall-time budget. Dedupe on the PK
      // (one INSERT may not touch a row twice); last entry wins — the
      // sequential loop's restatement semantics.
      const byPk = new Map<string, MetricRecordUpsert>();
      for (const r of records) {
        byPk.set(
          `${r.subjectId}|${r.metricKey}|${r.day}|${r.dim ?? ""}|${r.sourceConnector}`,
          r,
        );
      }
      const deduped = [...byPk.values()];
      const BATCH = 500;
      for (let i = 0; i < deduped.length; i += BATCH) {
        await db
          .insert(metricRecords)
          .values(
            deduped.slice(i, i + BATCH).map((r) => ({
              orgId,
              subjectId: r.subjectId,
              metricKey: r.metricKey,
              day: r.day,
              dim: r.dim ?? "",
              connectionId: r.connectionId,
              value: r.value,
              attribution: r.attribution,
              sourceConnector: r.sourceConnector,
              rawPayloadId: r.rawPayloadId ?? null,
            })),
          )
          .onConflictDoUpdate({
            // `source_connector` joined the natural key (ADR 0060, mig 0047),
            // so it is part of the conflict target now — a restatement from a
            // DIFFERENT source is a different key (its own row), never an
            // update of a sibling source's row. It is therefore no longer in
            // the SET (a conflict-target column cannot change on update).
            target: [
              metricRecords.orgId,
              metricRecords.subjectId,
              metricRecords.metricKey,
              metricRecords.day,
              metricRecords.dim,
              metricRecords.sourceConnector,
            ],
            set: {
              value: sql`excluded.value`,
              attribution: sql`excluded.attribution`,
              connectionId: sql`excluded.connection_id`,
              rawPayloadId: sql`excluded.raw_payload_id`,
              updatedAt: new Date(),
            },
          });
      }
    },

    /**
     * Makes a re-push authoritative for its window (ADR 0002/0060): deletes
     * this connection's records for ONE `sourceConnector` — and, by default,
     * its subjects' sub-daily signals — inside the inclusive day window, so
     * stale natural keys (e.g. a model dim that disappeared from a corrected
     * batch) cannot survive a restatement.
     *
     * SCOPED TO `sourceConnector` (ADR 0060, D-DA-8): the device connection
     * carries several sources (`claude-code-local@N`, `claude_export@1`,
     * `claude-code-otel@1`). Before 0060 this delete was connection-wide and
     * would clobber a sibling source's overlapping days on every re-push;
     * now one source's restatement replaces ONLY its own rows. For a
     * single-source connection (every admin-API connector) the added filter
     * matches exactly the same rows as before — byte-identical behavior.
     *
     * `deleteSignals` (default true) controls the sub-daily-signal sweep.
     * `subject_day_signals` has NO source column (its key is subject+day), so
     * it cannot be scoped per source. On the shared device connection the live
     * `claude-code-local` source is the SOLE signal author; a source that does
     * not own signals (the `claude_export` import) passes `false`, so it
     * neither writes nor deletes signals and can never clobber the live
     * connector's histograms. Every existing caller keeps the default true.
     */
    async deleteWindowForConnection(
      connectionId: string,
      sourceConnector: string,
      from: string,
      to: string,
      opts: { deleteSignals?: boolean } = {},
    ) {
      await db
        .delete(metricRecords)
        .where(
          and(
            eq(metricRecords.orgId, orgId),
            eq(metricRecords.connectionId, connectionId),
            eq(metricRecords.sourceConnector, sourceConnector),
            gte(metricRecords.day, from),
            lte(metricRecords.day, to),
          ),
        );
      if (opts.deleteSignals === false) return;
      const subjectRows = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            eq(subjects.orgId, orgId),
            eq(subjects.connectionId, connectionId),
          ),
        );
      const subjectIds = subjectRows.map((s) => s.id);
      if (subjectIds.length > 0) {
        await db
          .delete(subjectDaySignals)
          .where(
            and(
              eq(subjectDaySignals.orgId, orgId),
              inArray(subjectDaySignals.subjectId, subjectIds),
              gte(subjectDaySignals.day, from),
              lte(subjectDaySignals.day, to),
            ),
          );
      }
    },

    async upsertSignals(signals: SubjectDaySignalUpsert[]) {
      // Batched like upsertRecords (ADR 0003); PK is (subject, day).
      const byPk = new Map<string, SubjectDaySignalUpsert>();
      for (const s of signals) {
        byPk.set(`${s.subjectId}|${s.day}`, s);
      }
      const deduped = [...byPk.values()];
      const BATCH = 500;
      for (let i = 0; i < deduped.length; i += BATCH) {
        await db
          .insert(subjectDaySignals)
          .values(
            deduped.slice(i, i + BATCH).map((s) => ({
              orgId,
              subjectId: s.subjectId,
              day: s.day,
              hours: s.hours ?? null,
              peakConcurrency: s.peakConcurrency ?? null,
              sourceGranularity: s.sourceGranularity,
            })),
          )
          .onConflictDoUpdate({
            target: [
              subjectDaySignals.orgId,
              subjectDaySignals.subjectId,
              subjectDaySignals.day,
            ],
            set: {
              hours: sql`excluded.hours`,
              peakConcurrency: sql`excluded.peak_concurrency`,
              sourceGranularity: sql`excluded.source_granularity`,
              updatedAt: new Date(),
            },
          });
      }
    },

    async records(filter: {
      metricKey: string;
      from: string;
      to: string;
      dim?: string;
    }) {
      const conditions = [
        eq(metricRecords.orgId, orgId),
        eq(metricRecords.metricKey, filter.metricKey),
        gte(metricRecords.day, filter.from),
        lte(metricRecords.day, filter.to),
      ];
      if (filter.dim !== undefined) {
        conditions.push(eq(metricRecords.dim, filter.dim));
      }
      const rows = await db
        .select()
        .from(metricRecords)
        .where(and(...conditions))
        .orderBy(metricRecords.day);
      // Collapse same-(subject, day, dim) rows from two sources to MAX (ADR
      // 0060). THE single dedup boundary: every scoring/maturity/capability/
      // spend reader loads through here, so no downstream `.value` SUM can
      // double-count a person whose day is reported by two sources. A no-op
      // (returns `rows` untouched) for any single-source org.
      return collapseSourcesToMax(rows);
    },

    async signals(filter: { subjectId: string; from: string; to: string }) {
      return db
        .select()
        .from(subjectDaySignals)
        .where(
          and(
            eq(subjectDaySignals.orgId, orgId),
            eq(subjectDaySignals.subjectId, filter.subjectId),
            gte(subjectDaySignals.day, filter.from),
            lte(subjectDaySignals.day, filter.to),
          ),
        )
        .orderBy(subjectDaySignals.day);
    },

    /**
     * Org-wide batch read (ADR 0017): all subject_day_signals rows for
     * the org in the window, same column set and shape per row as
     * `signals()`. Lets callers that need every subject's signals for a
     * window (dashboard heatmap, shared-account flags) load them in one
     * query instead of one-per-subject, then group by subjectId in JS.
     * Additive only — `signals()` is unchanged.
     */
    async allSignals(filter: { from: string; to: string }) {
      return db
        .select()
        .from(subjectDaySignals)
        .where(
          and(
            eq(subjectDaySignals.orgId, orgId),
            gte(subjectDaySignals.day, filter.from),
            lte(subjectDaySignals.day, filter.to),
          ),
        )
        .orderBy(
          subjectDaySignals.orgId,
          subjectDaySignals.subjectId,
          subjectDaySignals.day,
        );
    },
  };
}
