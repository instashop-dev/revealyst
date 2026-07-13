import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { budgetAlertState } from "../schema";

// Budget-alert crossing state (W5-I, ADR 0029). One row per (org, month) —
// `get` reads it, `claimThreshold` is the compare-and-set the budget-alert
// EMAIL sender uses to fire each threshold exactly once per month. There is no
// spend or budget config here (that lives in `budgets` + metric_records);
// this repo stores only the de-dup high-water mark, mirroring
// digest_preferences.claimWeekAndRotateToken.
export function budgetAlertStateNamespace(db: Db, orgId: string) {
  return {
    /** This org's crossing-state row for `monthKey` ("YYYY-MM"), or undefined. */
    async get(monthKey: string) {
      const [row] = await db
        .select()
        .from(budgetAlertState)
        .where(
          and(
            eq(budgetAlertState.orgId, orgId),
            eq(budgetAlertState.monthKey, monthKey),
          ),
        );
      return row;
    },

    /**
     * Claim `threshold` (a percent-of-budget crossing) for (`orgId`, `monthKey`)
     * as one atomic compare-and-set — the metering/idempotency pattern. Upserts
     * the row and advances `highest_alerted_threshold` to `threshold` ONLY when
     * the stored value is strictly lower (a fresh row starts at the default 0).
     * Returns `true` when this call won the claim (row inserted or advanced) —
     * the caller then sends the email — and `false` when it lost: an
     * at-least-once poll redelivery that re-crossed a threshold already emailed
     * this month, so no second email. Because the claim precedes the send
     * (claim-then-send), a crash mid-send under-delivers (safe) rather than
     * re-alerting on the next poll.
     */
    async claimThreshold(monthKey: string, threshold: number): Promise<boolean> {
      const [row] = await db
        .insert(budgetAlertState)
        .values({ orgId, monthKey, highestAlertedThreshold: threshold })
        .onConflictDoUpdate({
          target: [budgetAlertState.orgId, budgetAlertState.monthKey],
          set: { highestAlertedThreshold: threshold, updatedAt: new Date() },
          // Only advance upward: a re-crossed or lower threshold that already
          // alerted this month leaves the row untouched and returns no row.
          setWhere: sql`${budgetAlertState.highestAlertedThreshold} < ${threshold}`,
        })
        .returning({ id: budgetAlertState.id });
      return row !== undefined;
    },
  };
}
