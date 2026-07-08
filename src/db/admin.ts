import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import { connections, connectorRuns, orgs, subscriptions, user } from "./schema";

// Platform-admin cross-org reads (ADR 0016, Feature 3). Mirrors
// src/db/system.ts: the only sanctioned home for raw schema access outside
// forOrg (scripts/check-org-scope.mjs allows schema imports only under
// src/db/**). Every export here is read-only and deliberately cross-org —
// the admin dashboard's whole point is a platform-wide view no org-scoped
// query could produce. Callers gate via requireAdminContext/handleAdminApi
// (src/lib/admin-context.ts); this module does no authorization itself.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;

export type OrgKind = "personal" | "team";

export type RecentSignup = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

export type ConnectorFailure = {
  id: string;
  orgId: string;
  orgName: string;
  connectionId: string;
  vendor: string;
  displayName: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type PlatformStats = {
  totalUsers: number;
  /** Org counts by kind, excluding the internal "system" org (audit-log
   * home, ensureSystemOrg) — it is infrastructure, not a customer. */
  orgCountsByKind: Record<OrgKind, number>;
  signupsLast30Days: number;
  /** Newest-first, for the dashboard's "recent signups" table. */
  recentSignups: RecentSignup[];
  /** Connection status → count, e.g. { active: 12, error: 2, pending: 1 }. */
  connectionsByStatus: Record<string, number>;
  /** Newest-first connector_runs rows with status="error", capped at
   * RECENT_LIMIT — a fleet-health signal, not an exhaustive error log. */
  recentConnectorFailures: ConnectorFailure[];
  /** Subscription status → count (active/trialing/past_due/paused/canceled). */
  subscriptionsByStatus: Record<string, number>;
};

/** Reduces a `{status, count}[]` group-by result into a lookup record —
 * shared by connectionsByStatus and subscriptionsByStatus below. */
function toStatusRecord(
  rows: readonly { status: string; count: number }[],
): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/** Platform-wide aggregate stats for the /admin dashboard (Feature 3). */
export async function platformStats(db: Db): Promise<PlatformStats> {
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  const [
    [userStats],
    orgKindRows,
    recentSignups,
    connectionStatusRows,
    connectorFailureRows,
    subscriptionStatusRows,
  ] = await Promise.all([
    // One pass over `user` for both counts (FILTER, not two scans) — same
    // idiom scripts/launch-metrics.ts uses for invitesAccepted.
    db
      .select({
        total: sql<number>`count(*)::int`,
        last30d: sql<number>`count(*) filter (where ${user.createdAt} >= ${thirtyDaysAgo})::int`,
      })
      .from(user),
    db
      .select({ kind: orgs.kind, count: sql<number>`count(*)::int` })
      .from(orgs)
      .where(ne(orgs.kind, "system"))
      .groupBy(orgs.kind),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      })
      .from(user)
      // id tiebreak: createdAt alone is not unique, and without a stable
      // secondary sort key a tie at the LIMIT boundary can return a
      // different top-10 (or a different order) across requests.
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(RECENT_LIMIT),
    db
      .select({ status: connections.status, count: sql<number>`count(*)::int` })
      .from(connections)
      .groupBy(connections.status),
    // Platform-wide scan of connector_runs with no org_id predicate — the
    // existing (org_id, connection_id, started_at) index doesn't help this
    // query. Acceptable at current volume (same trade-off src/db/system.ts
    // documents for latestHeartbeatAt); a follow-up adds a partial index on
    // (status, started_at) if this becomes a hot path.
    db
      .select({
        id: connectorRuns.id,
        orgId: connectorRuns.orgId,
        orgName: orgs.name,
        connectionId: connectorRuns.connectionId,
        vendor: connections.vendor,
        displayName: connections.displayName,
        error: connectorRuns.error,
        startedAt: connectorRuns.startedAt,
        finishedAt: connectorRuns.finishedAt,
      })
      .from(connectorRuns)
      .innerJoin(
        connections,
        and(
          eq(connectorRuns.orgId, connections.orgId),
          eq(connectorRuns.connectionId, connections.id),
        ),
      )
      .innerJoin(orgs, eq(connectorRuns.orgId, orgs.id))
      .where(eq(connectorRuns.status, "error"))
      .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.id))
      .limit(RECENT_LIMIT),
    db
      .select({
        status: subscriptions.status,
        count: sql<number>`count(*)::int`,
      })
      .from(subscriptions)
      .groupBy(subscriptions.status),
  ]);

  const orgCountsByKind: Record<OrgKind, number> = { personal: 0, team: 0 };
  for (const row of orgKindRows) {
    if (row.kind === "personal" || row.kind === "team") {
      orgCountsByKind[row.kind] = row.count;
    }
  }

  return {
    totalUsers: userStats?.total ?? 0,
    orgCountsByKind,
    signupsLast30Days: userStats?.last30d ?? 0,
    recentSignups,
    connectionsByStatus: toStatusRecord(connectionStatusRows),
    recentConnectorFailures: connectorFailureRows,
    subscriptionsByStatus: toStatusRecord(subscriptionStatusRows),
  };
}
