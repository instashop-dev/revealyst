import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { benchmarkConsent } from "./schema";

// Anonymized-benchmark contribution consent (ADR 0008). Org-scoped factory
// beside org-scope.ts. One row per (org, user); set() upserts on the composite
// unique. Records consent only — it promises nothing and gates no aggregation
// yet (the V3 network reads it later, W3-N).

export function benchmarkConsentForOrg(db: Db, orgId: string) {
  return {
    /** This user's consent row for this org, or undefined if never set. */
    async get(userId: string) {
      const [row] = await db
        .select()
        .from(benchmarkConsent)
        .where(
          and(
            eq(benchmarkConsent.orgId, orgId),
            eq(benchmarkConsent.userId, userId),
          ),
        );
      return row;
    },

    /** All consent rows for this org (admin surface / isolation sweep). */
    async list() {
      return db
        .select()
        .from(benchmarkConsent)
        .where(eq(benchmarkConsent.orgId, orgId));
    },

    /** Records (or updates) this user's consent — upsert on (org, user). */
    async set(userId: string, granted: boolean) {
      const [row] = await db
        .insert(benchmarkConsent)
        .values({ orgId, userId, granted })
        .onConflictDoUpdate({
          target: [benchmarkConsent.orgId, benchmarkConsent.userId],
          set: { granted, updatedAt: new Date() },
        })
        .returning();
      return row;
    },
  };
}
