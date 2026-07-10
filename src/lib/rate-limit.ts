/**
 * Dependency-free, in-isolate fixed-window rate limiter (W4-Q).
 *
 * Used to throttle the unauthenticated /api/health probe, which runs a real DB
 * round-trip and is otherwise trivially abusable. Best-effort by design: a
 * Workers isolate is ephemeral and one of many per colo, so the counters live
 * only for this isolate's lifetime and aren't shared globally. That is the
 * right trade for an abuse guard on a liveness endpoint — it caps a single hot
 * isolate cheaply without a Durable Object, a KV round-trip, or a rate-limiting
 * binding (which would add a wrangler resource + CI wiring). A determined
 * distributed attacker is Cloudflare's edge DDoS layer's job, not this.
 *
 * The in-memory `Map` is legitimately module-scoped: unlike DB/auth clients
 * (which hold cross-request I/O the runtime cancels — see CLAUDE.md), these are
 * plain counters with no I/O, exactly the intended use of isolate-global state.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window rolls over (for a `Retry-After` header). */
  retryAfterSeconds: number;
};

type Window = { count: number; windowStart: number };

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    /** Sweep expired entries once the map grows past this, so a churn of
     * distinct keys can't leak memory across an isolate's lifetime. */
    private readonly maxKeys: number = 10_000,
  ) {}

  check(key: string): RateLimitResult {
    const nowMs = this.now();
    const existing = this.hits.get(key);

    if (!existing || nowMs - existing.windowStart >= this.windowMs) {
      // No window, or the previous one has fully elapsed: start a fresh one.
      if (this.hits.size >= this.maxKeys) {
        this.sweep(nowMs);
        // A flood of DISTINCT keys inside one window frees nothing (no window
        // elapsed). Hard-cap memory by dropping all counters — best-effort
        // limiter: worst case some keys reset early (fail-open), never OOM.
        if (this.hits.size >= this.maxKeys) {
          this.hits.clear();
        }
      }
      this.hits.set(key, { count: 1, windowStart: nowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + this.windowMs - nowMs) / 1000),
    );
    if (existing.count >= this.limit) {
      return { allowed: false, retryAfterSeconds };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drop entries whose window has fully elapsed. Cheap amortized cleanup. */
  private sweep(nowMs: number): void {
    for (const [key, window] of this.hits) {
      if (nowMs - window.windowStart >= this.windowMs) {
        this.hits.delete(key);
      }
    }
  }
}
