import { latestHeartbeatAt } from "@/db/system";
import { getApiContext } from "@/lib/api-context";
import { evaluateHealth } from "@/lib/health";
import { FixedWindowRateLimiter } from "@/lib/rate-limit";
import { timeStage } from "@/lib/request-timing";

export const dynamic = "force-dynamic";

// Per-IP rate limit for this unauthenticated DB-touching probe (W4-Q). 30
// requests / 60s per client comfortably clears a real uptime monitor (which
// pings every 30–60s) while capping abusive bursts against the DB round-trip.
// Module-scoped in-isolate limiter — plain counters, no I/O (see
// src/lib/rate-limit.ts). Requests with no client IP (local dev, internal
// probes) share the "unknown" bucket rather than bypassing the limit.
const HEALTH_RATE_LIMIT = 30;
const HEALTH_RATE_WINDOW_MS = 60_000;
const healthLimiter = new FixedWindowRateLimiter(
  HEALTH_RATE_LIMIT,
  HEALTH_RATE_WINDOW_MS,
);

// Unauthenticated uptime probe for an external monitor. Reports only ops
// liveness — DB reachability + poller-pipeline freshness — and never any
// tenant data. 200 when healthy, 503 when the DB is unreachable or the
// heartbeat is stale (the cron → queue → consumer → Postgres loop stalled),
// so a persistent `{ db: "ok" }` 503 pinpoints a stuck poller vs a DB outage.
export async function GET(req: Request) {
  // Rate-limit BEFORE the DB probe: a throttled caller must not cost a query.
  const clientIp = req.headers.get("cf-connecting-ip") ?? "unknown";
  const limit = healthLimiter.check(clientIp);
  if (!limit.allowed) {
    return Response.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  let dbOk = false;
  let latestHeartbeat: Date | null = null;
  try {
    const { db } = getApiContext();
    // This query doubles as the DB ping — if it resolves, the DB is reachable.
    // timeStage("db") makes /api/health an unauthenticated probe of the full
    // per-request DB cost (connection setup + one query) in Server-Timing —
    // the incident gauge for Hyperdrive/Neon round-trip latency.
    latestHeartbeat = await timeStage("db", () => latestHeartbeatAt(db));
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
