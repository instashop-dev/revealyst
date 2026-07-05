import { ingestAgentBatch } from "@/lib/agent-ingest";
import { getApiContext } from "@/lib/api-context";

// POST /api/agent/ingest (ADR 0002) — Bearer-authenticated by the device
// token itself; no session. All logic lives in ingestAgentBatch (unit-tested
// against PGlite); this handler only adapts HTTP.

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const { db, env } = getApiContext();
  const outcome = await ingestAgentBatch(db, env, bearer, body);
  return Response.json(outcome.body, { status: outcome.status });
}
