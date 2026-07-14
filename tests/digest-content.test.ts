import { describe, expect, it } from "vitest";
import {
  assembleDigest,
  digestFreshness,
  isoWeekString,
  type DigestConnection,
} from "../src/lib/digest-content";
import { renderDigestEmail } from "../src/lib/digest-email";
import type { ScoreTrend } from "../src/lib/dashboard-trends";
import type { RecentMovement } from "../src/lib/recent-movement";
import { deriveAttention, type ComponentDetailRow } from "../src/lib/score-insights";
import { LEGACY_CATALOG_RECOMMENDATIONS } from "./fixtures/recommendation-catalog";

// Pure honesty tests for the weekly-digest assembly (F2.2): staleness
// suppression (G5), the aggregate-only team lane (no per-person data), and the
// honest first/notComparable delta rendering (never a fabricated 0%).

const NOW = new Date("2026-07-06T14:00:00.000Z"); // a Monday
const DAY = 24 * 60 * 60 * 1000;

function conn(
  vendor: string,
  status: DigestConnection["status"],
  lastSuccessAt: Date | null,
): DigestConnection {
  return { vendor, status, lastSuccessAt };
}

function emptyMovement(): RecentMovement {
  return {
    periodDays: 28,
    currentFrom: "2026-06-08",
    currentTo: "2026-07-05",
    previousFrom: "2026-05-11",
    previousTo: "2026-06-07",
    metrics: [
      { key: "reported_spend", unit: "cents", current: 0, delta: { kind: "notComparable", reason: "noData" } },
      { key: "active_people", unit: "count", current: 3, delta: { kind: "first", current: 3 } },
      {
        key: "active_days",
        unit: "count",
        current: 20,
        delta: { kind: "delta", current: 20, previous: 16, delta: 4, pctChange: 25, previousPeriodLabel: "May 11–Jun 7" },
      },
    ],
  };
}

/** A weak, measured component that maps to a real CoachingRecommendation
 * (adoption.active_days) — so `deriveAttention` emits a coaching rec. */
function weakActiveDays(): { slug: "adoption"; components: ComponentDetailRow[] } {
  return {
    slug: "adoption",
    components: [
      {
        key: "active_days",
        label: "active_days",
        kind: "plain",
        omitted: false,
        normalized: 5,
        weight: 0.5,
        calcSimple: "calc",
      },
    ],
  };
}

function trend(slug: string, values: number[]): ScoreTrend {
  return {
    slug,
    points: values.map((value, i) => ({
      periodStart: `2026-0${i + 1}-01`,
      periodEnd: `2026-0${i + 1}-28`,
      value,
      periodGrain: "month" as const,
      definitionVersion: 1,
    })),
  };
}

describe("digestFreshness (G5)", () => {
  it("suppresses when no usable connection synced within the window", () => {
    const stale = new Date(NOW.getTime() - 30 * DAY);
    const f = digestFreshness([conn("openai", "active", stale)], NOW);
    expect(f.suppressed).toBe(true);
    expect(f.annotations.length).toBe(1); // the stale channel is annotated
  });

  it("does not suppress when at least one usable connection is fresh", () => {
    const fresh = new Date(NOW.getTime() - 1 * DAY);
    const stale = new Date(NOW.getTime() - 30 * DAY);
    const f = digestFreshness(
      [conn("openai", "active", fresh), conn("cursor", "active", stale)],
      NOW,
    );
    expect(f.suppressed).toBe(false);
    expect(f.freshest?.getTime()).toBe(fresh.getTime());
    // The stale channel is still called out explicitly.
    expect(f.annotations.some((a) => a.includes("Cursor"))).toBe(true);
  });

  it("ignores errored/paused connections as freshness evidence", () => {
    const fresh = new Date(NOW.getTime() - 1 * DAY);
    const f = digestFreshness([conn("openai", "error", fresh)], NOW);
    expect(f.suppressed).toBe(true); // the only synced conn is errored → not usable
  });

  it("annotates a never-synced usable channel", () => {
    const fresh = new Date(NOW.getTime() - 1 * DAY);
    const f = digestFreshness(
      [conn("openai", "active", fresh), conn("cursor", "pending", null)],
      NOW,
    );
    expect(f.suppressed).toBe(false);
    expect(f.annotations.some((a) => a.toLowerCase().includes("hasn't completed"))).toBe(
      true,
    );
  });
});

describe("assembleDigest lanes + honesty", () => {
  const fresh = new Date(NOW.getTime() - 1 * DAY);
  const base = {
    now: NOW,
    connections: [conn("openai", "active", fresh)],
    movement: emptyMovement(),
    trends: [trend("adoption", [40, 55])] as ScoreTrend[],
    scoreComponents: [],
  };

  it("personal lane surfaces a new personal best; team lane never does", () => {
    const personal = assembleDigest({ ...base, lane: "personal" });
    const team = assembleDigest({ ...base, lane: "team" });
    // 55 STRICTLY exceeds the prior max (40) → new personal best (personal only).
    expect(personal.personalBest?.slug).toBe("adoption");
    expect(personal.personalBest?.isNewBest).toBe(true);
    expect(team.personalBest).toBeNull();
  });

  it("a flat trend never claims a new personal best (strict >, prior points only)", () => {
    // The invariant-b regression: with best computed over ALL points and a
    // `>=` compare, [55, 55] claimed "new personal best" every week forever.
    const flat = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [55, 55])],
    });
    expect(flat.personalBest).toBeNull();
    const longFlat = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [55, 55, 55, 55])],
    });
    expect(longFlat.personalBest).toBeNull();
  });

  it("a tie with the prior max is not a NEW best", () => {
    // Current merely EQUALS an earlier high — nothing new was achieved.
    const tied = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [60, 40, 60])],
    });
    expect(tied.personalBest).toBeNull();
  });

  it("a genuine strict new max claims the best exactly once", () => {
    const rising = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [60, 40, 61])],
    });
    expect(rising.personalBest?.isNewBest).toBe(true);
    // A single point has no prior baseline — never a "new best".
    const single = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [90])],
    });
    expect(single.personalBest).toBeNull();
  });

  it("team-lane HTML contains no person identifiers", () => {
    const team = assembleDigest({ ...base, lane: "team" });
    const html = renderDigestEmail(team, {
      unsubscribeUrl: "https://app.example/api/digest/unsubscribe?token=t",
      manageUrl: "https://app.example/settings",
    });
    // The aggregate lane renders counts + score labels only. Guard against a
    // regression that ever interpolated a name/pseudonym/email.
    expect(html).not.toMatch(/@/); // no email addresses (unsubscribe url has none)
    expect(html.toLowerCase()).not.toContain("person-");
    expect(html.toLowerCase()).not.toContain("pseudonym");
    // It does render the aggregate movement + score sections.
    expect(html).toContain("Active people");
    expect(html).toContain("Adoption");
  });

  it("renders first/notComparable honestly, never a fabricated 0%", () => {
    const content = assembleDigest({ ...base, lane: "team" });
    const html = renderDigestEmail(content, {
      unsubscribeUrl: "https://app.example/u",
      manageUrl: "https://app.example/settings",
    });
    expect(html).toContain("first week tracked");
    expect(html).toContain("not comparable to the previous period");
    // Never a fabricated "no change" percentage on a first/notComparable metric.
    expect(html).not.toContain("+0%");
    expect(html).not.toContain("(0%)");
  });

  it("suppresses when the only connection is stale", () => {
    const stale = new Date(NOW.getTime() - 30 * DAY);
    const content = assembleDigest({
      ...base,
      lane: "personal",
      connections: [conn("openai", "active", stale)],
    });
    expect(content.suppressed).toBe(true);
  });

  it("always exposes a data-as-of date when something synced", () => {
    const content = assembleDigest({ ...base, lane: "personal" });
    expect(content.dataAsOfDate).toBe("2026-07-05");
  });
});

describe("reserved coaching slot (errata §1.2(7))", () => {
  const fresh = new Date(NOW.getTime() - 1 * DAY);

  it("digest & dashboard share the SAME coaching source (W7-4): identical rec selection + order", () => {
    // The dashboard and the digest both drive `deriveAttention` off the SAME
    // catalog + score components, so they can never recommend different things
    // for the same person. This pins that shared source: the digest's coaching
    // recs equal deriveAttention's, in the same order (the utility ranking runs
    // identically on both paths).
    const scoreComponents = [weakActiveDays()];
    const dashboard = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
      scoreComponents,
      recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
    })
      .filter((i) => i.kind === "recommendation")
      .map((i) => i.recId);
    const digest = assembleDigest({
      now: NOW,
      lane: "personal",
      connections: [conn("openai", "active", fresh)],
      movement: emptyMovement(),
      trends: [],
      scoreComponents,
      recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
    }).recommendations
      .filter((i) => i.kind === "recommendation")
      .map((i) => i.recId);
    // The digest's coaching recs are a prefix of the dashboard's (same engine,
    // same order; the digest may reserve fewer slots) — never a different set.
    expect(digest.length).toBeGreaterThan(0);
    expect(dashboard.slice(0, digest.length)).toEqual(digest);
  });

  it("a week WITH connection errors still ships ≥1 coaching rec (W5-F acceptance)", () => {
    // Three errored connections (impact 100 each) would fill all 3 slots under
    // the old flat slice, burying coaching (impact 1). The reserve guarantees
    // guidance still gets through. A fresh active connection keeps the digest
    // from staleness-suppressing.
    const content = assembleDigest({
      now: NOW,
      lane: "personal",
      connections: [
        conn("openai", "active", fresh),
        conn("cursor", "error", fresh),
        conn("copilot", "error", fresh),
        conn("gemini", "error", fresh),
      ],
      movement: emptyMovement(),
      trends: [],
      scoreComponents: [weakActiveDays()],
      recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
    });
    expect(content.suppressed).toBe(false);
    const coaching = content.recommendations.filter(
      (r) => r.kind === "recommendation",
    );
    expect(coaching.length).toBeGreaterThanOrEqual(1);
    // The action alerts are still present (they weren't dropped for coaching).
    expect(content.recommendations.some((r) => r.severity === "action")).toBe(true);
    // Never exceeds the cap.
    expect(content.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("kind-aware email: coaching renders as 'Guidance', an errored connection as 'Needs attention'", () => {
    const content = assembleDigest({
      now: NOW,
      lane: "personal",
      connections: [conn("openai", "active", fresh), conn("cursor", "error", fresh)],
      movement: emptyMovement(),
      trends: [],
      scoreComponents: [weakActiveDays()],
      recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
    });
    const html = renderDigestEmail(content, {
      unsubscribeUrl: "https://app.example/u",
      manageUrl: "https://app.example/settings",
    });
    expect(html).toContain("Guidance");
    expect(html).toContain("Needs attention");
  });
});

describe("Growth-Journey milestones (W5-F)", () => {
  const fresh = new Date(NOW.getTime() - 1 * DAY);
  const base = {
    now: NOW,
    connections: [conn("openai", "active", fresh)],
    movement: emptyMovement(),
    scoreComponents: [] as { slug: "adoption"; components: ComponentDetailRow[] }[],
  };

  it("a strict new best becomes a new-best milestone (subsumes personal best)", () => {
    const content = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [40, 55])],
    });
    const newBest = content.milestones.find((m) => m.kind === "new-best");
    expect(newBest).toBeTruthy();
    expect(newBest!.body).toMatch(/reached 55/);
    // Still reflected in the personalBest field (back-compat).
    expect(content.personalBest?.isNewBest).toBe(true);
  });

  it("a flat trend celebrates NO new-best milestone (strict >, never >=)", () => {
    const content = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [55, 55])],
    });
    expect(content.milestones.some((m) => m.kind === "new-best")).toBe(false);
  });

  it("a sustained rhythm adds a COUNT-FREE weekly-cadence milestone (no-streak)", () => {
    // emptyMovement's active_days delta has previous 16 > 0 and current 20 > 0.
    const content = assembleDigest({ ...base, lane: "personal", trends: [] });
    const cadence = content.milestones.find((m) => m.kind === "weekly-cadence");
    expect(cadence).toBeTruthy();
    expect(/\d/.test(cadence!.body)).toBe(false); // no counter surfaced
  });

  it("renders a 'Your growth journey' section in the email", () => {
    const content = assembleDigest({
      ...base,
      lane: "personal",
      trends: [trend("adoption", [40, 55])],
    });
    const html = renderDigestEmail(content, {
      unsubscribeUrl: "https://app.example/u",
      manageUrl: "https://app.example/settings",
    });
    expect(html).toContain("Your growth journey");
    expect(html).toContain("New high for Adoption");
  });
});

describe("isoWeekString", () => {
  it("keys Monday 2026-07-06 as ISO week 28", () => {
    expect(isoWeekString(NOW)).toBe("2026-W28");
  });
  it("is stable across a whole ISO week (Mon–Sun)", () => {
    const mon = isoWeekString(new Date("2026-07-06T00:00:00Z"));
    const sun = isoWeekString(new Date("2026-07-12T23:59:59Z"));
    expect(mon).toBe(sun);
  });
  it("pads single-digit weeks", () => {
    expect(isoWeekString(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });
});
