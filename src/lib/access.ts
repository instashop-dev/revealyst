import type { Db } from "../db/client";
import { subscriptionsForOrg } from "../db/subscriptions";
import {
  type Access,
  FREE_TRACKED_USER_LIMIT,
  resolveAccess,
  trailing30dPeriod,
} from "./entitlements";

// DB-backed free-band access (W3-M PR4). Kept out of the pure entitlements
// module so public pages can import FREE_TRACKED_USER_LIMIT without pulling in
// the db layer.

type BillingScope = {
  billing: {
    trackedUsers: (period: { start: string; end: string }) => Promise<{
      trackedPersonIds: string[];
    }>;
  };
};

/**
 * The org-scoped access decision shared by the app shell (server render) AND
 * the API choke point (handleApi), so the paywall gates data the same way in
 * both — a blocked org can neither see the pages nor read the JSON behind them.
 *
 * The subscription read and the tracked-user count are issued CONCURRENTLY:
 * the count is only *needed* when the org turns out un-entitled, but starting
 * it speculatively next to the subscription read pipelines both over the
 * single Workers connection into ONE round-trip (round-trip depth 1 — the
 * readDashboardView pattern) instead of the previous subscription→count
 * sequential chain, which cost a second ~500-670ms Neon hop on every
 * free-band request. This gate runs on every authenticated page render AND
 * every handleApi call, so that hop was paid across the whole free-tier hot
 * path — including the login → dashboard tail. A system org is entitled
 * regardless of plan, so it still skips the count entirely (no speculative
 * query). A team-plan org discards the (now-concurrent) count: the decision
 * is byte-identical to the old sequential path, at the cost of one extra
 * pipelined count query on the paid path — a query-count trade for a
 * round-trip-depth win, per the codebase's depth-over-count perf model.
 */
export async function computeAccess(
  db: Db,
  scope: BillingScope,
  org: { id: string; kind: "personal" | "team" | "system" },
): Promise<Access> {
  const [entitlement, tracked] = await Promise.all([
    subscriptionsForOrg(db, org.id).current(),
    // A system org is entitled regardless of plan — never pay even a
    // pipelined count for it.
    org.kind === "system"
      ? Promise.resolve(null)
      : scope.billing.trackedUsers(trailing30dPeriod()),
  ]);
  if (entitlement.plan === "team" || org.kind === "system") {
    return {
      blocked: false,
      trackedUsers: 0,
      limit: FREE_TRACKED_USER_LIMIT,
    };
  }
  // Non-system + non-team → `tracked` was fetched above (not null).
  return resolveAccess({
    plan: entitlement.plan,
    orgKind: org.kind,
    trackedUsers: tracked!.trackedPersonIds.length,
  });
}
