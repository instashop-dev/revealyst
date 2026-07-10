import { and, desc, eq, exists, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  auditLog,
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
 * liveness probe. Returns null before the first tick. `limit 1` on the
 * `poll_heartbeats_observed_at_idx` index (W4-Q, ADR 0019) is a cheap top-N;
 * heartbeat retention (purgeExpiredRetention) keeps the table bounded too.
 * System-level telemetry (poller liveness, not tenant data), so it reads
 * across the table like the other jobs here.
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
  const { deleted } = await batchedDelete(
    (limit) =>
      db
        .select({ id: rawPayloads.id })
        .from(rawPayloads)
        .where(lt(rawPayloads.expiresAt, sql`now()`))
        .limit(limit),
    (ids) =>
      db
        .delete(rawPayloads)
        .where(inArray(rawPayloads.id, ids))
        .then(() => {}),
    { batchSize, maxBatches },
  );
  return deleted;
}

// ---------------------------------------------------------------------------
// Retention (W4-Q, ADR 0019). Three append-only operational logs grow without
// bound today (raw_payloads is the only table with a purge). These jobs age
// them out on documented windows. All run system-level (cross-org telemetry,
// not tenant data — raw access is allowed only inside src/db/**) from the
// nightly cron via the "purge-retention" queue message, and every delete is
// batched/bounded so no single run can exceed the Workers CPU budget, exactly
// like purgeExpiredRawPayloads above.
//
// Windows are ops decisions (no compliance floor promises any of these — the
// only stated retention promise, raw payloads ~90d, is honored by the separate
// purgeExpiredRawPayloads job): audit trails are low-volume and security-
// relevant, so they get a full year; poll heartbeats are pure liveness
// telemetry where only the newest row is ever read, so 30 days is ample;
// connector-run history backs the "last synced" surface and the backfill audit
// trail, so 90 days aligns with the raw-payload window.
export const AUDIT_LOG_RETENTION_DAYS = 365;
export const POLL_HEARTBEATS_RETENTION_DAYS = 30;
export const CONNECTOR_RUNS_RETENTION_DAYS = 90;

/** Cutoff = `now` minus `days`, as a JS Date. Passed as a bound parameter so
 * retention is deterministic under test (inject `now`) rather than depending on
 * the DB clock. */
function cutoffDaysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Select-ids-then-delete-by-ids in bounded batches (Postgres has no
 * `DELETE ... LIMIT`). The caller supplies the two org-agnostic closures; this
 * loop bounds the work per run. `capped` is true when the loop exhausted
 * `maxBatches` on a still-full final batch — i.e. more expired rows likely
 * remain and the caller should run again — so a run can never exceed the
 * Workers CPU budget yet a backlog still drains across successive runs.
 */
async function batchedDelete(
  selectExpiredIds: (limit: number) => Promise<Array<{ id: string }>>,
  deleteByIds: (ids: string[]) => Promise<void>,
  { batchSize, maxBatches }: { batchSize: number; maxBatches: number },
): Promise<{ deleted: number; capped: boolean }> {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const expired = await selectExpiredIds(batchSize);
    if (expired.length === 0) {
      return { deleted, capped: false };
    }
    await deleteByIds(expired.map((r) => r.id));
    deleted += expired.length;
    if (expired.length < batchSize) {
      return { deleted, capped: false };
    }
  }
  // Ran every batch on full batches — more likely remain.
  return { deleted, capped: true };
}

export type RetentionResult = {
  auditLog: number;
  pollHeartbeats: number;
  connectorRuns: number;
  /** True when any table hit its per-run batch cap — the caller should
   * re-run to drain the remaining backlog (src/poller/process.ts re-enqueues
   * a fresh purge-retention message). */
  capped: boolean;
};

/**
 * Ages out expired rows from the three operational logs on their retention
 * windows, in bounded batches. Returns per-table delete counts; callers may
 * re-enqueue while any count came back a full multiple of its batch cap for a
 * deeper sweep (steady state deletes only the trickle crossing the cutoff).
 *
 * connector_runs is purged for `kind = 'poll'` ONLY: `backfillStarted` in
 * src/poller/dispatch.ts is derived from the mere EXISTENCE of a `backfill`
 * run per connection, so deleting a connection's last backfill row would make
 * the dispatcher re-trigger a full backfill. Backfill rows are a handful per
 * connection lifetime (bounded already); poll rows are the high-volume ones.
 */
export async function purgeExpiredRetention(
  db: Db,
  {
    now = new Date(),
    batchSize = 5000,
    maxBatches = 4,
  }: { now?: Date; batchSize?: number; maxBatches?: number } = {},
): Promise<RetentionResult> {
  const batchOpts = { batchSize, maxBatches };

  const auditCutoff = cutoffDaysAgo(now, AUDIT_LOG_RETENTION_DAYS);
  const audit = await batchedDelete(
    (limit) =>
      db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(lt(auditLog.createdAt, auditCutoff))
        .limit(limit),
    (ids) => db.delete(auditLog).where(inArray(auditLog.id, ids)).then(() => {}),
    batchOpts,
  );

  const heartbeatCutoff = cutoffDaysAgo(now, POLL_HEARTBEATS_RETENTION_DAYS);
  const heartbeat = await batchedDelete(
    (limit) =>
      db
        .select({ id: pollHeartbeats.id })
        .from(pollHeartbeats)
        .where(lt(pollHeartbeats.observedAt, heartbeatCutoff))
        .limit(limit),
    (ids) =>
      db
        .delete(pollHeartbeats)
        .where(inArray(pollHeartbeats.id, ids))
        .then(() => {}),
    batchOpts,
  );

  const connectorCutoff = cutoffDaysAgo(now, CONNECTOR_RUNS_RETENTION_DAYS);
  const connector = await batchedDelete(
    (limit) =>
      db
        .select({ id: connectorRuns.id })
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.kind, "poll"),
            lt(connectorRuns.startedAt, connectorCutoff),
          ),
        )
        .limit(limit),
    (ids) =>
      db
        .delete(connectorRuns)
        .where(inArray(connectorRuns.id, ids))
        .then(() => {}),
    batchOpts,
  );

  return {
    auditLog: audit.deleted,
    pollHeartbeats: heartbeat.deleted,
    connectorRuns: connector.deleted,
    capped: audit.capped || heartbeat.capped || connector.capped,
  };
}
