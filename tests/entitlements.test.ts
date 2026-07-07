import { describe, expect, it } from "vitest";
import {
  FREE_TRACKED_USER_LIMIT,
  resolveAccess,
  trailing30dPeriod,
} from "../src/lib/entitlements";

// W3-M PR4: the free-band access decision. Free covers ≤ the limit; the
// (limit+1)th tracked user paywalls an un-entitled workspace.

describe("resolveAccess (free band)", () => {
  const N = FREE_TRACKED_USER_LIMIT;

  it("free workspace at exactly the limit is NOT blocked", () => {
    expect(
      resolveAccess({ plan: "personal", orgKind: "personal", trackedUsers: N })
        .blocked,
    ).toBe(false);
  });

  it("free workspace one OVER the limit is blocked", () => {
    const a = resolveAccess({
      plan: "personal",
      orgKind: "personal",
      trackedUsers: N + 1,
    });
    expect(a.blocked).toBe(true);
    expect(a.limit).toBe(N);
    expect(a.trackedUsers).toBe(N + 1);
  });

  it("free workspace under the limit is NOT blocked", () => {
    expect(
      resolveAccess({ plan: "personal", orgKind: "personal", trackedUsers: 0 })
        .blocked,
    ).toBe(false);
  });

  it("Team plan is never blocked, even far over the limit", () => {
    expect(
      resolveAccess({ plan: "team", orgKind: "personal", trackedUsers: N * 100 })
        .blocked,
    ).toBe(false);
  });

  it("system orgs are never blocked", () => {
    expect(
      resolveAccess({
        plan: "personal",
        orgKind: "system",
        trackedUsers: N + 50,
      }).blocked,
    ).toBe(false);
  });
});

describe("trailing30dPeriod", () => {
  it("spans 30 inclusive days ending today, as YYYY-MM-DD", () => {
    const p = trailing30dPeriod(new Date("2026-07-30T12:00:00Z"));
    expect(p.end).toBe("2026-07-30");
    expect(p.start).toBe("2026-07-01");
  });
});
