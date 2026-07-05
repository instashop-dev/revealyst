import { and, eq, exists, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  connectionCredentials,
  connections,
  connectorRuns,
  orgs,
  rawPayloads,
} from "./schema";

// System-level maintenance jobs. These run across orgs by design (raw
// access is allowed only inside src/db/**) and are invoked from the queue
// consumer — never from request handlers.

/** Idempotently ensures the system org exists (safe under concurrent
 * consumers). Lives here so schema imports stay inside src/db/**. */
export async function ensureSystemOrg(
  db: Db,
  id: string,
  name: string,
): Promise<void> {
  await db
    .insert(orgs)
    .values({ id, name, kind: "system" })
    .onConflictDoNothing({ target: orgs.id });
}

/**
 * Candidates for connector work across all orgs — the Cron dispatcher's
 * one cross-org read (system-level by design; per-org writes then go
 * through forOrg). A connection qualifies once it is pending/active AND
 * has at least one stored credential (nothing to poll with otherwise).
 * Dueness policy (per-vendor intervals, backfill windows) stays in
 * src/poller/dispatch.ts — this module only reports state.
 */
export type ConnectorWorkCandidate = {
  orgId: string;
  connectionId: string;
  vendor: string;
  lastPolledAt: Date | null;
  /** True once any backfill run row exists (started counts — resume is
   * driven by the queue cursor chain, not by re-dispatch). */
  backfillStarted: boolean;
};

export async function listConnectorWorkCandidates(
  db: Db,
): Promise<ConnectorWorkCandidate[]> {
  const rows = await db
    .select({
      orgId: connections.orgId,
      connectionId: connections.id,
      vendor: connections.vendor,
      lastPolledAt: connections.lastPolledAt,
    })
    .from(connections)
    .where(
      and(
        inArray(connections.status, ["pending", "active"]),
        exists(
          db
            .select({ one: sql`1` })
            .from(connectionCredentials)
            .where(eq(connectionCredentials.connectionId, connections.id)),
        ),
      ),
    );
  if (rows.length === 0) {
    return [];
  }
  const backfilled = await db
    .selectDistinct({ connectionId: connectorRuns.connectionId })
    .from(connectorRuns)
    .where(eq(connectorRuns.kind, "backfill"));
  const started = new Set(backfilled.map((r) => r.connectionId));
  return rows.map((r) => ({
    ...r,
    backfillStarted: started.has(r.connectionId),
  }));
}

/**
 * Ages out expired raw payloads in bounded batches (Workers 30s CPU
 * budget). metric_records.raw_payload_id is ON DELETE SET NULL, so aged
 * facts keep their values and lose only the replay reference — after this,
 * recompute is score-only (the stated trade-off).
 *
 * Returns the number of rows deleted; callers re-enqueue while the batch
 * came back full if they want a deeper sweep.
 */
export async function purgeExpiredRawPayloads(
  db: Db,
  { batchSize = 5000, maxBatches = 4 } = {},
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const expired = await db
      .select({ id: rawPayloads.id })
      .from(rawPayloads)
      .where(lt(rawPayloads.expiresAt, sql`now()`))
      .limit(batchSize);
    if (expired.length === 0) {
      break;
    }
    await db.delete(rawPayloads).where(
      inArray(
        rawPayloads.id,
        expired.map((r) => r.id),
      ),
    );
    deleted += expired.length;
    if (expired.length < batchSize) {
      break;
    }
  }
  return deleted;
}
