import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../client";
import { teamInsights } from "../schema";
import type {
  TeamInsightCategory,
  TeamInsightParams,
  TeamInsightSeverity,
} from "../../lib/team-insights";

// Aggregate manager insight feed reads/writes (TCI Phase 2-F, ADR 0050).
// ORG-SCOPED, COUNT-ONLY — no method here ever emits a person id or a
// per-person value (the row shape carries none; `params` is count-only). The
// feed read (`listOpen`) powers the dashboard card + the weekly brief; the
// lifecycle writes (`markViewed`, `dismiss`) are driven from handleApi; the
// reducer surface (`list` + `deleteByIds` + `upsertGenerated`) is the poller's
// idempotent nightly regeneration path (batch-once, person-count-independent).

export type TeamInsightRow = {
  id: string;
  teamId: string | null;
  category: TeamInsightCategory;
  severity: TeamInsightSeverity;
  subject: string;
  params: TeamInsightParams;
  periodStart: string;
  status: "new" | "viewed" | "dismissed";
};

export type TeamInsightUpsert = {
  teamId: string | null;
  category: TeamInsightCategory;
  severity: TeamInsightSeverity;
  subject: string;
  params: TeamInsightParams;
  periodStart: string;
};

function mapRow(r: {
  id: string;
  teamId: string | null;
  category: string;
  severity: string;
  subject: string;
  params: unknown;
  periodStart: string;
  status: string;
}): TeamInsightRow {
  return {
    id: r.id,
    teamId: r.teamId,
    category: r.category as TeamInsightCategory,
    severity: r.severity as TeamInsightSeverity,
    subject: r.subject,
    params: r.params as TeamInsightParams,
    periodStart: r.periodStart,
    status: r.status as TeamInsightRow["status"],
  };
}

const SELECTION = {
  id: teamInsights.id,
  teamId: teamInsights.teamId,
  category: teamInsights.category,
  severity: teamInsights.severity,
  subject: teamInsights.subject,
  params: teamInsights.params,
  periodStart: teamInsights.periodStart,
  status: teamInsights.status,
} as const;

export function teamInsightsNamespace(db: Db, orgId: string) {
  return {
    /**
     * EVERY insight for this org (open + dismissed) — the reducer's batch-once
     * read AND the tenant-isolation sweep's guard. Org-filtered, so a dropped
     * filter deterministically surfaces another org's rows (the sweep detects a
     * leaked team uuid via `teamId`; the row carries no person id).
     */
    async list(): Promise<TeamInsightRow[]> {
      const rows = await db
        .select(SELECTION)
        .from(teamInsights)
        .where(eq(teamInsights.orgId, orgId));
      return rows.map(mapRow);
    },

    /**
     * The OPEN feed (status new|viewed), most-severe first — the dashboard card
     * + the weekly brief read this. Severity ordered attention → opportunity →
     * info via the enum's own order (pg enum sorts by declared order), then
     * newest period. COUNT-ONLY.
     */
    async listOpen(): Promise<TeamInsightRow[]> {
      const rows = await db
        .select(SELECTION)
        .from(teamInsights)
        .where(
          and(
            eq(teamInsights.orgId, orgId),
            ne(teamInsights.status, "dismissed"),
          ),
        )
        .orderBy(
          desc(teamInsights.severity),
          desc(teamInsights.periodStart),
          asc(teamInsights.category),
          asc(teamInsights.subject),
        );
      return rows.map(mapRow);
    },

    /**
     * Mark a `new` insight `viewed` (idempotent: a viewed/dismissed row is
     * untouched). Org-scoped. Used when a manager opens the feed.
     */
    async markViewed(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await db
        .update(teamInsights)
        .set({ status: "viewed", statusChangedAt: new Date() })
        .where(
          and(
            eq(teamInsights.orgId, orgId),
            inArray(teamInsights.id, ids as string[]),
            eq(teamInsights.status, "new"),
          ),
        );
    },

    /**
     * Dismiss ONE open insight (org-scoped). Returns the dismissed row (for the
     * audit metadata) or null if the id is absent/already dismissed — so the
     * caller can 404 rather than silently succeed. A dismissed insight is
     * sticky: the nightly reducer never resurrects it under the same natural
     * key.
     */
    async dismiss(id: string): Promise<TeamInsightRow | null> {
      const [row] = await db
        .update(teamInsights)
        .set({ status: "dismissed", statusChangedAt: new Date() })
        .where(
          and(
            eq(teamInsights.orgId, orgId),
            eq(teamInsights.id, id),
            ne(teamInsights.status, "dismissed"),
          ),
        )
        .returning(SELECTION);
      return row ? mapRow(row) : null;
    },

    /**
     * Reducer step 1: delete the stale open rows whose condition no longer
     * holds (the reducer computes these ids from `list()` — open rows not in the
     * current candidate set). Never targets a dismissed row (the reducer only
     * passes non-dismissed ids). Org-scoped.
     */
    async deleteByIds(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await db
        .delete(teamInsights)
        .where(
          and(
            eq(teamInsights.orgId, orgId),
            inArray(teamInsights.id, ids as string[]),
          ),
        );
    },

    /**
     * Reducer step 2: idempotent natural-key upsert of the current candidate
     * set (≤ MAX_OPEN_INSIGHTS rows). On conflict (org, team, category,
     * subject) it refreshes the count-only params/severity/period ONLY — it
     * NEVER changes status or resurrects a dismissed row (`setWhere status !=
     * 'dismissed'`), so a re-run with the same inputs yields the same open feed
     * (same params → no visible change) and a dismissed subject stays dismissed.
     * New subjects insert as `new`.
     */
    async upsertGenerated(rows: readonly TeamInsightUpsert[]): Promise<void> {
      for (const r of rows) {
        await db
          .insert(teamInsights)
          .values({
            orgId,
            teamId: r.teamId,
            category: r.category,
            severity: r.severity,
            subject: r.subject,
            params: r.params,
            periodStart: r.periodStart,
          })
          .onConflictDoUpdate({
            target: [
              teamInsights.orgId,
              teamInsights.teamId,
              teamInsights.category,
              teamInsights.subject,
            ],
            set: {
              severity: r.severity,
              params: r.params,
              periodStart: r.periodStart,
            },
            setWhere: ne(teamInsights.status, "dismissed"),
          });
      }
    },
  };
}
