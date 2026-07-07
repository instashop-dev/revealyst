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
 * Short-circuits the count query for entitled/system orgs (the common paid
 * path) so the gate is cheap on hot API routes.
 */
export async function computeAccess(
  db: Db,
  scope: BillingScope,
  org: { id: string; kind: "personal" | "team" | "system" },
): Promise<Access> {
  const entitlement = await subscriptionsForOrg(db, org.id).current();
  if (entitlement.plan === "team" || org.kind === "system") {
    return {
      blocked: false,
      trackedUsers: 0,
      limit: FREE_TRACKED_USER_LIMIT,
    };
  }
  const { trackedPersonIds } = await scope.billing.trackedUsers(
    trailing30dPeriod(),
  );
  return resolveAccess({
    plan: entitlement.plan,
    orgKind: org.kind,
    trackedUsers: trackedPersonIds.length,
  });
}
