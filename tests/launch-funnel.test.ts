import { describe, expect, it } from "vitest";
import { isLandingPageView, writeLaunchEvent } from "../src/lib/launch-events";
import {
  deriveAgentOptInRate,
  deriveLaunchFunnel,
  deriveSyncCadence,
  percentile,
  type OrgFunnelRow,
} from "../src/lib/launch-funnel";

const T0 = new Date("2026-07-01T10:00:00Z");
const plusMinutes = (m: number) => new Date(T0.getTime() + m * 60_000);

function row(overrides: Partial<OrgFunnelRow> = {}): OrgFunnelRow {
  return {
    orgId: crypto.randomUUID(),
    kind: "personal",
    createdAt: T0,
    firstConnectionAt: null,
    firstBackfillSuccessAt: null,
    hasScore: false,
    shareLinks: 0,
    members: 1,
    invitesSent: 0,
    invitesAccepted: 0,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns null on empty input (never fabricates a 0)", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("nearest-rank p90", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe("deriveLaunchFunnel", () => {
  it("empty input: zero stages, null rates — no fabricated denominators", () => {
    const f = deriveLaunchFunnel([]);
    expect(f.stages).toEqual({
      orgs: 0,
      connected: 0,
      backfilled: 0,
      activated: 0,
    });
    expect(f.timeToFirstInsight.medianMinutes).toBeNull();
    expect(f.timeToFirstInsight.under10MinRate).toBeNull();
    expect(f.shareCard.rate).toBeNull();
  });

  it("counts each stage independently from timestamps", () => {
    const f = deriveLaunchFunnel([
      row(), // signed up only
      row({ firstConnectionAt: plusMinutes(2) }), // connected, no backfill yet
      row({
        // connected + backfill errored (no success) — not counted as backfilled
        firstConnectionAt: plusMinutes(2),
        firstBackfillSuccessAt: null,
      }),
      row({
        firstConnectionAt: plusMinutes(1),
        firstBackfillSuccessAt: plusMinutes(4),
        hasScore: true,
      }),
    ]);
    expect(f.stages).toEqual({
      orgs: 4,
      connected: 3,
      backfilled: 1,
      activated: 1,
    });
  });

  it("time-to-first-insight anchors on first successful backfill (stable, append-only), not the rewritable score computed_at", () => {
    const f = deriveLaunchFunnel([
      row({ firstBackfillSuccessAt: plusMinutes(6), hasScore: true }),
      row({ firstBackfillSuccessAt: plusMinutes(8), hasScore: true }),
      row({ firstBackfillSuccessAt: plusMinutes(45), hasScore: true }),
      row(), // never synced — excluded from samples
    ]);
    expect(f.timeToFirstInsight.samples).toBe(3);
    expect(f.timeToFirstInsight.medianMinutes).toBe(8);
    expect(f.timeToFirstInsight.p90Minutes).toBe(45);
    expect(f.timeToFirstInsight.under10MinRate).toBeCloseTo(2 / 3);
  });

  it("median is averaged-midpoint on even samples — nearest-rank would bias the §15 headline low", () => {
    const f = deriveLaunchFunnel([
      row({ firstBackfillSuccessAt: plusMinutes(4) }),
      row({ firstBackfillSuccessAt: plusMinutes(28) }),
    ]);
    expect(f.timeToFirstInsight.medianMinutes).toBe(16);
  });

  it("share-card rate uses activated orgs as the denominator", () => {
    const f = deriveLaunchFunnel([
      row({ hasScore: true, shareLinks: 2 }),
      row({ hasScore: true }),
      // shared without a score result should not happen, but if it does it
      // must not inflate the rate: not activated → not in either side.
      row({ shareLinks: 1 }),
    ]);
    expect(f.shareCard).toEqual({
      activated: 2,
      withShareLink: 1,
      rate: 0.5,
    });
  });

  it("personal→team signals: invites, acceptance, multi-member growth", () => {
    const f = deriveLaunchFunnel([
      row({ invitesSent: 3, invitesAccepted: 1, members: 2 }),
      row({ invitesSent: 1 }),
      row({ kind: "team", members: 5, invitesSent: 4, invitesAccepted: 4 }),
      row(),
    ]);
    expect(f.personalToTeam).toEqual({
      personalOrgs: 3,
      teamOrgs: 1,
      personalWithInvites: 2,
      personalWithAcceptedInvites: 1,
      personalMultiMember: 1,
    });
  });
});

describe("deriveSyncCadence", () => {
  it("0 samples: no runs for an org yields no entry at all", () => {
    expect(deriveSyncCadence([])).toEqual([]);
  });

  it("1 sample: a single finished run has zero gaps — null median/p90, never a fabricated 0", () => {
    const result = deriveSyncCadence([{ orgId: "a", finishedAt: T0 }]);
    expect(result).toEqual([
      { orgId: "a", samples: 0, medianMinutes: null, p90Minutes: null },
    ]);
  });

  it("N samples: verifies median/p90 math over inter-arrival gaps", () => {
    const result = deriveSyncCadence([
      { orgId: "a", finishedAt: T0 },
      { orgId: "a", finishedAt: plusMinutes(10) }, // gap 10
      { orgId: "a", finishedAt: plusMinutes(30) }, // gap 20
      { orgId: "a", finishedAt: plusMinutes(90) }, // gap 60
    ]);
    expect(result).toEqual([
      { orgId: "a", samples: 3, medianMinutes: 20, p90Minutes: 60 },
    ]);
  });

  it("unsorted input: sorts defensively per org before computing gaps", () => {
    const result = deriveSyncCadence([
      { orgId: "a", finishedAt: plusMinutes(30) },
      { orgId: "a", finishedAt: T0 },
      { orgId: "a", finishedAt: plusMinutes(10) },
    ]);
    expect(result).toEqual([
      { orgId: "a", samples: 2, medianMinutes: 15, p90Minutes: 20 },
    ]);
  });

  it("null finishedAt rows are skipped — no interval information to contribute", () => {
    const result = deriveSyncCadence([
      { orgId: "a", finishedAt: T0 },
      { orgId: "a", finishedAt: null },
      { orgId: "a", finishedAt: plusMinutes(10) },
    ]);
    expect(result).toEqual([
      { orgId: "a", samples: 1, medianMinutes: 10, p90Minutes: 10 },
    ]);
  });

  it("multiple orgs are kept independent", () => {
    const result = deriveSyncCadence([
      { orgId: "a", finishedAt: T0 },
      { orgId: "a", finishedAt: plusMinutes(10) },
      { orgId: "b", finishedAt: T0 },
      { orgId: "b", finishedAt: plusMinutes(50) },
    ]);
    expect(result).toEqual([
      { orgId: "a", samples: 1, medianMinutes: 10, p90Minutes: 10 },
      { orgId: "b", samples: 1, medianMinutes: 50, p90Minutes: 50 },
    ]);
  });
});

describe("deriveAgentOptInRate", () => {
  it("empty input: null rate, no fabricated denominator", () => {
    expect(deriveAgentOptInRate([])).toEqual({
      activated: 0,
      withAgentConnection: 0,
      rate: null,
    });
  });

  it("counts orgs with/without the agent connection among activated orgs", () => {
    const result = deriveAgentOptInRate([
      { orgId: "a", hasScore: true, hasAgentConnection: true },
      { orgId: "b", hasScore: true, hasAgentConnection: false },
      { orgId: "c", hasScore: true, hasAgentConnection: true },
    ]);
    expect(result).toEqual({
      activated: 3,
      withAgentConnection: 2,
      rate: 2 / 3,
    });
  });

  it("excludes non-activated orgs from the denominator, even if agent-connected", () => {
    const result = deriveAgentOptInRate([
      { orgId: "a", hasScore: true, hasAgentConnection: true },
      // Not activated: shouldn't happen (agent connection usually implies
      // synced data), but if it does it must not dilute the denominator.
      { orgId: "b", hasScore: false, hasAgentConnection: true },
    ]);
    expect(result).toEqual({
      activated: 1,
      withAgentConnection: 1,
      rate: 1,
    });
  });
});

describe("isLandingPageView", () => {
  // The Worker-entry guard for the §15 landing_view write (src/worker.ts) —
  // the landing page is a build-time prerender now (perf/edge-caching), so
  // the per-request event fires at the edge seam, gated by this predicate.
  // The third arg is isRscRequest (headers.has("rsc")), NOT the Accept header.
  it("matches GET/HEAD of exactly / for ANY Accept — the old crawler-inclusive series", () => {
    expect(isLandingPageView("GET", "/", false)).toBe(true);
    expect(isLandingPageView("HEAD", "/", false)).toBe(true);
  });

  it("counts the non-text/html segment the old in-render write counted", () => {
    // The OLD force-dynamic render fired for every GET/HEAD of / regardless of
    // Accept — curl, uptime monitors, and crawlers/scrapers that send `*/*` or
    // no Accept. isRscRequest is false for all of these, so they still count;
    // gating on text/html (as the first draft did) would silently drop them.
    // (Accept is not even an input here anymore — these are all `false` = not
    // an RSC fetch, so all counted.)
    expect(isLandingPageView("GET", "/", false)).toBe(true); // Accept: */* or missing
  });

  it("excludes ONLY the RSC soft-nav / prefetch fetch — the one deliberate reduction", () => {
    expect(isLandingPageView("GET", "/", true)).toBe(false);
    expect(isLandingPageView("HEAD", "/", true)).toBe(false);
  });

  it("rejects other paths and methods", () => {
    expect(isLandingPageView("GET", "/sign-in", false)).toBe(false);
    expect(isLandingPageView("GET", "/legal/terms", false)).toBe(false);
    expect(isLandingPageView("POST", "/", false)).toBe(false);
    expect(isLandingPageView("GET", "/api/health", false)).toBe(false);
  });
});

describe("writeLaunchEvent", () => {
  it("no-ops without a dataset binding", () => {
    expect(() => writeLaunchEvent(undefined, "landing_view")).not.toThrow();
  });

  it("writes name + coarse dim + host only — the no-PII data-point shape", () => {
    const points: unknown[] = [];
    const dataset = {
      writeDataPoint: (p: unknown) => void points.push(p),
    } as AnalyticsEngineDataset;
    writeLaunchEvent(dataset, "share_card_view", "fluency", "revealyst.thapi.workers.dev");
    writeLaunchEvent(dataset, "landing_view");
    expect(points).toEqual([
      {
        blobs: ["share_card_view", "fluency", "revealyst.thapi.workers.dev"],
        doubles: [1],
        indexes: ["share_card_view"],
      },
      { blobs: ["landing_view", "", ""], doubles: [1], indexes: ["landing_view"] },
    ]);
  });

  it("swallows a throwing sink — metrics never break a render", () => {
    const dataset = {
      writeDataPoint: () => {
        throw new Error("sink down");
      },
    } as unknown as AnalyticsEngineDataset;
    expect(() => writeLaunchEvent(dataset, "landing_view")).not.toThrow();
  });
});
