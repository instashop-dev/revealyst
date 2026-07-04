import { and, eq, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { pollHeartbeats } from "./schema";

/**
 * Org-scoped repository layer — the tenancy rule's enforcement point.
 *
 * Every query in application code goes through `forOrg(db, orgId)`; raw
 * table access outside this module is a review-blocker (CLAUDE.md). W0-C
 * freezes the full contract (RLS or this layer, decided there); this is
 * the walking-skeleton version proving the shape: the org filter is
 * applied inside the layer, so call sites cannot forget it.
 */
export function forOrg(db: Db, orgId: string) {
  return {
    orgId,

    heartbeats: {
      async record(source = "noop-poller") {
        const [row] = await db
          .insert(pollHeartbeats)
          .values({ orgId, source })
          .returning();
        return row;
      },

      async list(where?: SQL) {
        return db
          .select()
          .from(pollHeartbeats)
          .where(
            where
              ? and(eq(pollHeartbeats.orgId, orgId), where)
              : eq(pollHeartbeats.orgId, orgId),
          )
          .orderBy(pollHeartbeats.observedAt);
      },
    },
  };
}

export type OrgScopedDb = ReturnType<typeof forOrg>;
