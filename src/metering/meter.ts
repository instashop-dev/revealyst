import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { subscriptionsForOrg } from "../db/subscriptions";
import { trailing30dPeriod } from "../lib/entitlements";
import {
  type PaddleServerConfig,
  updateSubscriptionQuantity,
} from "../lib/paddle";

// W3-M PR5: report the frozen tracked_user count to Paddle as the subscription
// seat quantity. Runs from the queue consumer (one message per active/trialing
// subscription, daily). Pure logic here; the worker supplies db + Paddle config.

export type MeterMessage = {
  orgId: string;
  paddleSubscriptionId: string;
  priceId: string;
};

/**
 * Meters one subscription. The quantity is the frozen billing primitive
 * (`forOrg().billing.trackedUsers`) — only forwarded to Paddle here, never
 * redefined — floored at 1 (Paddle's minimum) and taken over the SAME
 * trailing-30d window the paywall and checkout use, so the billed seats match
 * what the customer sees. A no-op when the count is unchanged, so the daily job
 * (and any queue re-delivery) costs no Paddle call unless seats actually moved.
 */
export async function meterSubscription(
  db: Db,
  config: PaddleServerConfig,
  message: MeterMessage,
): Promise<{ metered: boolean; quantity: number }> {
  const { trackedPersonIds } = await forOrg(
    db,
    message.orgId,
  ).billing.trackedUsers(trailing30dPeriod());
  const quantity = Math.max(1, trackedPersonIds.length);

  // Re-read the org's live entitlement: the subscription could have been
  // canceled, replaced, or moved to past_due between dispatch and processing.
  // Only meter if it is still the one we were dispatched for AND in a state
  // Paddle accepts a quantity change for (active/trialing — never mid-dunning).
  const scope = subscriptionsForOrg(db, message.orgId);
  const stored = (await scope.current()).subscription;
  if (
    !stored ||
    stored.paddleSubscriptionId !== message.paddleSubscriptionId ||
    (stored.status !== "active" && stored.status !== "trialing") ||
    stored.quantity === quantity
  ) {
    return { metered: false, quantity };
  }

  // Claim the transition BEFORE charging Paddle. Queues are at-least-once, so
  // a redelivered/concurrent message could otherwise read the same stale
  // quantity and PATCH twice; the compare-and-set row-locks so exactly one
  // wins. Recording first also makes a mid-flight crash UNDER-bill (safe,
  // self-heals on the next change), never double-charge.
  const claimed = await scope.setQuantityIf(
    stored.paddleSubscriptionId,
    stored.quantity,
    quantity,
  );
  if (!claimed) {
    return { metered: false, quantity };
  }
  try {
    await updateSubscriptionQuantity(config, {
      subscriptionId: stored.paddleSubscriptionId,
      // Re-read price (not the dispatch-time snapshot): a price change since
      // dispatch would otherwise rewrite the subscription's line item.
      priceId: stored.priceId,
      quantity,
    });
  } catch (error) {
    // Roll the claim back so a retry re-attempts the charge rather than
    // leaving the row ahead of Paddle. Best-effort; guarded by CAS again.
    await scope.setQuantityIf(
      stored.paddleSubscriptionId,
      quantity,
      stored.quantity,
    );
    throw error;
  }
  return { metered: true, quantity };
}
