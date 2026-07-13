import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { connections, subjects } from "../schema";

/** What Connector.discover() emits — upserted on (connection, kind, external_id). */
export type SubjectDescriptor = {
  kind: (typeof subjects.kind.enumValues)[number];
  externalId: string;
  email?: string | null;
  displayName?: string | null;
  meta?: Record<string, unknown>;
};

export function subjectsNamespace(db: Db, orgId: string) {
  return {
    /**
     * Idempotent discover() sink: upserts on (connection, kind,
     * external_id), refreshing mutable fields and last_seen_at. The
     * composite (org_id, connection_id) FK rejects cross-org INSERTs, but
     * the ON CONFLICT update path never re-checks the FK — hence the
     * ownership pre-check and the org-guarded setWhere below (same
     * pattern as storeCredential).
     */
    async upsertMany(connectionId: string, descriptors: SubjectDescriptor[]) {
      const [owned] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(eq(connections.orgId, orgId), eq(connections.id, connectionId)),
        );
      if (!owned) {
        throw new Error(`connection ${connectionId} not found in org`);
      }
      // Batched multi-row upsert (ADR 0003): one round-trip per ~500
      // descriptors instead of one per row — backfill chunks feed this
      // whole-org member lists. Dedupe on the conflict key first: one
      // INSERT may not touch the same row twice ("cannot affect row a
      // second time"); the last descriptor wins, matching the old
      // sequential-loop semantics.
      const byConflictKey = new Map<string, SubjectDescriptor>();
      for (const d of descriptors) {
        byConflictKey.set(`${d.kind}:${d.externalId}`, d);
      }
      const rows = [];
      const deduped = [...byConflictKey.values()];
      const BATCH = 500;
      for (let i = 0; i < deduped.length; i += BATCH) {
        const slice = deduped.slice(i, i + BATCH);
        const inserted = await db
          .insert(subjects)
          .values(
            slice.map((d) => ({
              orgId,
              connectionId,
              kind: d.kind,
              externalId: d.externalId,
              email: d.email?.toLowerCase() ?? null,
              displayName: d.displayName ?? null,
              meta: d.meta ?? {},
            })),
          )
          .onConflictDoUpdate({
            target: [subjects.connectionId, subjects.kind, subjects.externalId],
            set: {
              email: sql`excluded.email`,
              displayName: sql`excluded.display_name`,
              meta: sql`excluded.meta`,
              lastSeenAt: new Date(),
            },
            // Belt-and-braces on top of the ownership check above.
            setWhere: eq(subjects.orgId, orgId),
          })
          .returning();
        rows.push(...inserted);
      }
      return rows;
    },

    async list(filter?: { connectionId?: string }) {
      const where = filter?.connectionId
        ? and(
            eq(subjects.orgId, orgId),
            eq(subjects.connectionId, filter.connectionId),
          )
        : eq(subjects.orgId, orgId);
      return db
        .select()
        .from(subjects)
        .where(where)
        .orderBy(subjects.firstSeenAt);
    },

    async get(id: string) {
      const [row] = await db
        .select()
        .from(subjects)
        .where(and(eq(subjects.orgId, orgId), eq(subjects.id, id)));
      return row;
    },
  };
}
