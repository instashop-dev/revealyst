import { describe, expect, it } from "vitest";
import {
  evaluateHealth,
  HEARTBEAT_STALE_SECONDS,
} from "../src/lib/health";

// The /api/health route is a thin wrapper (getApiContext + latestHeartbeatAt);
// the decision logic lives in evaluateHealth so it can be exercised directly.
describe("evaluateHealth", () => {
  const now = new Date("2026-07-07T12:00:00Z").getTime();
  const ago = (seconds: number) => new Date(now - seconds * 1000);

  it("healthy: db reachable and a fresh heartbeat", () => {
    const r = evaluateHealth({ dbOk: true, latestHeartbeat: ago(60), now });
    expect(r).toEqual({
      ok: true,
      db: "ok",
      heartbeatAgeSeconds: 60,
      heartbeatFresh: true,
    });
  });

  it("degraded: db reachable but the heartbeat is stale (poller stalled)", () => {
    const r = evaluateHealth({
      dbOk: true,
      latestHeartbeat: ago(HEARTBEAT_STALE_SECONDS + 1),
      now,
    });
    expect(r.ok).toBe(false);
    expect(r.db).toBe("ok"); // distinguishes a stuck poller from a DB outage
    expect(r.heartbeatFresh).toBe(false);
  });

  it("boundary: a heartbeat exactly at the threshold is still fresh", () => {
    const r = evaluateHealth({
      dbOk: true,
      latestHeartbeat: ago(HEARTBEAT_STALE_SECONDS),
      now,
    });
    expect(r.heartbeatFresh).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("no heartbeat yet: not ok, age is null (never negative/NaN)", () => {
    const r = evaluateHealth({ dbOk: true, latestHeartbeat: null, now });
    expect(r.ok).toBe(false);
    expect(r.heartbeatAgeSeconds).toBeNull();
    expect(r.heartbeatFresh).toBe(false);
  });

  it("db unreachable: not ok regardless of heartbeat", () => {
    const r = evaluateHealth({ dbOk: false, latestHeartbeat: ago(1), now });
    expect(r.ok).toBe(false);
    expect(r.db).toBe("error");
  });

  it("clamps a future-dated heartbeat to a non-negative age", () => {
    const r = evaluateHealth({ dbOk: true, latestHeartbeat: ago(-30), now });
    expect(r.heartbeatAgeSeconds).toBe(0);
  });
});
