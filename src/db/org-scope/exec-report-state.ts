import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { execReportState } from "../schema";

// Monthly executive-report send state (W6-F, ADR 0031). ONE row per org holding
// both the workspace-level opt-in toggle and the month-keyed idempotency
// high-water mark. `get` reads it, `setEnabled` is the Settings toggle, and
// `claimMonth` is the compare-and-set the monthly sender uses to email each
// month's memo exactly once per org. There is no report CONTENT here — that is
// composed at send time from the maturity/spend/attribution reads; this table
// stores only the toggle + the de-dup marker, mirroring
// budget_alert_state.claimThreshold and digest_preferences.claimWeekAndRotateToken.
export function execReportStateNamespace(db: Db, orgId: string) {
  return {
    /** This org's send-state/settings row, or undefined if none yet. */
    async get() {
      const [row] = await db
        .select()
        .from(execReportState)
        .where(eq(execReportState.orgId, orgId));
      return row;
    },

    /**
     * Opt the whole workspace in or out of the monthly executive memo (the
     * Settings toggle). Upserts on the (org_id) constraint so a second call
     * flips the flag rather than failing — one row per org by construction.
     * Leaves `last_sent_month` untouched (an org that re-enables mid-month
     * still gets that month's memo on the next cron, since it was never
     * claimed while disabled). Returns the stored row.
     */
    async setEnabled(enabled: boolean) {
      const [row] = await db
        .insert(execReportState)
        .values({ orgId, execReportEnabled: enabled })
        .onConflictDoUpdate({
          target: [execReportState.orgId],
          set: { execReportEnabled: enabled, updatedAt: new Date() },
        })
        .returning();
      return row;
    },

    /**
     * Claim `monthKey` ("YYYY-MM", UTC) for this org as one atomic
     * compare-and-set — the idempotency pattern. Upserts the row and advances
     * `last_sent_month` to `monthKey` ONLY when the workspace is enabled AND
     * the stored month is not already `monthKey`. Returns `true` when this call
     * won the claim (the caller then sends the memo) and `false` when it lost:
     *  - an at-least-once poll redelivery for a month already sent, OR
     *  - a workspace that has opted out (`exec_report_enabled = false`).
     * Because the claim precedes the send (claim-then-send), a crash mid-send
     * under-delivers (safe) rather than re-mailing on the next poll.
     *
     * The `setWhere` guard also covers the INSERT path: a fresh row is created
     * with `exec_report_enabled` defaulting to true, so a never-seen org claims
     * on its first cron; a disabled org already has a row with the flag false,
     * so the conflict branch's `setWhere` blocks it.
     */
    async claimMonth(monthKey: string): Promise<boolean> {
      const [row] = await db
        .insert(execReportState)
        .values({ orgId, lastSentMonth: monthKey })
        .onConflictDoUpdate({
          target: [execReportState.orgId],
          set: { lastSentMonth: monthKey, updatedAt: new Date() },
          // Advance only for an enabled workspace that hasn't sent this month:
          // a disabled org (flag false) or a redelivery (same month) leaves the
          // row untouched and returns no row.
          setWhere: and(
            eq(execReportState.execReportEnabled, true),
            sql`${execReportState.lastSentMonth} is distinct from ${monthKey}`,
          ),
        })
        .returning({ id: execReportState.id });
      return row !== undefined;
    },
  };
}
