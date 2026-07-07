import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import {
  applyPaddleSubscriptionEvent,
  resolveEntitlement,
  type SubscriptionRow,
  subscriptionsForOrg,
} from "../src/db/subscriptions";

// W3-M PR1 (ADR 0009): Paddle subscription / entitlement state — the pure
// derivation (plan from status, newest event wins), the event-time-guarded
// webhook upsert (out-of-order + cross-org safety), and the org-scoped
// read/quantity surface.

let db: Db;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgA = (await createFixtureOrg(db, "sub-a", "team")).id;
  orgB = (await createFixtureOrg(db, "sub-b", "team")).id;
});

const T0 = new Date("2026-07-01T00:00:00Z");
const T1 = new Date("2026-07-02T00:00:00Z");
const T2 = new Date("2026-07-03T00:00:00Z");

function row(over: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    id: "id",
    orgId: "org",
    paddleSubscriptionId: "sub",
    paddleCustomerId: null,
    status: "active",
    priceId: "pri_test",
    quantity: 3,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    paddleOccurredAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

describe("resolveEntitlement (pure)", () => {
  it("no rows → Personal/free", () => {
    expect(resolveEntitlement([])).toEqual({
      plan: "personal",
      status: null,
      quantity: 0,
      subscription: null,
    });
  });

  it("returns a fresh free object each call — never a shared singleton", () => {
    const a = resolveEntitlement([]);
    a.quantity = 99;
    expect(resolveEntitlement([]).quantity).toBe(0);
  });

  it.each(["active", "trialing", "past_due"] as const)(
    "%s grants Team (past_due = dunning grace)",
    (status) => {
      const e = resolveEntitlement([row({ status, quantity: 7 })]);
      expect(e.plan).toBe("team");
      expect(e.status).toBe(status);
      expect(e.quantity).toBe(7);
    },
  );

  it.each(["paused", "canceled"] as const)(
    "%s is Personal/free (hard loss of access)",
    (status) => {
      expect(resolveEntitlement([row({ status })]).plan).toBe("personal");
    },
  );

  it("a canceled-then-resubscribed org is Team on the newest-event row", () => {
    const e = resolveEntitlement([
      row({
        paddleSubscriptionId: "old",
        status: "canceled",
        paddleOccurredAt: T0,
      }),
      row({
        paddleSubscriptionId: "new",
        status: "active",
        quantity: 12,
        paddleOccurredAt: T2,
      }),
    ]);
    expect(e.plan).toBe("team");
    expect(e.subscription?.paddleSubscriptionId).toBe("new");
    expect(e.quantity).toBe(12);
  });

  it("is deterministic when two entitling rows share occurred_at (tiebreak on id)", () => {
    const a = resolveEntitlement([
      row({ paddleSubscriptionId: "sub_a", quantity: 3, paddleOccurredAt: T1 }),
      row({ paddleSubscriptionId: "sub_b", quantity: 10, paddleOccurredAt: T1 }),
    ]);
    const b = resolveEntitlement([
      row({ paddleSubscriptionId: "sub_b", quantity: 10, paddleOccurredAt: T1 }),
      row({ paddleSubscriptionId: "sub_a", quantity: 3, paddleOccurredAt: T1 }),
    ]);
    expect(a.subscription?.paddleSubscriptionId).toBe("sub_b");
    expect(a).toEqual(b);
  });
});

describe("applyPaddleSubscriptionEvent (webhook upsert)", () => {
  it("is idempotent on paddle_subscription_id — a newer re-delivery updates, not duplicates", async () => {
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_idem",
      occurredAt: T0,
      status: "active",
      priceId: "pri_test",
      quantity: 4,
    });
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_idem",
      occurredAt: T1,
      status: "past_due",
      priceId: "pri_test",
      quantity: 6,
    });
    const rows = await subscriptionsForOrg(db, orgA).list();
    const matched = rows.filter((r) => r.paddleSubscriptionId === "sub_idem");
    expect(matched).toHaveLength(1);
    expect(matched[0].status).toBe("past_due");
    expect(matched[0].quantity).toBe(6);
  });

  it("drops an OUT-OF-ORDER stale event — a late 'active' does not re-grant after 'canceled'", async () => {
    // canceled (occurred T2) arrives first...
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_ooo",
      occurredAt: T2,
      status: "canceled",
      priceId: "pri_test",
      quantity: 5,
      canceledAt: T2,
    });
    // ...then the stale active (occurred T1) is delivered late.
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_ooo",
      occurredAt: T1,
      status: "active",
      priceId: "pri_test",
      quantity: 5,
    });
    const [stored] = (await subscriptionsForOrg(db, orgA).list()).filter(
      (r) => r.paddleSubscriptionId === "sub_ooo",
    );
    expect(stored.status).toBe("canceled"); // stale event ignored
  });

  it("a canceled event flips the org back to Personal", async () => {
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgB,
      paddleSubscriptionId: "sub_b",
      occurredAt: T0,
      status: "active",
      priceId: "pri_test",
      quantity: 3,
    });
    expect((await subscriptionsForOrg(db, orgB).current()).plan).toBe("team");
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgB,
      paddleSubscriptionId: "sub_b",
      occurredAt: T1,
      status: "canceled",
      priceId: "pri_test",
      quantity: 3,
      canceledAt: T1,
    });
    expect((await subscriptionsForOrg(db, orgB).current()).plan).toBe(
      "personal",
    );
  });

  it("a foreign-org event never overwrites another org's row (defense-in-depth)", async () => {
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_owned_by_a",
      occurredAt: T0,
      status: "active",
      priceId: "pri_test",
      quantity: 2,
    });
    // A mismatched-passthrough event (orgB) with the same subscription id and a
    // newer time must NOT corrupt org A's row.
    const returned = await applyPaddleSubscriptionEvent(db, {
      orgId: orgB,
      paddleSubscriptionId: "sub_owned_by_a",
      occurredAt: T2,
      status: "canceled",
      priceId: "pri_evil",
      quantity: 999,
      canceledAt: T2,
    });
    expect(returned.orgId).toBe(orgA);
    expect(returned.status).toBe("active");
    expect(returned.quantity).toBe(2);
    expect(returned.priceId).toBe("pri_test");
  });
});

describe("subscriptionsForOrg.updateQuantity (metering write)", () => {
  it("records the confirmed seat count, org-scoped, and refreshes updated_at", async () => {
    const created = await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_qty",
      occurredAt: T0,
      status: "active",
      priceId: "pri_test",
      quantity: 2,
    });
    const updated = await subscriptionsForOrg(db, orgA).updateQuantity(
      "sub_qty",
      9,
    );
    expect(updated?.quantity).toBe(9);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
  });

  it("cannot touch another org's subscription (org filter pins the WHERE)", async () => {
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgA,
      paddleSubscriptionId: "sub_owned_by_a2",
      occurredAt: T0,
      status: "active",
      priceId: "pri_test",
      quantity: 1,
    });
    const res = await subscriptionsForOrg(db, orgB).updateQuantity(
      "sub_owned_by_a2",
      99,
    );
    expect(res).toBeNull();
  });
});
