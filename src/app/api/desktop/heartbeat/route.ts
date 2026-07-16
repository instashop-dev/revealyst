import { getApiContext } from "@/lib/api-context";
import { recordDesktopHeartbeat } from "@/lib/desktop-heartbeat";

// POST /api/desktop/heartbeat (Desktop Agent plan T2.4) — Bearer-authenticated
// by the device token itself; no web session (the getApiContext pattern, like
// /api/agent/ingest). All logic lives in recordDesktopHeartbeat (unit-tested
// against PGlite); this handler only adapts HTTP.

export const dynamic = "force-dynamic";

/** A heartbeat is two small fields — a tight ceiling, hostile to amplification. */
const MAX_BODY_BYTES = 10_000;

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
  const outcome = await recordDesktopHeartbeat(db, env, bearer, body);
  return Response.json(outcome.body, { status: outcome.status });
}
