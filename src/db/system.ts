import { and, count, desc, eq, exists, inArray, lt, min, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import type { OrgFunnelRow } from "../lib/launch-funnel";
import {
  auditLog,
  connectionCredentials,
  connections,
  connectorRuns,
  invites,
  orgMembers,
  orgs,
  pollHeartbeats,
  rawPayloads,
  recInteractionState,
  recommendationExposure,
  scoreResults,
  shareLinks,
  subscriptions,
  user,
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
 * The display name of one org, for the monthly executive memo (W6-F). A
 * cron-path read that personalizes the composed memo ("… for <orgName>"); the
 * org row is not otherwise readable from the poller (org-scope's `org`
 * namespace has no `get`). System-level like the other cross-org reads here —
 * invoked from the queue consumer, never a request handler. Returns null when
 * the org row is gone.
 */
export async function readOrgName(
  db: Db,
  orgId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Weekly-digest recipients for one org (F2.2). Returns the org's admin members
 * with a VERIFIED email — the only people the digest is ever sent to — plus the
 * total member count so the sender can pick the lane (single member = personal
 * lane, multiple = aggregate-only team lane) and resolve the absent-row default.
 *
 * System-level by design (it joins the auth `user` table, which is read outside
 * src/db only via the org-scope seam) and invoked from the queue consumer, like
 * the other cross-org reads here. Never sends to an unverified address: an
 * admin who hasn't confirmed their email is excluded from `recipients` but
 * still counted in `memberCount`.
 */
export async function listDigestRecipients(
  db: Db,
  orgId: string,
): Promise<{
  recipients: Array<{ userId: string; email: string }>;
  memberCount: number;
}> {
  const rows = await db
    .select({
      userId: orgMembers.userId,
      role: orgMembers.role,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(orgMembers)
    .innerJoin(user, eq(orgMembers.userId, user.id))
    .where(eq(orgMembers.orgId, orgId));
  const recipients = rows
    .filter((r) => r.role === "admin" && r.emailVerified)
    .map((r) => ({ userId: r.userId, email: r.email }));
  return { recipients, memberCount: rows.length };
}

/**
 * Every non-system org's funnel row for the §14 flywheel report (W5-I) — the
 * scheduled weekly funnel's one cross-org read, mirroring the manual
 * scripts/launch-metrics.ts gather (same anchors: first-connection,
 * first-SUCCESSFUL-backfill for time-to-first-insight, score-row EXISTENCE for
 * activation — never score_results.computed_at, which the nightly recompute
 * rewrites; see src/lib/launch-funnel.ts). System-level by design (cross-org
 * aggregate, not an application query surface); the pure derivation +
 * privacy-safe reporting happen in the poller. One flat Promise.all.
 */
export async function readLaunchFunnelRows(db: Db): Promise<OrgFunnelRow[]> {
  const orgRows = await db
    .select({ id: orgs.id, kind: orgs.kind, createdAt: orgs.createdAt })
    .from(orgs)
    .where(ne(orgs.kind, "system"));

  const [conn, backfill, score, share, members, invited] = await Promise.all([
    db
      .select({ orgId: connections.orgId, at: min(connections.createdAt) })
      .from(connections)
      .groupBy(connections.orgId),
    db
      .select({ orgId: connectorRuns.orgId, at: min(connectorRuns.finishedAt) })
      .from(connectorRuns)
      .where(
        and(
          eq(connectorRuns.kind, "backfill"),
          eq(connectorRuns.status, "success"),
        ),
      )
      .groupBy(connectorRuns.orgId),
    db
      .select({ orgId: scoreResults.orgId })
      .from(scoreResults)
      .groupBy(scoreResults.orgId),
    db
      .select({ orgId: shareLinks.orgId, n: count() })
      .from(shareLinks)
      .groupBy(shareLinks.orgId),
    db
      .select({ orgId: orgMembers.orgId, n: count() })
      .from(orgMembers)
      .groupBy(orgMembers.orgId),
    db
      .select({
        orgId: invites.orgId,
        sent: count(),
        accepted:
          sql<number>`count(*) filter (where ${invites.acceptedAt} is not null)`.mapWith(
            Number,
          ),
      })
      .from(invites)
      .groupBy(invites.orgId),
  ]);

  const byOrg = <T extends { orgId: string }>(list: T[]) =>
    new Map(list.map((r) => [r.orgId, r]));
  const connBy = byOrg(conn);
  const backfillBy = byOrg(backfill);
  const scoredOrgs = new Set(score.map((r) => r.orgId));
  const shareBy = byOrg(share);
  const membersBy = byOrg(members);
  const invitedBy = byOrg(invited);

  return orgRows.map((o) => ({
    orgId: o.id,
    kind: o.kind as "personal" | "team",
    createdAt: o.createdAt,
    firstConnectionAt: connBy.get(o.id)?.at ?? null,
    firstBackfillSuccessAt: backfillBy.get(o.id)?.at ?? null,
    hasScore: scoredOrgs.has(o.id),
    shareLinks: shareBy.get(o.id)?.n ?? 0,
    members: membersBy.get(o.id)?.n ?? 0,
    invitesSent: invitedBy.get(o.id)?.sent ?? 0,
    invitesAccepted: invitedBy.get(o.id)?.accepted ?? 0,
  }));
}

/**
 * Verified emails of the platform admins the §14 flywheel report is sent to
 * (W5-I). Platform staff = `user.role === "admin"` OR an id in `ADMIN_USER_IDS`
 * (the bootstrap path — src/lib/admin-access.ts). Only VERIFIED addresses are
 * returned (never mail an unconfirmed address, like the digest). System-level:
 * the report is a founder-facing aggregate, not tenant data.
 */
export async function listPlatformAdminRecipients(
  db: Db,
  adminUserIds: string[],
): Promise<string[]> {
  const idSet = new Set(adminUserIds);
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
    })
    .from(user);
  return rows
    .filter(
      (r) => r.emailVerified && (r.role === "admin" || idSet.has(r.id)),
    )
    .map((r) => r.email);
}

/**
 * Rec-engagement rollup (MET-005): shown/tried/dismissed/snoozed counts per
 * (org, rec, period), across ALL orgs in one query — the metric script's
 * one cross-org read (scripts/rec-engagement-metrics.ts), mirroring
 * readLaunchFunnelRows above. FOUNDER-ONLY AGGREGATE: the return type carries
 * no personId/email/pseudonym anywhere — never wire this to a route (no
 * /admin, no API). `recommendation_exposure` is self-view-only (ADR 0038,
 * `src/db/org-scope/exposures.ts`) — that namespace's `list()` stays the
 * per-person/per-org reader for the app; this is a separate, explicitly
 * cross-org, script-only aggregate.
 *
 * `period` = `recommendation_exposure.shown_at`, the table's own day grain
 * ("YYYY-MM-DD") — used as-is rather than inventing a week/month bucket the
 * schema doesn't already offer; a caller wanting a coarser rollup can bucket
 * the returned day-grain rows further.
 *
 * The join is on (org_id, person_id, rec_id) ONLY — not also on day/period:
 * `rec_interaction_state` holds one CURRENT row per (org, person, rec), not a
 * history of when each action happened, so there is no per-day interaction
 * record to join against. Each exposure row is matched against whatever that
 * person's latest recorded action on that rec is, whenever it was taken —
 * an approximation inherent to the source table's "current state, not a
 * log" design (§8.3), not something this rollup can improve on.
 */
export type RecEngagementRollupRow = {
  orgId: string;
  recId: string;
  /** recommendation_exposure.shown_at, "YYYY-MM-DD" (see header). */
  period: string;
  shown: number;
  tried: number;
  dismissed: number;
  snoozed: number;
};

export async function recEngagementRollup(
  db: Db,
): Promise<RecEngagementRollupRow[]> {
  return db
    .select({
      orgId: recommendationExposure.orgId,
      recId: recommendationExposure.recId,
      period: recommendationExposure.shownAt,
      shown: count(),
      tried:
        sql<number>`count(*) filter (where ${recInteractionState.state} = 'tried')`.mapWith(
          Number,
        ),
      dismissed:
        sql<number>`count(*) filter (where ${recInteractionState.state} = 'dismissed')`.mapWith(
          Number,
        ),
      snoozed:
        sql<number>`count(*) filter (where ${recInteractionState.state} = 'snoozed')`.mapWith(
          Number,
        ),
    })
    .from(recommendationExposure)
    .leftJoin(
      recInteractionState,
      and(
        eq(recInteractionState.orgId, recommendationExposure.orgId),
        eq(recInteractionState.personId, recommendationExposure.personId),
        eq(recInteractionState.recId, recommendationExposure.recId),
      ),
    )
    .groupBy(
      recommendationExposure.orgId,
      recommendationExposure.recId,
      recommendationExposure.shownAt,
    )
    .orderBy(
      recommendationExposure.orgId,
      recommendationExposure.recId,
      recommendationExposure.shownAt,
    );
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
 * connector_runs is purged for `kind = 'poll'` AND `kind = 'agent_ingest'`
 * ONLY: `backfillStarted` in src/poller/dispatch.ts is derived from the mere
 * EXISTENCE of a `backfill` run per connection, so deleting a connection's
 * last backfill row would make the dispatcher re-trigger a full backfill.
 * Backfill rows are a handful per connection lifetime (bounded already); poll
 * rows are the high-volume ones, and agent_ingest (one row per manual sync,
 * ADR 0025) grows unbounded on a channel users can re-run at will — both age
 * out on this window (see the `inArray` filter below).
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
            // High-frequency append-only kinds age out; backfill rows stay
            // (bounded one-shot history). agent_ingest is one row per manual
            // sync (ADR 0025) — without retention it grows unbounded on a
            // channel users can re-run at will.
            inArray(connectorRuns.kind, ["poll", "agent_ingest"]),
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
