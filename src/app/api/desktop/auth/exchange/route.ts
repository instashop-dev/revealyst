import { getApiContext } from "@/lib/api-context";
import { exchangeDesktopPairing } from "@/lib/desktop-pairing";

// POST /api/desktop/auth/exchange (Desktop Agent T2.2, ADR 0045) — the
// desktop agent exchanges its one-time code + PKCE verifier for the device
// token. Unauthenticated by session (like /v1/metrics): possession of the
// code AND the verifier is the credential. All verification + the
// single-use CAS + the connection/token mint live in
// src/lib/desktop-pairing.ts (unit-tested against PGlite); this handler
// only adapts HTTP. The token appears exactly once, in this response.

export async function POST(req: Request) {
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
