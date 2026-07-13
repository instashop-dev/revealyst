import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { rawPayloads } from "../schema";

export type RawPayloadInsert = {
  connectionId: string;
  vendor: string;
  kind: string;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  payload: unknown;
};

export function rawNamespace(db: Db, orgId: string) {
  return {
    /** Lands a fetched vendor payload; returns the row (its id becomes
     * metric_records.raw_payload_id). */
    async insert(input: RawPayloadInsert) {
      const [row] = await db
        .insert(rawPayloads)
        .values({
          orgId,
          connectionId: input.connectionId,
          vendor: input.vendor,
          kind: input.kind,
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          payload: input.payload,
        })
        .returning();
      return row;
    },

    async get(id: string) {
      const [row] = await db
        .select()
        .from(rawPayloads)
        .where(and(eq(rawPayloads.orgId, orgId), eq(rawPayloads.id, id)));
      return row;
    },
  };
}
