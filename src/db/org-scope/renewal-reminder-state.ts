import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { renewalReminderState } from "../schema";

// Renewal-reminder send-state (W6-G, ADR 0032). One row per (connection,
// renewal_date, threshold) — `claim` is the insert-if-absent compare-and-set
// the reminder cron uses to fire each T-30/T-7 reminder exactly once, and
// `list` is the org-scoped read the tenant-isolation sweep exercises. There is
// no renewal DATE here (that is the user-entered `connections.renewal_date`
// column); this table stores only the de-dup high-water mark, mirroring
// budgetAlertState.claimThreshold.
export function renewalReminderStateNamespace(db: Db, orgId: string) {
  return {
    /** Every reminder-state row for this org (tenant-isolation sweep + tests). */
    async list() {
      return db
        .select()
        .from(renewalReminderState)
        .where(eq(renewalReminderState.orgId, orgId));
    },

    /**
     * Claim (`connectionId`, `renewalDate`, `threshold`) as one atomic
     * insert-if-absent — the reminder de-dup CAS. Returns `true` when THIS call
     * inserted the row (won the claim → the caller sends the email) and `false`
     * when a row already existed: an at-least-once cron redelivery, or the same
     * threshold already fired for this exact date → no second email. Because the
     * claim precedes the send (claim-then-send), a crash mid-send under-delivers
     * (safe) rather than re-reminding on the next daily scan.
     *
     * The date is part of the key on purpose: editing a connection's
     * user-entered renewal date changes the key, so the new date re-arms both
     * thresholds (a genuinely new renewal cycle) while the old date's rows stay
     * inert. The composite tenant FK (org_id, connection_id) makes a claim for a
     * foreign connection unrepresentable at the DB level.
     */
    async claim(
      connectionId: string,
      renewalDate: string,
      threshold: number,
    ): Promise<boolean> {
      const rows = await db
        .insert(renewalReminderState)
        .values({ orgId, connectionId, renewalDate, threshold })
        .onConflictDoNothing({
          target: [
            renewalReminderState.connectionId,
            renewalReminderState.renewalDate,
            renewalReminderState.threshold,
          ],
        })
        .returning({ id: renewalReminderState.id });
      return rows.length > 0;
    },
  };
}
