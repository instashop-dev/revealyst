// Paddle Billing API client + config resolution (W3-M PR3, ADR 0011). Pure
// HTTP against Paddle; no DB, no session. Orchestration (auth, entitlement
// checks) lives in src/lib/billing.ts, and both are unit-tested with a mocked
// fetch (rule 2) so CI is green before real credentials land.

/** Env values behind the Paddle integration. Read per request, never module-
 * cached (Workers cancel cross-request I/O). Two resolvers below split the
 * client-safe subset from the server-only API key. */
export type PaddleEnv = {
  PADDLE_ENVIRONMENT?: string; // "sandbox" | "production"
  PADDLE_API_KEY?: string; // server-only
  PADDLE_CLIENT_TOKEN?: string; // safe to expose to the browser
  PADDLE_PRICE_ID?: string;
  PADDLE_DISCOUNT_ID?: string; // FOUNDER discount
};

export type PaddleEnvironment = "sandbox" | "production";

/** Only values that are safe to hand to the browser (Paddle.js Setup). */
export type PaddleClientConfig = {
  environment: PaddleEnvironment;
  clientToken: string;
  priceId: string;
};

/** Server config — adds the API base + secret API key + discount. */
export type PaddleServerConfig = PaddleClientConfig & {
  apiBase: string;
  apiKey: string;
  discountId: string | null;
};

export class PaddleApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Paddle ${endpoint} failed (${status}): ${detail}`);
    this.name = "PaddleApiError";
  }
}

function paddleEnvironment(env: PaddleEnv): PaddleEnvironment {
  return env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    // Never fall open — a missing key must be a loud misconfiguration.
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function resolvePaddleClientConfig(env: PaddleEnv): PaddleClientConfig {
  return {
    environment: paddleEnvironment(env),
    clientToken: required(env.PADDLE_CLIENT_TOKEN, "PADDLE_CLIENT_TOKEN"),
    priceId: required(env.PADDLE_PRICE_ID, "PADDLE_PRICE_ID"),
  };
}

export function resolvePaddleServerConfig(env: PaddleEnv): PaddleServerConfig {
  const environment = paddleEnvironment(env);
  return {
    ...resolvePaddleClientConfig(env),
    apiBase:
      environment === "production"
        ? "https://api.paddle.com"
        : "https://sandbox-api.paddle.com",
    apiKey: required(env.PADDLE_API_KEY, "PADDLE_API_KEY"),
    discountId: env.PADDLE_DISCOUNT_ID ?? null,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function paddlePost(
  config: PaddleServerConfig,
  path: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new PaddleApiError(path, res.status, await safeText(res));
  }
  return res.json();
}

/**
 * Creates a Paddle transaction for the Team price with `custom_data.org_id`
 * bound server-side (ADR 0011 — the client only ever receives the opaque id).
 * The FOUNDER discount is applied when configured. The overlay collects the
 * customer; the webhook (PR2) records the resulting customer id.
 */
export async function createCheckoutTransaction(
  config: PaddleServerConfig,
  input: { orgId: string; quantity: number },
): Promise<{ transactionId: string }> {
  const json = (await paddlePost(config, "/transactions", {
    items: [{ price_id: config.priceId, quantity: input.quantity }],
    custom_data: { org_id: input.orgId },
    ...(config.discountId ? { discount_id: config.discountId } : {}),
  })) as { data?: { id?: string } };
  const transactionId = json.data?.id;
  if (!transactionId) {
    throw new PaddleApiError("/transactions", 200, "no transaction id in response");
  }
  return { transactionId };
}

export type PortalLinks = {
  overviewUrl: string;
  cancelUrl: string | null;
  updatePaymentUrl: string | null;
};

/**
 * Creates a fresh authenticated customer-portal session (ADR 0011). Passing the
 * subscription id yields per-subscription deep links (cancel / update payment)
 * alongside the authenticated overview. Sessions are temporary + unguessable +
 * auto-expiring, so callers generate one per click and never cache the result.
 */
export async function createPortalSession(
  config: PaddleServerConfig,
  input: { customerId: string; subscriptionIds?: string[] },
): Promise<PortalLinks> {
  const json = (await paddlePost(
    config,
    `/customers/${encodeURIComponent(input.customerId)}/portal-sessions`,
    { subscription_ids: input.subscriptionIds ?? [] },
  )) as {
    data?: {
      urls?: {
        general?: { overview?: string };
        subscriptions?: Array<{
          cancel_subscription?: string;
          update_subscription_payment_method?: string;
        }>;
      };
    };
  };
  const overviewUrl = json.data?.urls?.general?.overview;
  if (!overviewUrl) {
    throw new PaddleApiError("/portal-sessions", 200, "no overview url in response");
  }
  const sub = json.data?.urls?.subscriptions?.[0];
  return {
    overviewUrl,
    cancelUrl: sub?.cancel_subscription ?? null,
    updatePaymentUrl: sub?.update_subscription_payment_method ?? null,
  };
}
