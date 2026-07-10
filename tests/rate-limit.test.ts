import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/lib/rate-limit";

// In-isolate fixed-window limiter (W4-Q) — the /api/health abuse guard.
// A controllable clock makes the window behavior deterministic.

function clockedLimiter(limit: number, windowMs: number, maxKeys = 10_000) {
  let nowMs = 0;
  const limiter = new FixedWindowRateLimiter(
    limit,
    windowMs,
    () => nowMs,
    maxKeys,
  );
  return {
    limiter,
    advance: (ms: number) => {
      nowMs += ms;
    },
    set: (ms: number) => {
      nowMs = ms;
    },
  };
}

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const { limiter } = clockedLimiter(3, 60_000);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    const blocked = limiter.check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const { limiter, advance } = clockedLimiter(2, 60_000);
    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);
    advance(60_000); // window rolls over
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const { limiter } = clockedLimiter(1, 60_000);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    // A different IP has its own budget.
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("reports a retry-after that shrinks as the window advances", () => {
    const { limiter, advance } = clockedLimiter(1, 60_000);
    limiter.check("ip");
    const first = limiter.check("ip").retryAfterSeconds;
    advance(30_000);
    const later = limiter.check("ip").retryAfterSeconds;
    expect(later).toBeLessThan(first);
    expect(later).toBeGreaterThanOrEqual(1);
  });

  it("hard-caps memory when a flood of distinct keys fills one window", () => {
    // maxKeys=2, single window: three distinct keys can't be swept (none
    // expired), so the map is cleared rather than growing past the cap.
    const { limiter } = clockedLimiter(1, 60_000, 2);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false); // a is now at its limit
    limiter.check("b"); // size = 2 (a, b)
    limiter.check("c"); // hits cap → sweep frees nothing → clear() → set c
    // 'a' was dropped by the clear, so it starts fresh (fail-open, bounded).
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("sweeps expired entries once maxKeys is exceeded (no unbounded growth)", () => {
    // maxKeys=2: after two live keys, a third insert past their window sweeps
    // the stale ones rather than growing forever.
    const { limiter, advance } = clockedLimiter(5, 1_000, 2);
    limiter.check("a");
    limiter.check("b");
    advance(2_000); // both windows expired
    // Inserting a new key triggers a sweep of the expired entries.
    expect(limiter.check("c").allowed).toBe(true);
    // The swept keys start fresh (full budget) rather than carrying old counts.
    expect(limiter.check("a").allowed).toBe(true);
  });
});
