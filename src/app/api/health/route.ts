import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";
import { latestHeartbeatAt } from "@/db/system";
import { getApiContext } from "@/lib/api-context";
import { evaluateHealth } from "@/lib/health";
import { FixedWindowRateLimiter } from "@/lib/rate-limit";
import { timeStage } from "@/lib/request-timing";

export const dynamic = "force-dynamic";

// TEMPORARY root-cause diagnostic (REMOVE after confirmation): times a
// representative multi-query batch under different postgres.js pool configs
// against the REAL prod Hyperdrive/Neon path, to isolate whether prepare/max
// account for the slow post-sign-in authenticated multi-query load. Token-gated
// and rate-limited; read-only (trivial `select <int>` catalog-free queries, no
// tenant data). Reports the (credential-redacted) connection host so the
// local-socket detection in src/db/client.ts can be validated in prod.
async function runPoolDiagnostic(): Promise<Response> {
  const { env } = getCloudflareContext();
  const cs =
    (env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE
      ?.connectionString ?? "";
  const host = (() => {
    try {
      return new URL(cs.replace(/^postgres(ql)?:\/\//, "http://")).host;
    } catch {
      return "unparseable";
    }
  })();
  const N = 8;
  const combos = [
    { label: "current_max1_prepFalse", max: 1, prepare: false },
    { label: "max5_prepFalse", max: 5, prepare: false },
    { label: "recommended_max5_prepTrue", max: 5, prepare: true },
  ] as const;
  const results: Record<string, unknown> = { host, N, unit: "ms" };
  for (const combo of combos) {
    const c = postgres(cs, {
      max: combo.max,
      prepare: combo.prepare,
      fetch_types: false,
      connect_timeout: 10,
      idle_timeout: 5,
    });
    try {
      // Warm once so a prepare:true client's statement cache is hot for the
      // timed run (distinct SQL texts via .unsafe → each is its own statement).
      await Promise.all(
        Array.from({ length: N }, (_, i) => c.unsafe(`select ${i}::int as n`)),
      );
      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: N }, (_, i) => c.unsafe(`select ${i}::int as n`)),
      );
      results[combo.label] = { batchMs: Math.round(performance.now() - t0) };
    } catch (e) {
      results[combo.label] = { error: String((e as Error)?.message ?? e) };
    } finally {
      try {
        await c.end({ timeout: 5 });
      } catch {
        /* ignore */
      }
    }
  }
  return Response.json(results, { headers: { "cache-control": "no-store" } });
}

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

  // TEMPORARY: token-gated pool diagnostic (see runPoolDiagnostic). Remove
  // once the prepare/max root cause is confirmed in prod.
  if (
    new URL(req.url).searchParams.get("diag") === "hyperdrive-probe-2026"
  ) {
    try {
      return await runPoolDiagnostic();
    } catch (e) {
      return Response.json(
        { diagError: String((e as Error)?.message ?? e) },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
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
