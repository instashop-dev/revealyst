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
      : // The count is SPECULATIVE: it's discarded for a team/system org, and
        // it never ran for entitled orgs before this parallelization. So it
        // must not be able to fail an entitled request — map its rejection to
        // a captured `{ error }` (never rejecting the Promise.all), and only
        // re-surface it on the un-entitled path that actually consumes it,
        // exactly as the old sequential `await` would have.
        scope.billing.trackedUsers(trailing30dPeriod()).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        ),
  ]);
  if (entitlement.plan === "team" || org.kind === "system") {
    return {
      blocked: false,
      trackedUsers: 0,
      limit: FREE_TRACKED_USER_LIMIT,
    };
  }
  // Un-entitled → the count is required. `tracked` is null only for system
  // orgs (returned above), so here it is the captured result; if the
  // speculative read failed, its error surfaces now, not sooner.
  if (tracked === null || "error" in tracked) {
    throw tracked?.error ??
      new Error("computeAccess: missing tracked-user count for a non-system org");
  }
  return resolveAccess({
    plan: entitlement.plan,
    orgKind: org.kind,
    trackedUsers: tracked.value.trackedPersonIds.length,
  });
}
