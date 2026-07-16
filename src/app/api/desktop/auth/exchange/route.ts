import { getApiContext } from "@/lib/api-context";
import { exchangeDesktopPairing } from "@/lib/desktop-pairing";

// POST /api/desktop/auth/exchange (Desktop Agent T2.2, ADR 0047) — the
// desktop agent exchanges its one-time code + PKCE verifier for the device
// token. Unauthenticated by session (like /v1/metrics): possession of the
// code AND the verifier is the credential. All verification + the
// single-use CAS + the connection/token mint live in
// src/lib/desktop-pairing.ts (unit-tested against PGlite); this handler
// only adapts HTTP. The token appears exactly once, in this response.

// Exchange payloads are tiny; the cap exists because every unauthenticated
// JSON route carries one (the agent-ingest / /v1/* sibling guard).
const MAX_BODY_BYTES = 64_000;

export async function POST(req: Request) {
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
  const outcome = await exchangeDesktopPairing(db, env, body);
  return Response.json(outcome.body, { status: outcome.status });
}
