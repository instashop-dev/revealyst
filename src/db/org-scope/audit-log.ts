import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../client";
import { auditLog } from "../schema";

// Append-only accountability trail (ADR 0010): record + list only — no
// update, no delete. metadata must stay small and non-sensitive (ids and
// short labels; never credentials, tokens, or vendor payloads).
export function auditLogNamespace(db: Db, orgId: string) {
  return {
    async record(input: {
      /** Null only when the caller genuinely has no session user. */
      actorUserId: string | null;
      action: string;
      targetKind: string;
      targetId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const [row] = await db
        .insert(auditLog)
        .values({
          orgId,
          actorUserId: input.actorUserId,
          action: input.action,
          targetKind: input.targetKind,
          targetId: input.targetId ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      return row;
    },

    /**
     * Newest-first page. Cursor = the LAST entry of the previous page:
     * pass its (createdAt, id) as (before, beforeId) — exclusive compound
     * cursor, so pages never repeat the boundary row and never loop when
     * many rows share a timestamp (e.g. a batch action in one tx, where
     * now() ties exactly). `before` alone (no beforeId) is exclusive on
     * createdAt and can skip same-timestamp rows — always pass both when
     * walking pages.
     */
    async list(filter?: { limit?: number; before?: Date; beforeId?: string }) {
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
      const cursor = filter?.before
        ? filter.beforeId
          ? or(
              lt(auditLog.createdAt, filter.before),
              and(
                eq(auditLog.createdAt, filter.before),
                lt(auditLog.id, filter.beforeId),
              ),
            )
          : lt(auditLog.createdAt, filter.before)
        : undefined;
      return db
        .select()
        .from(auditLog)
        .where(
          cursor ? and(eq(auditLog.orgId, orgId), cursor) : eq(auditLog.orgId, orgId),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit);
    },
  };
}
