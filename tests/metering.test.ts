import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import {
  applyPaddleSubscriptionEvent,
  subscriptionsForOrg,
} from "../src/db/subscriptions";
import { listSubscriptionsToMeter } from "../src/db/system";
import { meterSubscription } from "../src/metering/meter";
import type { PaddleServerConfig } from "../src/lib/paddle";

// W3-M PR5: the seat-metering job — reports the frozen tracked_user count to
// Paddle. Paddle HTTP is mocked; the count comes from the real org-scoped
// billing primitive (an empty fixture org resolves to 0 → floored to 1).

const CONFIG: PaddleServerConfig = {
  environment: "sandbox",
  clientToken: "ctok",
  priceId: "pri_test",
  apiBase: "https://sandbox-api.paddle.com",
  apiKey: "sk",
  discountId: null,
};

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

afterEach(() => vi.unstubAllGlobals());

function mockPaddle(status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { id: "sub" } }), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function seedActiveSub(name: string, quantity: number, subId: string) {
  const org = (await createFixtureOrg(db, name, "team")).id;
  await applyPaddleSubscriptionEvent(db, {
    orgId: org,
    paddleSubscriptionId: subId,
    occurredAt: new Date(),
    status: "active",
    priceId: "pri_test",
    quantity,
  });
  return org;
}

describe("meterSubscription", () => {
  it("PATCHes Paddle + records the quantity when the count changed", async () => {
    // Empty org → 0 tracked users → floored to 1; stored quantity is 3.
    const org = await seedActiveSub("meter-changed", 3, "sub_changed");
    const fetchMock = mockPaddle();
    const res = await meterSubscription(db, CONFIG, {
      orgId: org,
      paddleSubscriptionId: "sub_changed",
      priceId: "pri_test",
    });
    expect(res).toEqual({ metered: true, quantity: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_changed");
    expect(init!.method).toBe("PATCH");
    const body = JSON.parse(init!.body as string);
    expect(body.items).toEqual([{ price_id: "pri_test", quantity: 1 }]);
    expect(body.proration_billing_mode).toBe("prorated_next_billing_period");
  });

  it("re-delivery after a successful meter is idempotent — one PATCH, not two", async () => {
    const org = await seedActiveSub("meter-redeliver", 3, "sub_redeliver");
    const fetchMock = mockPaddle();
    const msg = {
      orgId: org,
      paddleSubscriptionId: "sub_redeliver",
      priceId: "pri_test",
    };
    const first = await meterSubscription(db, CONFIG, msg);
    const second = await meterSubscription(db, CONFIG, msg);
    expect(first).toEqual({ metered: true, quantity: 1 });
    // Second run sees the recorded quantity (1) == count (1) → no-op.
    expect(second.metered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rolls the local quantity back when the Paddle PATCH fails", async () => {
    const org = await seedActiveSub("meter-rollback", 3, "sub_rollback");
    mockPaddle(500); // Paddle rejects the PATCH
    await expect(
      meterSubscription(db, CONFIG, {
        orgId: org,
        paddleSubscriptionId: "sub_rollback",
        priceId: "pri_test",
      }),
    ).rejects.toThrow();
    // The claim was rolled back, so a retry can re-attempt from the true state.
    const stored = (await subscriptionsForOrg(db, org).current()).subscription;
    expect(stored?.quantity).toBe(3);
  });

  it("skips when a concurrent message already claimed the transition", async () => {
    const org = await seedActiveSub("meter-race", 3, "sub_race");
    // Simulate the other message winning: the stored quantity is already the
    // target (1), so this run's guard sees no change and no-ops.
    await subscriptionsForOrg(db, org).setQuantityIf("sub_race", 3, 1);
    const fetchMock = mockPaddle();
    const res = await meterSubscription(db, CONFIG, {
      orgId: org,
      paddleSubscriptionId: "sub_race",
      priceId: "pri_test",
    });
    expect(res.metered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op (no Paddle call) when the count is unchanged", async () => {
    // Empty org → count 1; stored quantity already 1.
    const org = await seedActiveSub("meter-noop", 1, "sub_noop");
    const fetchMock = mockPaddle();
    const res = await meterSubscription(db, CONFIG, {
      orgId: org,
      paddleSubscriptionId: "sub_noop",
      priceId: "pri_test",
    });
    expect(res).toEqual({ metered: false, quantity: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when the dispatched subscription is no longer the org's entitling one", async () => {
    const org = (await createFixtureOrg(db, "meter-stale", "team")).id;
    // Only a canceled sub exists → current().subscription is null.
    await applyPaddleSubscriptionEvent(db, {
      orgId: org,
      paddleSubscriptionId: "sub_gone",
      occurredAt: new Date(),
      status: "canceled",
      priceId: "pri_test",
      quantity: 5,
      canceledAt: new Date(),
    });
    const fetchMock = mockPaddle();
    const res = await meterSubscription(db, CONFIG, {
      orgId: org,
      paddleSubscriptionId: "sub_gone",
      priceId: "pri_test",
    });
    expect(res.metered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listSubscriptionsToMeter", () => {
  it("returns active + trialing subscriptions, excludes past_due/paused/canceled", async () => {
    const statuses = [
      "active",
      "trialing",
      "past_due",
      "paused",
      "canceled",
    ] as const;
    for (const status of statuses) {
      const org = (await createFixtureOrg(db, `list-${status}`, "team")).id;
      await applyPaddleSubscriptionEvent(db, {
        orgId: org,
        paddleSubscriptionId: `sub_${status}`,
        occurredAt: new Date(),
        status,
        priceId: "pri_test",
        quantity: 2,
      });
    }
    const metered = await listSubscriptionsToMeter(db);
    const ids = metered.map((m) => m.paddleSubscriptionId);
    expect(ids).toContain("sub_active");
    expect(ids).toContain("sub_trialing");
    expect(ids).not.toContain("sub_past_due");
    expect(ids).not.toContain("sub_paused");
    expect(ids).not.toContain("sub_canceled");
  });
});
