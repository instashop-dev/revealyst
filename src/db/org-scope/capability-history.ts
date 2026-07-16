import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../client";
import { teamCapabilityHistory } from "../schema";

// Per-capability team history rollup reads/writes (TCI Phase 2-D, ADR 0046).
// ORG-SCOPED. COUNT-ONLY — no method here ever emits a person id or a per-person
// value (the row shape carries none). The trend read (`list`) returns TRUE stored
// counts; the `MIN_PEOPLE` floor is a RENDER-time rule applied by
// `applyMinPeopleFloor` (src/lib/capability-history.ts), never here — storing
// true counts keeps the series continuous so a later trend stays computable.
//
// The write (`upsertPeriod`) is the poller rollup step's only entry point: an
// idempotent natural-key upsert on (org_id, team_id, capability_slug,
// period_start). A re-delivered/re-run nightly pass for the same period
// overwrites that period's row with the same computed values (same inputs → same
// row); it never appends a duplicate period, and a CLOSED period's row is never
// targeted again (the window has moved to a new period_start).

export type CapabilityHistoryRow = {
  teamId: string | null;
  capabilitySlug: string;
  periodStart: string;
  periodEnd: string;
  representedCount: number;
  totalCount: number;
  masteredCount: number;
  developingCount: number;
  confidenceTier: "measured" | "modeled" | "directional" | "not_measured";
};

export type CapabilityHistoryUpsert = {
  /** NULL = the org-wide series; non-null = a specific team's series. */
  teamId: string | null;
  capabilitySlug: string;
  periodStart: string;
  periodEnd: string;
  representedCount: number;
  totalCount: number;
  masteredCount: number;
  developingCount: number;
  confidenceTier: "measured" | "modeled" | "directional" | "not_measured";
};

export function capabilityHistoryNamespace(db: Db, orgId: string) {
  return {
    /**
     * The trend read: history rows for this org, oldest period first, ready for a
     * per-capability series. COUNT-ONLY (no person data). Optionally narrowed to a
     * capability and/or a period range. Returns TRUE stored counts — the
     * `MIN_PEOPLE` floor is applied by the caller (`applyMinPeopleFloor`), not
     * here. Org-filtered, so a dropped filter deterministically surfaces another
     * org's rows (the tenant-isolation sweep's guard).
     */
    async list(filter?: {
      capabilitySlug?: string;
      teamId?: string | null;
      from?: string;
      to?: string;
    }): Promise<CapabilityHistoryRow[]> {
      const conditions = [eq(teamCapabilityHistory.orgId, orgId)];
      if (filter?.capabilitySlug !== undefined) {
        conditions.push(
          eq(teamCapabilityHistory.capabilitySlug, filter.capabilitySlug),
        );
      }
      if (filter?.teamId !== undefined && filter.teamId !== null) {
        conditions.push(eq(teamCapabilityHistory.teamId, filter.teamId));
      }
      if (filter?.from !== undefined) {
        conditions.push(gte(teamCapabilityHistory.periodStart, filter.from));
      }
      if (filter?.to !== undefined) {
        conditions.push(lte(teamCapabilityHistory.periodStart, filter.to));
      }
      const rows = await db
        .select({
          teamId: teamCapabilityHistory.teamId,
          capabilitySlug: teamCapabilityHistory.capabilitySlug,
          periodStart: teamCapabilityHistory.periodStart,
          periodEnd: teamCapabilityHistory.periodEnd,
          representedCount: teamCapabilityHistory.representedCount,
          totalCount: teamCapabilityHistory.totalCount,
          masteredCount: teamCapabilityHistory.masteredCount,
          developingCount: teamCapabilityHistory.developingCount,
          confidenceTier: teamCapabilityHistory.confidenceTier,
        })
        .from(teamCapabilityHistory)
        .where(and(...conditions))
        .orderBy(
          asc(teamCapabilityHistory.periodStart),
          asc(teamCapabilityHistory.capabilitySlug),
        );
      return rows.map((r) => ({
        ...r,
        confidenceTier: r.confidenceTier as CapabilityHistoryRow["confidenceTier"],
      }));
    },

    /**
     * The rollup writer's entry point: idempotent natural-key upsert of one
     * period's rows. Re-running for the same period overwrites in place (same
     * inputs → same row); it never appends a duplicate. One statement per row on
     * the (org, team, capability, period_start) NULLS-NOT-DISTINCT unique key.
     */
    async upsertPeriod(
      rows: readonly CapabilityHistoryUpsert[],
    ): Promise<void> {
      for (const r of rows) {
        await db
          .insert(teamCapabilityHistory)
          .values({
            orgId,
            teamId: r.teamId,
            capabilitySlug: r.capabilitySlug,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            representedCount: r.representedCount,
            totalCount: r.totalCount,
            masteredCount: r.masteredCount,
            developingCount: r.developingCount,
            confidenceTier: r.confidenceTier,
          })
          .onConflictDoUpdate({
            target: [
              teamCapabilityHistory.orgId,
              teamCapabilityHistory.teamId,
              teamCapabilityHistory.capabilitySlug,
              teamCapabilityHistory.periodStart,
            ],
            set: {
              periodEnd: r.periodEnd,
              representedCount: r.representedCount,
              totalCount: r.totalCount,
              masteredCount: r.masteredCount,
              developingCount: r.developingCount,
              confidenceTier: r.confidenceTier,
            },
          });
      }
    },
  };
}
