import { and, desc, eq, exists, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  connectionCredentials,
  connections,
  connectorRuns,
  orgs,
  pollHeartbeats,
  rawPayloads,
  subscriptions,
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

/** Enumerates org ids for cross-org fan-out (one queue message per org —
 * e.g. the nightly score recompute). Enumeration is the only cross-org read;
 * all per-org work goes back through forOrg. */
export async function listOrgIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: orgs.id }).from(orgs);
  return rows.map((r) => r.id);
}

/**
 * Candidates for connector work across all orgs — the Cron dispatcher's
 * one cross-org read (system-level by design; per-org writes then go
 * through forOrg). A connection qualifies once it has a stored credential
 * (nothing to poll with otherwise) and is not paused. Errored connections
 * STAY candidates (ADR 0006): that is the self-heal path — the next
 * successful poll re-activates them via markPolled, so a transient vendor
 * or DB failure never permanently halts ingestion. A wrong credential
 * costs one visibly-failed run per interval until the user fixes it.
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
        inArray(connections.status, ["pending", "active", "error"]),
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
 * Subscriptions to meter this cycle (W3-M PR5) — the metering dispatcher's one
 * cross-org read. Only `active`/`trialing` subscriptions are metered: a
 * `past_due` sub is in dunning (don't adjust seats mid-collection), and
 * `paused`/`canceled` grant no access. Per-org counting then goes back through
 * forOrg. System-level by design, like the other reads here.
 */
export async function listSubscriptionsToMeter(
  db: Db,
): Promise<Array<{ orgId: string; paddleSubscriptionId: string; priceId: string }>> {
  return db
    .select({
      orgId: subscriptions.orgId,
      paddleSubscriptionId: subscriptions.paddleSubscriptionId,
      priceId: subscriptions.priceId,
    })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["active", "trialing"]));
}

/**
 * Per-org count of credential rows still wrapped under a non-current KEK —
 * the rotation driver's dry-run (scripts/rotate-kek.ts). System-level by
 * design, like the other cross-org reads here; raw access is allowed only
 * inside src/db/**.
 */
export async function countCredentialsNeedingRewrap(
  db: Db,
  targetKekVersion: string,
): Promise<Array<{ orgId: string; count: number }>> {
  const rows = await db
    .select({
      orgId: connectionCredentials.orgId,
      count: sql<number>`count(*)::int`,
    })
    .from(connectionCredentials)
    .where(ne(connectionCredentials.kekVersion, targetKekVersion))
    .groupBy(connectionCredentials.orgId);
  return rows;
}

/**
 * The most recent poll heartbeat's timestamp (the cron → queue → consumer →
 * Postgres round-trip proven by the no-op poller), for the /api/health
 * liveness probe. Returns null before the first tick. `limit 1` keeps the
 * result tiny, but poll_heartbeats has no index on observed_at yet and is
 * never purged, so this is a seqscan + top-N that grows with the log —
 * negligible at current volume; a follow-up adds an observed_at index +
 * heartbeat retention. System-level telemetry (poller liveness, not tenant
 * data), so it reads across the table like the other jobs here.
 */
export async function latestHeartbeatAt(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ observedAt: pollHeartbeats.observedAt })
    .from(pollHeartbeats)
    .orderBy(desc(pollHeartbeats.observedAt))
    .limit(1);
  return row?.observedAt ?? null;
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
