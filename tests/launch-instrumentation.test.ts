import { describe, expect, it } from "vitest";
import {
  digestReturnDim,
  isCompanionRevisit,
  isTeamOverviewView,
} from "../src/lib/launch-events";
import { appendDigestUtm, renderDigestEmail } from "../src/lib/digest-email";
import { renderBudgetAlertEmail } from "../src/lib/budget-alert-email";
import { renderFlywheelReportEmail } from "../src/lib/flywheel-email";
import { deriveLaunchFunnel } from "../src/lib/launch-funnel";
import type { DigestContent } from "../src/lib/digest-content";

// W5-I instrumentation + email-render unit tests: the edge-seam event
// predicates (content-free, no PII), the digest return-rate UTM, and the two
// new email renderers.

describe("digestReturnDim (server-side digest click-through)", () => {
  it("returns the ISO week when a document GET carries ?src=digest&wk", () => {
    expect(digestReturnDim("GET", false, "digest", "2026-W28")).toBe("2026-W28");
  });

  it("returns '' when src=digest but wk is absent (still a return, coarse only)", () => {
    expect(digestReturnDim("GET", false, "digest", null)).toBe("");
  });

  it("is null for a non-digest request, an RSC soft-nav, or a non-GET/HEAD", () => {
    expect(digestReturnDim("GET", false, null, "2026-W28")).toBeNull();
    expect(digestReturnDim("GET", true, "digest", "2026-W28")).toBeNull(); // RSC
    expect(digestReturnDim("POST", false, "digest", "2026-W28")).toBeNull();
  });

  it("counts HEAD (parity with landing_view crawler-inclusive series)", () => {
    expect(digestReturnDim("HEAD", false, "digest", "2026-W28")).toBe("2026-W28");
  });

  it("carries no PII — the dim is only the coarse week bucket", () => {
    // Whatever the caller passes as wk is a week string; there is no code path
    // that puts a user/org id into the dim.
    const dim = digestReturnDim("GET", false, "digest", "2026-W28");
    expect(dim).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe("isCompanionRevisit", () => {
  it("is true only for a document GET/HEAD of /dashboard, RSC excluded", () => {
    expect(isCompanionRevisit("GET", "/dashboard", false)).toBe(true);
    expect(isCompanionRevisit("HEAD", "/dashboard", false)).toBe(true);
    expect(isCompanionRevisit("GET", "/dashboard", true)).toBe(false); // RSC soft-nav
    expect(isCompanionRevisit("GET", "/spend", false)).toBe(false);
    expect(isCompanionRevisit("POST", "/dashboard", false)).toBe(false);
  });
});

describe("isTeamOverviewView (TCI §15 team-dashboard view, render-path)", () => {
  it("is true for a full-document render, false for an RSC soft-nav", () => {
    // The caller (the TeamOverview server component) already implies GET
    // /dashboard in a team org; the only thing left to filter is the RSC
    // soft-navigation, matching companion_revisit's RSC exclusion at the seam.
    expect(isTeamOverviewView(false)).toBe(true);
    expect(isTeamOverviewView(true)).toBe(false); // RSC soft-nav, not a fresh view
  });
});

describe("appendDigestUtm", () => {
  it("adds src+wk with ? on a bare path and & when a query exists", () => {
    expect(appendDigestUtm("https://app.example/settings", "2026-W28")).toBe(
      "https://app.example/settings?src=digest&wk=2026-W28",
    );
    expect(appendDigestUtm("https://app.example/settings?x=1", "2026-W28")).toBe(
      "https://app.example/settings?x=1&src=digest&wk=2026-W28",
    );
  });

  it("omits wk when no week is supplied (direct caller)", () => {
    expect(appendDigestUtm("https://app.example/settings")).toBe(
      "https://app.example/settings?src=digest",
    );
  });
});

function minimalDigest(): DigestContent {
  return {
    lane: "personal",
    suppressed: false,
    subject: "Your Revealyst weekly digest",
    preheader: "preheader",
    intro: "intro",
    dataAsOfDate: "2026-07-05",
    staleAnnotations: [],
    movement: {
      periodDays: 28,
      currentFrom: "2026-06-08",
      currentTo: "2026-07-05",
      previousFrom: "2026-05-11",
      previousTo: "2026-06-07",
      metrics: [],
    },
    scores: [],
    personalBest: null,
    recommendations: [],
    milestones: [],
    teamBrief: null,
  };
}

describe("renderDigestEmail — return-rate UTM on the manage CTA", () => {
  it("tags the app-return CTA href with the sent week", () => {
    const html = renderDigestEmail(minimalDigest(), {
      unsubscribeUrl: "https://app.example/api/digest/unsubscribe?token=abc",
      manageUrl: "https://app.example/settings",
      isoWeek: "2026-W28",
    });
    expect(html).toContain(
      "https://app.example/settings?src=digest&amp;wk=2026-W28",
    );
    // The unsubscribe token link is untouched by the UTM tagging.
    expect(html).toContain(
      "https://app.example/api/digest/unsubscribe?token=abc",
    );
    expect(html).not.toContain("unsubscribe?token=abc&amp;src=digest");
  });
});

describe("renderBudgetAlertEmail", () => {
  it("renders the crossed threshold, reported spend, and a spend CTA (approaching)", () => {
    const html = renderBudgetAlertEmail(
      {
        reportedCents: 85_000,
        monthlyLimitCents: 100_000,
        threshold: 80,
        pctUsed: 85,
        overBudget: false,
      },
      { spendUrl: "https://app.example/spend?src=budget-alert&mo=2026-07" },
    );
    expect(html).toContain("80% of your monthly AI budget");
    expect(html).toContain("$850.00"); // reported
    expect(html).toContain("$1,000.00"); // limit
    expect(html).toContain("85%"); // pctUsed
    expect(html).toContain("https://app.example/spend?src=budget-alert&amp;mo=2026-07");
    // Honesty: never claims a bill or estimated spend.
    expect(html).toContain("vendor-reported spend only");
  });

  it("switches to over-budget framing at/over 100%", () => {
    const html = renderBudgetAlertEmail(
      {
        reportedCents: 120_000,
        monthlyLimitCents: 100_000,
        threshold: 100,
        pctUsed: 120,
        overBudget: true,
      },
      { spendUrl: "https://app.example/spend" },
    );
    expect(html).toContain("reached your monthly AI budget");
  });
});

describe("renderFlywheelReportEmail — instrumented, not aspirational", () => {
  it("renders measured funnel figures and honest empty rates", () => {
    const funnel = deriveLaunchFunnel([
      {
        orgId: "o1",
        kind: "personal",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        firstConnectionAt: new Date("2026-07-01T00:03:00Z"),
        firstBackfillSuccessAt: new Date("2026-07-01T00:05:00Z"),
        hasScore: true,
        shareLinks: 1,
        members: 1,
        invitesSent: 0,
        invitesAccepted: 0,
      },
    ]);
    const html = renderFlywheelReportEmail(funnel, "2026-07-13");
    expect(html).toContain("Weekly flywheel funnel");
    expect(html).toContain("As of 2026-07-13");
    // 1 org, activated, share link present → 100% share-card rate.
    expect(html).toContain("100%");
    // No org ids leak into the aggregate report.
    expect(html).not.toContain("o1");
  });

  it("renders '— (no data yet)' for an empty funnel, never a fabricated 0", () => {
    const html = renderFlywheelReportEmail(deriveLaunchFunnel([]), "2026-07-13");
    expect(html).toContain("— (no data yet)");
  });
});
