import { ingestAgentBatch } from "@/lib/agent-ingest";
import { getApiContext } from "@/lib/api-context";
import { readIngestJson } from "@/lib/ingest-body";

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

  // Reads plain JSON (the CLI) AND a `Content-Encoding: gzip` body (the desktop
  // agent — Cloudflare does not auto-decompress inbound request bodies, so a
  // bare `req.json()` returned 400 on every agent sync). `MAX_BODY_BYTES` here
  // caps the DECOMPRESSED size (the Content-Length check above caps the
  // compressed wire size), so a gzip bomb can't slip past.
  const read = await readIngestJson(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return Response.json({ error: read.error }, { status: read.status });
  }
  const body = read.body;

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
