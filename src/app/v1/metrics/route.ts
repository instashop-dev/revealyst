import { getApiContext } from "@/lib/api-context";
import {
  authenticateDeviceToken,
  ingestOtelMetricsAuthed,
} from "@/lib/otel-receiver";

// POST /v1/metrics (W7-8, ADR 0039) — the Claude Code OTLP/HTTP-JSON metrics
// receiver. Bearer-authenticated by the device token itself (no session); the
// OTLP exporter is pointed here with OTEL_EXPORTER_OTLP_ENDPOINT. Auth runs
// FIRST — 401/403 before the body is read, same ordering as /v1/logs, so an
// unauthenticated caller never gets a body-shape signal (400 vs 413) and
// never makes the Worker parse up to 10 MB of JSON. Decode/persist logic
// lives in otel-receiver.ts (unit-tested against PGlite + the real captured
// fixtures); this handler only adapts HTTP. Returns {} on full success (the
// OTLP ExportMetricsServiceResponse convention).
const MAX_BODY_BYTES = 10_000_000;

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  const { db, env } = getApiContext();
  const auth = await authenticateDeviceToken(db, env, bearer);
  if (!auth.ok) {
    return Response.json(auth.body, { status: auth.status });
  }

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

  const outcome = await ingestOtelMetricsAuthed(auth, body);
  return Response.json(outcome.body, { status: outcome.status });
}
