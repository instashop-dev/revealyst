import { z } from "zod";
import type { Db } from "../db/client";
import {
  applyPaddleSubscriptionEvent,
  orgExists,
  type SubscriptionStatus,
} from "../db/subscriptions";

// Paddle Billing webhook ingestion (W3-M PR2). The route handler
// (src/app/api/webhooks/paddle/route.ts) only adapts HTTP; all logic lives
// here and is unit-tested against recorded sandbox payloads (fixtures/paddle),
// so the CI harness proves subscription.* / transaction.completed →
// entitlement transitions without clicking through Paddle. Inbound + third
// party: the payload shape is Paddle's, verified by HMAC signature, so this
// route sits OUTSIDE the frozen typed-client contract (api.ts), alongside the
// health/auth routes.

/** Worker secrets synced from repo secrets; one per Paddle environment. Both
 * the sandbox and live webhooks POST to this one URL, each signed with its own
 * secret, so a request is accepted on a match against EITHER configured one. */
export type PaddleWebhookEnv = {
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_WEBHOOK_SECRET_SANDBOX?: string;
};

// ── Signature verification ────────────────────────────────────────────────
// Header: `Paddle-Signature: ts=<unix>;h1=<hex hmac-sha256>`. The signed
// payload is `${ts}:${rawBody}`, HMAC-SHA256 keyed by the notification
// setting's secret. Verify over the RAW request body — any re-serialization
// changes the bytes and breaks the MAC.

function parseSignatureHeader(
  header: string,
): { ts: string; h1: string } | null {
  let ts = "";
  let h1 = "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "h1") h1 = value;
  }
  return ts && h1 ? { ts, h1 } : null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Buffer.from(signature).toString("hex");
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPaddleSignature(opts: {
  rawBody: string;
  signatureHeader: string | null;
  secrets: readonly string[];
}): Promise<boolean> {
  if (!opts.signatureHeader) return false;
  const parsed = parseSignatureHeader(opts.signatureHeader);
  if (!parsed) return false;
  const message = `${parsed.ts}:${opts.rawBody}`;
  for (const secret of opts.secrets) {
    if (!secret) continue;
    const expected = await hmacHex(secret, message);
    if (timingSafeEqualHex(expected, parsed.h1)) return true;
  }
  return false;
}

// ── Event parsing ─────────────────────────────────────────────────────────
// Lenient by design: Paddle owns this schema and adds fields over time. We
// pin only what we read and let everything else pass through.

const paddleSubscriptionData = z.object({
  id: z.string(),
  status: z.string(),
  customer_id: z.string().nullish(),
  custom_data: z.record(z.string(), z.unknown()).nullish(),
  items: z
    .array(
      z.object({
        price: z.object({ id: z.string() }).nullish(),
        quantity: z.number().nullish(),
      }),
    )
    .nullish(),
  current_billing_period: z
    .object({ starts_at: z.string().nullish(), ends_at: z.string().nullish() })
    .nullish(),
  canceled_at: z.string().nullish(),
});

const paddleEvent = z.object({
  event_id: z.string().nullish(),
  event_type: z.string(),
  occurred_at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const KNOWN_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "paused",
  "canceled",
] as const satisfies readonly SubscriptionStatus[];

function toStatus(raw: string): SubscriptionStatus | null {
  return (KNOWN_STATUSES as readonly string[]).includes(raw)
    ? (raw as SubscriptionStatus)
    : null;
}

/** Parse a Paddle date string, returning null (never an Invalid Date) on a
 * malformed value — an Invalid Date would blow up the timestamptz insert. */
function toDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const uuid = z.string().uuid();

export type WebhookResult = { status: number; body: unknown };

/**
 * Verify, parse, and apply a Paddle webhook. Returns the HTTP status the
 * handler should send. 2xx tells Paddle to stop retrying — so anything we can't
 * act on but that isn't Paddle's fault (unknown status/event, missing
 * passthrough) is acknowledged + ignored rather than 4xx'd into a retry storm;
 * only a genuinely bad request (bad signature, unparseable body) is a 4xx.
 */
export async function handlePaddleWebhook(
  db: Db,
  env: PaddleWebhookEnv,
  input: { rawBody: string; signatureHeader: string | null },
): Promise<WebhookResult> {
  const secrets = [
    env.PADDLE_WEBHOOK_SECRET,
    env.PADDLE_WEBHOOK_SECRET_SANDBOX,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) {
    // Misconfiguration — never accept an unsigned webhook by falling open.
    return { status: 500, body: { error: "webhook secret not configured" } };
  }

  const verified = await verifyPaddleSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    secrets,
  });
  if (!verified) return { status: 401, body: { error: "invalid signature" } };

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }

  const parsed = paddleEvent.safeParse(json);
  if (!parsed.success) {
    return { status: 400, body: { error: "unrecognized event shape" } };
  }
  const event = parsed.data;

  switch (event.event_type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
      return applySubscriptionEvent(db, event.occurred_at, event.data);
    case "transaction.completed":
      // Entitlement is owned by the subscription.* events; a completed
      // transaction is acknowledged (so Paddle stops retrying) but changes no
      // entitlement state.
      return { status: 200, body: { received: true, ignored: "transaction" } };
    default:
      // We subscribe to 4 events; anything else is acknowledged + ignored.
      return { status: 200, body: { received: true, ignored: "event_type" } };
  }
}

async function applySubscriptionEvent(
  db: Db,
  occurredAtRaw: string,
  data: unknown,
): Promise<WebhookResult> {
  const parsed = paddleSubscriptionData.safeParse(data);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid subscription payload" } };
  }
  const sub = parsed.data;

  // Every branch below that "can't act on this, and retrying won't help" acks
  // (200) so Paddle stops retrying — vs. a genuinely transient failure (DB
  // down), which we let throw into a 500 so Paddle DOES retry.

  // The org comes from the checkout's custom-data passthrough (set in PR3). It
  // must be a valid UUID (a malformed value would throw on the uuid cast) AND
  // name an org that still exists (the orgs FK is onDelete:cascade, so a deleted
  // org would throw a foreign-key violation) — either way, ack + ignore.
  const orgId = uuid.safeParse(sub.custom_data?.org_id).data ?? null;
  if (!orgId || !(await orgExists(db, orgId))) {
    return { status: 200, body: { received: true, ignored: "no_org" } };
  }

  // Unknown status (ADR 0009): don't let an unmapped value crash the enum
  // insert — ack + skip so we neither corrupt state nor trigger retries.
  const status = toStatus(sub.status);
  if (!status) {
    return { status: 200, body: { received: true, ignored: "status" } };
  }

  // occurred_at is the ordering key and is required; a non-parseable value can't
  // be fixed on retry, so ack + ignore rather than crash the timestamptz insert.
  const occurredAt = toDate(occurredAtRaw);
  if (!occurredAt) {
    return { status: 200, body: { received: true, ignored: "occurred_at" } };
  }

  const item = sub.items?.[0];
  const priceId = item?.price?.id ?? null;
  if (!priceId) {
    return { status: 200, body: { received: true, ignored: "price" } };
  }

  await applyPaddleSubscriptionEvent(db, {
    orgId,
    paddleSubscriptionId: sub.id,
    occurredAt,
    paddleCustomerId: sub.customer_id ?? null,
    status,
    priceId,
    quantity: item?.quantity ?? 1,
    currentPeriodStart: toDate(sub.current_billing_period?.starts_at),
    currentPeriodEnd: toDate(sub.current_billing_period?.ends_at),
    canceledAt: toDate(sub.canceled_at),
  });
  return { status: 200, body: { received: true } };
}
