import { getApiContext } from "@/lib/api-context";
import { authenticateDeviceToken } from "@/lib/device-token";
import {
  composeAndSignDesktopConfig,
  type DesktopConfigSigningEnv,
} from "@/lib/desktop-config";

// GET /api/desktop/config (Desktop Agent plan T4.2, spec §17) — the signed
// remote configuration the agent fetches. Bearer-authenticated by the device
// token itself (the getApiContext pattern, like /api/desktop/heartbeat and
// /api/agent/ingest); no web session. A revoked (paused) device gets 403, an
// unknown/malformed token 401 — the shared authenticateDeviceToken verifier
// (T2.1), so these semantics never drift from the other device-token routes.
//
// The response is config-and-signature ONLY. It carries NO per-user data and
// NO counts — the config is identical for every device in the fleet, so a
// device that authenticates learns nothing about anyone. The Ed25519 signature
// lets the agent trust it without trusting the transport (spec §17.2).

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  const { db, env } = getApiContext();
  const auth = await authenticateDeviceToken(db, env, bearer);
  if (!auth.ok) {
    return Response.json(auth.body, { status: auth.status });
  }

  // The signing key lives on the same Worker env (a distinct Worker secret,
  // DESKTOP_CONFIG_SIGNING_KEY). Compose + sign per request — configs are
  // minted fresh (issuedAt/expiresAt are current), never stored.
  const signed = await composeAndSignDesktopConfig(
    env as unknown as DesktopConfigSigningEnv,
  );
  return Response.json(signed, { status: 200 });
}
