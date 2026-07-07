import { getApiContext } from "@/lib/api-context";
import {
  handlePaddleWebhook,
  type PaddleWebhookEnv,
} from "@/lib/paddle-webhook";

// POST /api/webhooks/paddle (W3-M PR2) — inbound Paddle Billing webhook,
// authenticated by its HMAC signature (not a session). All logic lives in
// handlePaddleWebhook (unit-tested against fixtures/paddle); this handler only
// adapts HTTP. The RAW body must reach the verifier unmodified — never
// re-serialize it before checking the signature.
//
// PR3 SECURITY NOTE: the org a subscription is attributed to comes from Paddle's
// custom_data.org_id passthrough. PR3's checkout MUST set that server-side from
// the authenticated session — never from client input — or a caller could name
// another org. This handler validates the id but cannot re-authenticate intent.

/** Paddle events are small; anything larger is not a real webhook. */
const MAX_BODY_BYTES = 1_000_000;

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }

  const rawBody = await req.text();
  // The Content-Length check above is a fast reject; a chunked/absent header
  // bypasses it, so bound the actually-read bytes too before any work.
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
  const signatureHeader = req.headers.get("paddle-signature");

  const { db, env } = getApiContext();
  const result = await handlePaddleWebhook(
    db,
    env as unknown as PaddleWebhookEnv,
    { rawBody, signatureHeader },
  );
  return Response.json(result.body, { status: result.status });
}
