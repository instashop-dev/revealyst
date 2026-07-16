import { getApiContext } from "@/lib/api-context";
import { authenticateDeviceToken } from "@/lib/device-token";
import { recordDesktopDiagnosticsAuthed } from "@/lib/desktop-diagnostics";

// POST /api/desktop/diagnostics (Desktop Agent plan T4.3, spec §23.2) —
// Bearer-authenticated by the device token itself; no web session (the
// getApiContext pattern, like /api/desktop/heartbeat and /api/agent/ingest).
// Auth runs FIRST — 401/403 before the body is read (the same hardening
// /v1/metrics + /v1/logs use): an unauthenticated caller never makes the Worker
// buffer/parse the body and never gets a body-shape 400-vs-413 oracle. The
// authed decode/re-scrub/emit lives in recordDesktopDiagnosticsAuthed
// (unit-tested against PGlite); this handler only adapts HTTP.
//
// The bundle is COUNTS / VERSIONS / STATES / SANITIZED LOGS ONLY. No field
// accepts free-form content: the schema has no payload key AND every string is
// an enum or a bounded version/slug pattern, so an event payload (or an `rva1.`
// token / prose in an id/version field) is rejected 400, not filtered. The one
// multi-line field, logTail, is bounded and re-scrubbed server-side.

export const dynamic = "force-dynamic";

/**
 * Ceiling on the request body. The schema's own maximum is dominated by the log
 * tail — MAX_LOG_LINES (500) × MAX_LOG_LINE_LENGTH (1000) = 500 KB of log text —
 * so this cap sits comfortably above that plus the JSON framing and the
 * (small, bounded) version/state fields. A schema-valid bundle therefore never
 * 413s; anything larger is refused before it is parsed.
 */
const MAX_BODY_BYTES = 640_000;

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  // --- 1. Authenticate BEFORE reading the body (F3, sibling of /v1/metrics) --
  const { db, env } = getApiContext();
  const auth = await authenticateDeviceToken(db, env, bearer);
  if (!auth.ok) {
    return Response.json(auth.body, { status: auth.status });
  }

  // --- 2. Bound + parse the body (authenticated callers only) ---------------
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

  const outcome = recordDesktopDiagnosticsAuthed(auth, body);
  return Response.json(outcome.body, { status: outcome.status });
}
