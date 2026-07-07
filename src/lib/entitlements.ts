import type { EntitlementPlan } from "../db/subscriptions";

// Free-band policy (W3-M PR4). The free tier covers up to a fixed number of
// tracked users (the frozen billing primitive); beyond it, a workspace must be
// on the Team plan. "Personal free forever" IS this band — orgs never carry a
// distinct `team` kind (nothing sets it), so the free/paid line is purely the
// tracked_user count vs. entitlement, not org kind.

/** Free plan covers ≤ this many tracked users; the (N+1)th triggers the
 * paywall. Founder-set for W3-M (a deliberate change from the plan's 10). */
export const FREE_TRACKED_USER_LIMIT = 5;

/** Trailing 30-day window — the current active fleet, independent of
 * day-of-month. Shared by the paywall check and the checkout seat seed so the
 * displayed count and the enforced count never diverge. */
export function trailing30dPeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

export type Access = {
  /** True when the workspace has exceeded the free band and isn't on Team. */
  blocked: boolean;
  trackedUsers: number;
  limit: number;
};

/**
 * Free-band access decision. Blocked only when an un-entitled workspace is over
 * the limit. Team plans are unlimited (billed per user); `system` orgs (internal
 * machinery, no login) are never gated.
 */
export function resolveAccess(input: {
  plan: EntitlementPlan;
  orgKind: "personal" | "team" | "system";
  trackedUsers: number;
}): Access {
  const exempt = input.plan === "team" || input.orgKind === "system";
  return {
    blocked: !exempt && input.trackedUsers > FREE_TRACKED_USER_LIMIT,
    trackedUsers: input.trackedUsers,
    limit: FREE_TRACKED_USER_LIMIT,
  };
}

