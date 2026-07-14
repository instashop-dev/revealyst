import { getApiContext } from "@/lib/api-context";
import { ingestOtelMetrics } from "@/lib/otel-receiver";

// POST /v1/metrics (W7-8, ADR 0039) — the Claude Code OTLP/HTTP-JSON metrics
// receiver. Bearer-authenticated by the device token itself (no session); the
// OTLP exporter is pointed here with OTEL_EXPORTER_OTLP_ENDPOINT. All logic lives
// in ingestOtelMetrics (unit-tested against PGlite + the real captured
// fixtures); this handler only adapts HTTP. Returns {} on full success (the OTLP
// ExportMetricsServiceResponse convention).
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
  const outcome = await ingestOtelMetrics(db, env, bearer, body);
  return Response.json(outcome.body, { status: outcome.status });
}
