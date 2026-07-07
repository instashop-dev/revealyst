/**
 * Pure health-evaluation logic for the /api/health uptime probe, split from
 * the route so it's unit-testable without the Workers/Next request context.
 */

/**
 * A heartbeat older than 3 missed 5-min cron ticks means the
 * cron → queue → consumer → Postgres pipeline is stalled, even if the
 * database itself answers. Tuned to tolerate a single skipped tick.
 */
export const HEARTBEAT_STALE_SECONDS = 15 * 60;

export type HealthReport = {
  /** db reachable AND the poller pipeline is ticking. */
  ok: boolean;
  db: "ok" | "error";
  /** Seconds since the last heartbeat; null before the first tick. */
  heartbeatAgeSeconds: number | null;
  heartbeatFresh: boolean;
};

export function evaluateHealth(input: {
  dbOk: boolean;
  latestHeartbeat: Date | null;
  now: number;
}): HealthReport {
  const { dbOk, latestHeartbeat, now } = input;
  const heartbeatAgeSeconds = latestHeartbeat
    ? Math.max(0, Math.floor((now - latestHeartbeat.getTime()) / 1000))
    : null;
  const heartbeatFresh =
    heartbeatAgeSeconds !== null &&
    heartbeatAgeSeconds <= HEARTBEAT_STALE_SECONDS;
  return {
    ok: dbOk && heartbeatFresh,
    db: dbOk ? "ok" : "error",
    heartbeatAgeSeconds,
    heartbeatFresh,
  };
}
