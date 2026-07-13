import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { metricRecords, subjectDaySignals, subjects } from "../schema";

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
          `${r.subjectId}|${r.metricKey}|${r.day}|${r.dim ?? ""}`,
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
            target: [
              metricRecords.orgId,
              metricRecords.subjectId,
              metricRecords.metricKey,
              metricRecords.day,
              metricRecords.dim,
            ],
            set: {
              value: sql`excluded.value`,
              attribution: sql`excluded.attribution`,
              connectionId: sql`excluded.connection_id`,
              sourceConnector: sql`excluded.source_connector`,
              rawPayloadId: sql`excluded.raw_payload_id`,
              updatedAt: new Date(),
            },
          });
      }
    },

    /**
     * Makes a re-push authoritative for its window (ADR 0002, additive):
     * deletes this connection's records — and its subjects' signals —
     * inside the inclusive day window, so stale natural keys (e.g. a
     * model dim that disappeared from a corrected batch) cannot survive
     * a restatement. Other connections' rows are untouched.
     */
    async deleteWindowForConnection(
      connectionId: string,
      from: string,
      to: string,
    ) {
      await db
        .delete(metricRecords)
        .where(
          and(
            eq(metricRecords.orgId, orgId),
            eq(metricRecords.connectionId, connectionId),
            gte(metricRecords.day, from),
            lte(metricRecords.day, to),
          ),
        );
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
      return db
        .select()
        .from(metricRecords)
        .where(and(...conditions))
        .orderBy(metricRecords.day);
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
