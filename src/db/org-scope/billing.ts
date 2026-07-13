import { and, eq, gte, lte } from "drizzle-orm";
import {
  countTrackedUsers,
  type BillingPeriod,
} from "../../contracts/tracked-user";
import type { Db } from "../client";
import { identities, metricRecords } from "../schema";

export function billingNamespace(db: Db, orgId: string) {
  return {
    /**
     * The tracked_user billing primitive (frozen; see
     * src/contracts/tracked-user.ts for the definition). Semantics live
     * in the pure countTrackedUsers — this method only supplies the
     * org-scoped inputs, so DB and pure paths cannot diverge.
     */
    async trackedUsers(period: BillingPeriod) {
      // activeSubjectDays and identityRows hit unrelated tables with no
      // data dependency between them — run in parallel (ADR 0017).
      const [activeSubjectDays, identityRows] = await Promise.all([
        db
          .selectDistinct({
            subjectId: metricRecords.subjectId,
            day: metricRecords.day,
          })
          .from(metricRecords)
          .where(
            and(
              eq(metricRecords.orgId, orgId),
              gte(metricRecords.day, period.start),
              lte(metricRecords.day, period.end),
            ),
          ),
        db
          .select({
            subjectId: identities.subjectId,
            personId: identities.personId,
          })
          .from(identities)
          .where(eq(identities.orgId, orgId)),
      ]);
      return countTrackedUsers({
        identities: identityRows,
        activeSubjectDays,
        period,
      });
    },
  };
}
