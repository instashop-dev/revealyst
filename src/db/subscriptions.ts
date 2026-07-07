import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./client";
import { subscriptions } from "./schema";

// Paddle subscription / entitlement state (ADR 0009). Lives in the schema zone
// beside org-scope.ts. Reads/writes for an authenticated org go through the
// org-scoped factory; the ONE write the webhook handler needs runs pre-scope
// (Paddle has no session) but is NOT ambient cross-org access — the orgId comes
// from the checkout's validated custom-data passthrough, and the write is an
// event-time-guarded upsert keyed on the globally-unique paddle_subscription_id.
// This is the third capability-style exception after invites (0004) and share
// tokens (0008).

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionStatus = SubscriptionRow["status"];
export type EntitlementPlan = "personal" | "team";

/**
 * Statuses that grant the Team plan. `past_due` still grants access (dunning
 * grace); hard loss of access is `paused`/`canceled` (or no row at all).
 * Effective plan is DERIVED from status — never stored (ADR 0009).
 */
export const ENTITLING_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const satisfies readonly SubscriptionStatus[];

export function isEntitlingStatus(status: SubscriptionStatus): boolean {
  return (ENTITLING_STATUSES as readonly string[]).includes(status);
}

export type Entitlement = {
  plan: EntitlementPlan;
  status: SubscriptionStatus | null;
  /** Seats confirmed by Paddle on the entitling subscription; 0 when free. */
  quantity: number;
  /** The subscription backing a Team entitlement, if any. */
  subscription: SubscriptionRow | null;
};

/** A fresh Personal/free entitlement — never a shared singleton (a caller that
 * mutates the result must not corrupt every other free org). */
function freeEntitlement(): Entitlement {
  return { plan: "personal", status: null, quantity: 0, subscription: null };
}

/**
 * Pure entitlement resolution over an org's subscription rows — the org is on
 * Team iff it has an entitling-status row; the row with the newest Paddle event
 * time wins (e.g. a resubscribe after a cancel), with a deterministic tiebreak
 * on subscription id so an equal `occurred_at` never yields a non-deterministic
 * seat count. Absence of any entitling row is Personal/free. Exported for unit
 * tests so DB and logic cannot diverge.
 */
export function resolveEntitlement(
  rows: readonly SubscriptionRow[],
): Entitlement {
  const entitling = rows.filter((r) => isEntitlingStatus(r.status));
  if (entitling.length === 0) {
    return freeEntitlement();
  }
  const active = entitling.reduce((best, r) => {
    const delta = r.paddleOccurredAt.getTime() - best.paddleOccurredAt.getTime();
    if (delta > 0) return r;
    if (delta === 0 && r.paddleSubscriptionId > best.paddleSubscriptionId) {
      return r;
    }
    return best;
  });
  return {
    plan: "team",
    status: active.status,
    quantity: active.quantity,
    subscription: active,
  };
}

export function subscriptionsForOrg(db: Db, orgId: string) {
  return {
    /** All subscription rows for this org, newest write first (incl. canceled). */
    async list() {
      return db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.orgId, orgId))
        .orderBy(desc(subscriptions.updatedAt));
    },

    /** The org's effective entitlement, derived from its subscription rows. */
    async current(): Promise<Entitlement> {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.orgId, orgId));
      return resolveEntitlement(rows);
    },

    /**
     * Records the seat count Paddle confirmed for one of this org's
     * subscriptions (metering job, PR5). Org-scoped: the WHERE pins org_id so a
     * caller cannot touch another org's row even with a valid subscription id.
     * `updated_at` refreshes via the column's $onUpdate — no manual touch.
     */
    async updateQuantity(paddleSubscriptionId: string, quantity: number) {
      const [row] = await db
        .update(subscriptions)
        .set({ quantity })
        .where(
          and(
            eq(subscriptions.orgId, orgId),
            eq(subscriptions.paddleSubscriptionId, paddleSubscriptionId),
          ),
        )
        .returning();
      return row ?? null;
    },
  };
}

export type PaddleSubscriptionUpsert = {
  /** From the checkout's validated custom-data passthrough (ADR 0009). */
  orgId: string;
  paddleSubscriptionId: string;
  /** The Paddle event's `occurred_at` — the ordering key (see below). */
  occurredAt: Date;
  paddleCustomerId?: string | null;
  status: SubscriptionStatus;
  priceId: string;
  quantity: number;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  canceledAt?: Date | null;
};

/**
 * The single controlled write entry point for the Paddle webhook handler
 * (ADR 0009). Keyed on the globally-unique paddle_subscription_id, and applied
 * only when the event is NEWER than the stored one AND targets the SAME org:
 *
 *  - Out-of-order convergence: Paddle does not guarantee delivery order, so a
 *    stale `active` arriving after a `canceled` must NOT re-grant access. The
 *    `occurred_at < incoming` guard drops any event older than what we have.
 *  - Cross-org safety (defense-in-depth): a subscription never moves between
 *    orgs, so the `org_id = incoming` guard means a mismatched-passthrough
 *    event can never overwrite another org's row; org_id itself is never
 *    updated.
 *
 * Not session-scoped (Paddle has no session), but not ambient either — `orgId`
 * is supplied by the caller from the event's validated passthrough, never
 * inferred here. Kept OUT of forOrg so the org-scoped query contract is not
 * widened. When the guard skips the update (stale/foreign event), the stored
 * row is returned unchanged, so the caller always sees the winning state.
 */
export async function applyPaddleSubscriptionEvent(
  db: Db,
  input: PaddleSubscriptionUpsert,
): Promise<SubscriptionRow> {
  // Fields written identically on insert and on the conflict update — spelled
  // once so a new Paddle-synced column can't be added to one path but not the
  // other. org_id / paddle_subscription_id are the identity, set on insert only.
  const mutable = {
    paddleCustomerId: input.paddleCustomerId ?? null,
    status: input.status,
    priceId: input.priceId,
    quantity: input.quantity,
    currentPeriodStart: input.currentPeriodStart ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    canceledAt: input.canceledAt ?? null,
    paddleOccurredAt: input.occurredAt,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(subscriptions)
    .values({
      orgId: input.orgId,
      paddleSubscriptionId: input.paddleSubscriptionId,
      ...mutable,
    })
    .onConflictDoUpdate({
      target: subscriptions.paddleSubscriptionId,
      set: mutable,
      setWhere: and(
        eq(subscriptions.orgId, input.orgId),
        lt(subscriptions.paddleOccurredAt, input.occurredAt),
      ),
    })
    .returning();
  if (row) {
    return row;
  }
  // Guard skipped the update (stale or foreign event) — return the stored row
  // unchanged. The row always exists here: the conflict fired, so some row with
  // this paddle_subscription_id is present.
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.paddleSubscriptionId, input.paddleSubscriptionId));
  return existing;
}
