import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { subscriptionsForOrg } from "../db/subscriptions";
import { ApiError } from "./api-impl";
import { trailing30dPeriod } from "./entitlements";
import {
  createCheckoutTransaction,
  createPortalSession,
  type PaddleServerConfig,
  type PortalLinks,
} from "./paddle";

// Billing orchestration (W3-M PR3, ADR 0011) — the tested logic behind the two
// billing routes. Kept out of the route files (which call getCloudflareContext
// and can't run under vitest); routes are thin adapters that call these.

/** The Team seat count to seed a new subscription with: the org's current
 * tracked_user count (frozen primitive), floored at 1. Uses a TRAILING 30-day
 * window — the current active fleet, independent of day-of-month. (A partial
 * calendar month would bill 1–2 seats for a 40-person fleet that upgrades on
 * the 1st.) PR5's metering keeps it in sync each cycle. */
async function currentSeatCount(db: Db, orgId: string): Promise<number> {
  const { trackedPersonIds } = await forOrg(db, orgId).billing.trackedUsers(
    trailing30dPeriod(),
  );
  return Math.max(1, trackedPersonIds.length);
}

export type CheckoutStart = {
  transactionId: string;
  clientToken: string;
  environment: PaddleServerConfig["environment"];
};

/**
 * Starts a Team upgrade: admin-only, no-op if already on Team, otherwise a
 * server-created Paddle transaction whose org_id is bound here (never from the
 * client — the ADR 0011 / PR2-review security guarantee). Returns the opaque
 * transaction id plus the client-safe token/environment for the overlay.
 */
export async function startCheckout(
  db: Db,
  config: PaddleServerConfig,
  ctx: { orgId: string; role: "admin" | "member" },
): Promise<CheckoutStart> {
  if (ctx.role !== "admin") {
    throw new ApiError(403, "only admins can start an upgrade");
  }
  // Block a second checkout while ANY non-canceled subscription exists —
  // including `paused` (resumable via the portal), which resolves to plan
  // personal but must not allow a parallel second subscription. Only a fully
  // canceled org can re-subscribe.
  const existing = await subscriptionsForOrg(db, ctx.orgId).list();
  if (existing.some((s) => s.status !== "canceled")) {
    throw new ApiError(
      409,
      "this workspace already has an active or paused subscription",
    );
  }
  const quantity = await currentSeatCount(db, ctx.orgId);
  const { transactionId } = await createCheckoutTransaction(config, {
    orgId: ctx.orgId,
    quantity,
  });
  return {
    transactionId,
    clientToken: config.clientToken,
    environment: config.environment,
  };
}

/**
 * Opens the hosted customer portal for the caller's own org: resolves the org's
 * stored Paddle customer id (org-scoped) and mints a fresh, uncached portal
 * session with the subscription's deep links. 404 if the org has no
 * subscription to manage.
 */
export async function openPortal(
  db: Db,
  config: PaddleServerConfig,
  orgId: string,
): Promise<PortalLinks> {
  const subscription = (await subscriptionsForOrg(db, orgId).current())
    .subscription;
  if (!subscription?.paddleCustomerId) {
    throw new ApiError(404, "no active subscription to manage");
  }
  return createPortalSession(config, {
    customerId: subscription.paddleCustomerId,
    subscriptionIds: [subscription.paddleSubscriptionId],
  });
}
