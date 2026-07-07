import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutTransaction,
  createPortalSession,
  PaddleApiError,
  type PaddleServerConfig,
  resolvePaddleClientConfig,
  resolvePaddleServerConfig,
} from "../src/lib/paddle";

// W3-M PR3 (ADR 0010): the Paddle API client + config resolution, against a
// mocked fetch (rule 2) — so the transaction body (esp. custom_data.org_id +
// discount) and portal parsing are proven before real credentials land.

const SERVER: PaddleServerConfig = {
  environment: "sandbox",
  clientToken: "test_ctok",
  priceId: "pri_test",
  apiBase: "https://sandbox-api.paddle.com",
  apiKey: "sk_test",
  discountId: "dsc_founder",
};

function jsonFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("config resolution", () => {
  it("client config exposes only client-safe values, defaulting to sandbox", () => {
    expect(
      resolvePaddleClientConfig({
        PADDLE_CLIENT_TOKEN: "t",
        PADDLE_PRICE_ID: "p",
      }),
    ).toEqual({ environment: "sandbox", clientToken: "t", priceId: "p" });
  });

  it("server config picks the production base and carries the api key", () => {
    const s = resolvePaddleServerConfig({
      PADDLE_ENVIRONMENT: "production",
      PADDLE_CLIENT_TOKEN: "t",
      PADDLE_PRICE_ID: "p",
      PADDLE_API_KEY: "k",
    });
    expect(s.apiBase).toBe("https://api.paddle.com");
    expect(s.apiKey).toBe("k");
  });

  it("throws (never falls open) when a required value is missing", () => {
    expect(() =>
      resolvePaddleServerConfig({
        PADDLE_CLIENT_TOKEN: "t",
        PADDLE_PRICE_ID: "p",
      }),
    ).toThrow(/PADDLE_API_KEY/);
  });
});

describe("createCheckoutTransaction", () => {
  it("posts items + custom_data.org_id + discount, returns the transaction id", async () => {
    const fetchMock = jsonFetch(200, { data: { id: "txn_123" } });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createCheckoutTransaction(SERVER, {
      orgId: "org-1",
      quantity: 5,
    });
    expect(res).toEqual({ transactionId: "txn_123" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-api.paddle.com/transactions");
    const body = JSON.parse(init!.body as string);
    expect(body.items).toEqual([{ price_id: "pri_test", quantity: 5 }]);
    expect(body.custom_data).toEqual({ org_id: "org-1" });
    expect(body.discount_id).toBe("dsc_founder");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk_test",
    );
  });

  it("omits discount_id when no discount is configured", async () => {
    const fetchMock = jsonFetch(200, { data: { id: "txn_1" } });
    vi.stubGlobal("fetch", fetchMock);
    await createCheckoutTransaction(
      { ...SERVER, discountId: null },
      { orgId: "o", quantity: 1 },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("discount_id");
  });

  it("throws PaddleApiError on a non-2xx", async () => {
    vi.stubGlobal("fetch", jsonFetch(422, { error: "bad" }));
    await expect(
      createCheckoutTransaction(SERVER, { orgId: "o", quantity: 1 }),
    ).rejects.toBeInstanceOf(PaddleApiError);
  });
});

describe("createPortalSession", () => {
  it("parses the authenticated overview + subscription deep links", async () => {
    vi.stubGlobal(
      "fetch",
      jsonFetch(200, {
        data: {
          urls: {
            general: { overview: "https://portal/o" },
            subscriptions: [
              {
                cancel_subscription: "https://portal/c",
                update_subscription_payment_method: "https://portal/u",
              },
            ],
          },
        },
      }),
    );
    expect(
      await createPortalSession(SERVER, {
        customerId: "ctm_1",
        subscriptionIds: ["sub_1"],
      }),
    ).toEqual({
      overviewUrl: "https://portal/o",
      cancelUrl: "https://portal/c",
      updatePaymentUrl: "https://portal/u",
    });
  });

  it("throws when the response has no overview url", async () => {
    vi.stubGlobal("fetch", jsonFetch(200, { data: { urls: {} } }));
    await expect(
      createPortalSession(SERVER, { customerId: "c" }),
    ).rejects.toBeInstanceOf(PaddleApiError);
  });
});
