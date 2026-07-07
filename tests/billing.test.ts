import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import { applyPaddleSubscriptionEvent } from "../src/db/subscriptions";
import { openPortal, startCheckout } from "../src/lib/billing";
import type { PaddleServerConfig } from "../src/lib/paddle";

// W3-M PR3 (ADR 0010): billing orchestration — the admin gate, already-Team
// no-op, server-side org binding, and portal 404. Paddle HTTP is mocked.

const CONFIG: PaddleServerConfig = {
  environment: "sandbox",
  clientToken: "ctok",
  priceId: "pri_test",
  apiBase: "https://sandbox-api.paddle.com",
  apiKey: "sk",
  discountId: null,
};

let db: Db;
let orgId: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "bill", "team")).id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockPaddle(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("startCheckout", () => {
  it("rejects non-admins (403)", async () => {
    await expect(
      startCheckout(db, CONFIG, { orgId, role: "member" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("409s when the org is already on Team", async () => {
    const org = (await createFixtureOrg(db, "bill-team", "team")).id;
    await applyPaddleSubscriptionEvent(db, {
      orgId: org,
      paddleSubscriptionId: "sub_team",
      occurredAt: new Date(),
      status: "active",
      priceId: "pri_test",
      quantity: 3,
    });
    await expect(
      startCheckout(db, CONFIG, { orgId: org, role: "admin" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("409s when a PAUSED (resumable) subscription exists — no parallel second sub", async () => {
    const org = (await createFixtureOrg(db, "bill-paused", "team")).id;
    await applyPaddleSubscriptionEvent(db, {
      orgId: org,
      paddleSubscriptionId: "sub_paused",
      occurredAt: new Date(),
      status: "paused",
      priceId: "pri_test",
      quantity: 3,
    });
    await expect(
      startCheckout(db, CONFIG, { orgId: org, role: "admin" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("allows re-subscribe after a fully canceled subscription", async () => {
    const org = (await createFixtureOrg(db, "bill-recan", "team")).id;
    await applyPaddleSubscriptionEvent(db, {
      orgId: org,
      paddleSubscriptionId: "sub_canceled",
      occurredAt: new Date(),
      status: "canceled",
      priceId: "pri_test",
      quantity: 3,
      canceledAt: new Date(),
    });
    mockPaddle({ data: { id: "txn_recan" } });
    const res = await startCheckout(db, CONFIG, { orgId: org, role: "admin" });
    expect(res.transactionId).toBe("txn_recan");
  });

  it("creates a transaction with org_id bound server-side, returns the client token", async () => {
    const org = (await createFixtureOrg(db, "bill-new", "team")).id;
    const fetchMock = mockPaddle({ data: { id: "txn_1" } });
    const res = await startCheckout(db, CONFIG, { orgId: org, role: "admin" });
    expect(res).toMatchObject({
      transactionId: "txn_1",
      clientToken: "ctok",
      environment: "sandbox",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.custom_data.org_id).toBe(org);
    expect(body.items[0].quantity).toBeGreaterThanOrEqual(1);
  });
});

describe("openPortal", () => {
  it("404s when the org has no subscription", async () => {
    const org = (await createFixtureOrg(db, "bill-nosub", "team")).id;
    await expect(openPortal(db, CONFIG, org)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns portal links for a Team org with a stored customer", async () => {
    const org = (await createFixtureOrg(db, "bill-portal", "team")).id;
    await applyPaddleSubscriptionEvent(db, {
      orgId: org,
      paddleSubscriptionId: "sub_p",
      paddleCustomerId: "ctm_p",
      occurredAt: new Date(),
      status: "active",
      priceId: "pri_test",
      quantity: 2,
    });
    const fetchMock = mockPaddle({
      data: {
        urls: {
          general: { overview: "https://p/o" },
          subscriptions: [{ cancel_subscription: "https://p/c" }],
        },
      },
    });
    const links = await openPortal(db, CONFIG, org);
    expect(links.overviewUrl).toBe("https://p/o");
    expect(links.cancelUrl).toBe("https://p/c");
    // the customer id from the stored subscription is used in the path
    expect(fetchMock.mock.calls[0][0]).toContain("/customers/ctm_p/");
  });
});
