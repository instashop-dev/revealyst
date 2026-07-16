import { getApiContext } from "@/lib/api-context";
import { recordDesktopDiagnostics } from "@/lib/desktop-diagnostics";

// POST /api/desktop/diagnostics (Desktop Agent plan T4.3, spec §23.2) —
// Bearer-authenticated by the device token itself; no web session (the
// getApiContext pattern, like /api/desktop/heartbeat and /api/agent/ingest).
// All logic lives in recordDesktopDiagnostics (unit-tested against PGlite);
// this handler only adapts HTTP.
//
// The bundle is COUNTS / VERSIONS / STATES / SANITIZED LOGS ONLY. The zod
// schema has NO field that can carry an activity payload, so an event payload
// is structurally impossible (rejected 400), not filtered.

export const dynamic = "force-dynamic";

/**
 * A diagnostic bundle is small (a few versions/states + a bounded, sanitized
 * log tail). This ceiling is hostile to amplification while leaving generous
 * headroom for MAX_LOG_LINES × MAX_LOG_LINE_LENGTH plus the structured fields.
 */
const MAX_BODY_BYTES = 256_000;

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
  const outcome = await recordDesktopDiagnostics(db, env, bearer, body);
  return Response.json(outcome.body, { status: outcome.status });
}
