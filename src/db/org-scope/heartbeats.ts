import { and, eq, type SQL } from "drizzle-orm";
import type { Db } from "../client";
import { pollHeartbeats } from "../schema";

export function heartbeatsNamespace(db: Db, orgId: string) {
  return {
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
  };
}
