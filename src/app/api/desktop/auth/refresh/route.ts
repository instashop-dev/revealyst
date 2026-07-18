import { getApiContext } from "@/lib/api-context";
import { issueDesktopAccessToken } from "@/lib/desktop-refresh";

// POST /api/desktop/auth/refresh (Desktop Agent plan M7 / T7.2, ADR 0058) —
// Bearer-authenticated by the long-lived `rva1.` DEVICE token (the getApiContext
// pattern, like /api/desktop/heartbeat and /api/agent/ingest). No web session,
// no request body. The device token is the REFRESH credential; this route
// hands back a short-lived signed ACCESS token the agent presents on its
// ordinary calls. All logic lives in issueDesktopAccessToken (unit-tested
// against PGlite); this handler only adapts HTTP.
//
// 401 for a missing/malformed/wrong device token, 403 for a paused (revoked)
// connection — identical semantics to every other device-token route. 503
// "not configured" (benign) when the signing key is absent, so the agent
// safely falls back to using its device token directly during rollout.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  const { db, env } = getApiContext();
  // getApiContext narrows env to CredentialEnv; at runtime it is the full
  // Worker env, which also carries DESKTOP_ACCESS_TOKEN_SIGNING_KEY. The
  // DesktopAccessTokenEnv fields are optional, so no cast is needed — an
  // absent key resolves to the benign 503 path.
  const outcome = await issueDesktopAccessToken(db, env, bearer);
  return Response.json(outcome.body, { status: outcome.status });
}
