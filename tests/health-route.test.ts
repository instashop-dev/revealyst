import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";

// Route-level check of the /api/health rate limit (W4-Q). The DB probe itself
// can't resolve outside the Workers request context (getCloudflareContext
// throws → the route's try/catch reports db:error/503), but that is orthogonal
// to what this asserts: a caller over the per-IP burst limit is turned away
// with 429 BEFORE any DB work, and distinct IPs have independent budgets.

const req = (ip: string) =>
  new Request("http://localhost/api/health", {
    headers: { "cf-connecting-ip": ip },
  });

describe("GET /api/health rate limiting", () => {
  it("returns 429 once an IP exceeds 30 requests in the window", async () => {
    const ip = "203.0.113.1";
    // 30 allowed (503 here since the DB probe can't run in tests) …
    for (let i = 0; i < 30; i++) {
      const res = await GET(req(ip));
      expect(res.status).not.toBe(429);
    }
    // … the 31st is rate limited.
    const limited = await GET(req(ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: "rate limited" });
  });

  it("gives distinct IPs independent budgets", async () => {
    const fresh = await GET(req("203.0.113.99"));
    expect(fresh.status).not.toBe(429);
  });
});
