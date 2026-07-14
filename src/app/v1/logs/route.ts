// POST /v1/logs (W7-8, ADR 0039) — the Claude Code OTLP/HTTP-JSON LOGS endpoint.
// The Claude Code exporter sends both metrics and logs; this endpoint ACCEPTS
// logs (so the exporter doesn't error) and returns the OTLP success response.
// The proficiency markers W7-8 uses today come from the METRICS stream
// (/v1/metrics: active_time + code_edit decisions); extracting additional
// markers from log events (tool_decision / mcp_server_connection) is a
// documented follow-up, so this endpoint intentionally does not persist yet.
// Bearer-authenticated shape only (the token is verified when it carries
// metrics); a malformed body is rejected so the exporter surfaces it.
const MAX_BODY_BYTES = 10_000_000;

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
  try {
    await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  // {} = OTLP ExportLogsServiceResponse full success (accepted, not yet mined).
  return Response.json({}, { status: 200 });
}
