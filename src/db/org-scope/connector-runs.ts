import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { connectorRuns } from "../schema";

export function connectorRunsNamespace(db: Db, orgId: string) {
  return {
    /**
     * Opens a run row (status "running") before any vendor I/O, so a
     * consumer killed mid-run leaves visible evidence. The composite
     * (org_id, connection_id) FK rejects cross-org connections.
     */
    async start(input: {
      connectionId: string;
      kind: (typeof connectorRuns.kind.enumValues)[number];
      windowStart?: string | null;
      windowEnd?: string | null;
      attempt?: number;
    }) {
      const [row] = await db
        .insert(connectorRuns)
        .values({
          orgId,
          connectionId: input.connectionId,
          kind: input.kind,
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          attempt: input.attempt ?? 1,
        })
        .returning();
      return row;
    },

    async finish(
      id: string,
      result: {
        subjectsSeen: number;
        recordsUpserted: number;
        signalsUpserted: number;
        gaps: unknown[];
      },
    ) {
      const [row] = await db
        .update(connectorRuns)
        .set({
          status: "success",
          subjectsSeen: result.subjectsSeen,
          recordsUpserted: result.recordsUpserted,
          signalsUpserted: result.signalsUpserted,
          gaps: result.gaps,
          finishedAt: new Date(),
        })
        .where(and(eq(connectorRuns.orgId, orgId), eq(connectorRuns.id, id)))
        .returning();
      return row;
    },

    async fail(id: string, error: string) {
      const [row] = await db
        .update(connectorRuns)
        .set({ status: "error", error, finishedAt: new Date() })
        .where(and(eq(connectorRuns.orgId, orgId), eq(connectorRuns.id, id)))
        .returning();
      return row;
    },

    async list(filter?: { connectionId?: string; limit?: number }) {
      const where = filter?.connectionId
        ? and(
            eq(connectorRuns.orgId, orgId),
            eq(connectorRuns.connectionId, filter.connectionId),
          )
        : eq(connectorRuns.orgId, orgId);
      return db
        .select()
        .from(connectorRuns)
        .where(where)
        .orderBy(desc(connectorRuns.startedAt))
        .limit(filter?.limit ?? 100);
    },

    /** Latest run for a connection — the "last synced 2h ago" query. */
    async latest(connectionId: string) {
      const [row] = await db
        .select()
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.orgId, orgId),
            eq(connectorRuns.connectionId, connectionId),
          ),
        )
        .orderBy(desc(connectorRuns.startedAt))
        .limit(1);
      return row;
    },
  };
}
