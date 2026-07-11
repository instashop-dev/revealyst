import { ingestAgentBatch } from "@/lib/agent-ingest";
import { getApiContext } from "@/lib/api-context";

// POST /api/agent/ingest (ADR 0002) — Bearer-authenticated by the device
// token itself; no session. All logic lives in ingestAgentBatch (unit-tested
// against PGlite); this handler only adapts HTTP.

/** Generous for ~90 days of per-day metric rows, hostile to amplification. */
const MAX_BODY_BYTES = 10_000_000;

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const { db, env } = getApiContext();
  const outcome = await ingestAgentBatch(db, env, bearer, body, {
    // getApiContext narrows the runtime env to CredentialEnv for typing,
    // but the object is the full CloudflareEnv — same widening the poll
    // routes get via handleApi's ctx.env. POLL_QUEUE is bound in
    // wrangler.jsonc; the send itself is best-effort inside the lib.
    send: async (message) => {
      await (env as unknown as CloudflareEnv).POLL_QUEUE.send(message);
    },
  });
  return Response.json(outcome.body, { status: outcome.status });
}
