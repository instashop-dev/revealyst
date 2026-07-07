import { latestHeartbeatAt } from "@/db/system";
import { getApiContext } from "@/lib/api-context";
import { evaluateHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

// Unauthenticated uptime probe for an external monitor. Reports only ops
// liveness — DB reachability + poller-pipeline freshness — and never any
// tenant data. 200 when healthy, 503 when the DB is unreachable or the
// heartbeat is stale (the cron → queue → consumer → Postgres loop stalled),
// so a persistent `{ db: "ok" }` 503 pinpoints a stuck poller vs a DB outage.
export async function GET() {
  let dbOk = false;
  let latestHeartbeat: Date | null = null;
  try {
    const { db } = getApiContext();
    // This query doubles as the DB ping — if it resolves, the DB is reachable.
    latestHeartbeat = await latestHeartbeatAt(db);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const report = evaluateHealth({ dbOk, latestHeartbeat, now: Date.now() });
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
