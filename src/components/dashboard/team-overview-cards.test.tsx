// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { TeamNarrativeHero } from "./team-narrative-hero";
import { CapabilityCoverageCard } from "./capability-coverage-card";
import { TrainingOpportunitiesCard } from "./training-opportunities-card";
import { SegmentBreakdown } from "./segment-breakdown";
import { TeamFreshnessLine } from "./team-freshness-line";
import { UsageDistributionPanel } from "./usage-distribution-panel";
import { UsageConcentrationPanel } from "./usage-concentration-panel";
import { DataTrustCard } from "./data-trust-card";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "@/lib/segments";
import type { PlateauResult } from "@/lib/plateau";
import type { SegmentDistribution } from "@/lib/segments";
import type { Narrative } from "@/lib/narrative";

// U4.1 — team overview polish. Axe smoke for the team page's key cards (only
// companion cards were covered before), plus the floor-explanation copy and the
// narrative-hero CTA.

const NARRATIVE: Narrative = {
  sentences: [
    "Over the last 4 weeks, 12 people were active on AI tools (up from 9).",
  ],
};

const NONE_PLATEAU: PlateauResult = { kind: "none" };

function segments(
  counts: Partial<Record<string, number>>,
): SegmentDistribution {
  return {
    segments: [
      { segment: "skeptic", label: "Skeptics", count: counts.skeptic ?? 0, members: [] },
      { segment: "casual", label: "Casual", count: counts.casual ?? 0, members: [] },
      { segment: "power_user", label: "Power Users", count: counts.power_user ?? 0, members: [] },
      { segment: "ai_native", label: "AI Natives", count: counts.ai_native ?? 0, members: [] },
    ],
    unsegmented: 0,
  };
}

const FLOOR_NOTE = TEAM_OVERVIEW_COPY.floorNote(SEGMENT_MIN_PEOPLE_TO_NAME);

describe("TeamNarrativeHero (U4.1)", () => {
  it("renders the narrative prose and one CTA anchored at the training section", () => {
    render(<TeamNarrativeHero narrative={NARRATIVE} correlations={[]} />);
    expect(
      screen.getByText(/12 people were active on AI tools/),
    ).toBeTruthy();
    // Base UI Button renders the anchor with role="button"; it's still an
    // <a> carrying the in-page href to the training section.
    const cta = screen.getByRole("button", {
      name: TEAM_OVERVIEW_COPY.hero.ctaLabel,
    });
    expect(cta.getAttribute("href")).toBe("#team-training");
  });
});

describe("Floor-explanation copy (U4.1)", () => {
  it("renders the shared note from the live floor constant (never hard-coded)", () => {
    // The single source: the copy fn fed the SEGMENT_MIN_PEOPLE_TO_NAME export.
    expect(FLOOR_NOTE).toContain(String(SEGMENT_MIN_PEOPLE_TO_NAME));
    // Count-free: it states the rule, never a suppressed count ("2 more
    // hidden"). "4 or more people" is the floor itself, not a hidden tally.
    expect(FLOOR_NOTE).toMatch(/protect individuals/i);
    expect(FLOOR_NOTE).not.toMatch(/hidden|\d+\s+more/i);
  });

  it("CapabilityCoverageCard shows the note even when some rows are present (silent drop → stated rule)", () => {
    render(
      <CapabilityCoverageCard
        rows={[
          { slug: "a", label: "Make AI part of daily work", mastered: 3, total: 5 },
        ]}
        floorNote={FLOOR_NOTE}
      />,
    );
    expect(screen.getByText("Make AI part of daily work")).toBeTruthy();
    expect(screen.getByText(FLOOR_NOTE)).toBeTruthy();
  });

  it("CapabilityCoverageCard shows the note in the below-floor (all dropped) empty state too", () => {
    render(<CapabilityCoverageCard rows={[]} floorNote={FLOOR_NOTE} />);
    expect(screen.getByText(/Not enough people/i)).toBeTruthy();
    expect(screen.getByText(FLOOR_NOTE)).toBeTruthy();
  });
});

describe("Distribution completeness — not-yet-active (P2c)", () => {
  it("SegmentBreakdown surfaces the count-only not-yet-active line", () => {
    render(
      <SegmentBreakdown
        distribution={segments({ power_user: 4 })}
        notYetActive={3}
      />,
    );
    // Positive-first framing, the live count, and the "will appear" promise.
    expect(screen.getByText(TEAM_OVERVIEW_COPY.notYetActive(3))).toBeTruthy();
    expect(screen.getByText(/not yet active/i)).toBeTruthy();
  });

  it("uses singular/plural correctly and omits the line at zero/undefined", () => {
    const one = TEAM_OVERVIEW_COPY.notYetActive(1);
    expect(one).toMatch(/1 person not yet active/);
    expect(one).not.toMatch(/1 people/);

    const { rerender } = render(
      <SegmentBreakdown distribution={segments({ power_user: 4 })} notYetActive={0} />,
    );
    expect(screen.queryByText(/not yet active/i)).toBeNull();
    // Undefined (a caller that never computes it) also renders nothing extra.
    rerender(<SegmentBreakdown distribution={segments({ power_user: 4 })} />);
    expect(screen.queryByText(/not yet active/i)).toBeNull();
  });

  it("not-yet-active copy uses no deficiency language (positive-first guard)", () => {
    const copy = [
      TEAM_OVERVIEW_COPY.notYetActive(1),
      TEAM_OVERVIEW_COPY.notYetActive(4),
    ]
      .join(" ")
      .toLowerCase();
    for (const banned of [
      "inactive",
      "laggard",
      "idle",
      "deficien",
      "underperform",
      "behind",
      "failing",
      "leaderboard",
    ]) {
      expect(copy.includes(banned), `banned word "${banned}"`).toBe(false);
    }
    // The sanctioned framing is present.
    expect(copy).toContain("not yet active");
  });
});

describe("Data-freshness indicator (P2c)", () => {
  it("renders a 'Data as of …' line from a real dataAsOf and nothing when null", () => {
    const { rerender, container } = render(
      <TeamFreshnessLine dataAsOf="2026-07-15T00:00:00.000Z" stale={false} />,
    );
    expect(screen.getByText(/Data as of/)).toBeTruthy();
    // Absolute date, not relative — matches the maturity banner's format.
    expect(screen.getByText(/2026/)).toBeTruthy();
    // No stale suffix when fresh.
    expect(screen.queryByText(/older than the current period/)).toBeNull();

    rerender(<TeamFreshnessLine dataAsOf={null} stale={false} />);
    expect(container.textContent).toBe("");
  });

  it("appends the terse stale note when the sync predates the period", () => {
    render(<TeamFreshnessLine dataAsOf="2026-01-01T00:00:00.000Z" stale />);
    expect(
      screen.getByText(new RegExp(TEAM_OVERVIEW_COPY.freshness.staleSuffix)),
    ).toBeTruthy();
  });
});

describe("Team overview cards — axe smoke (U4.1)", () => {
  it("TeamNarrativeHero has no detectable a11y violations", async () => {
    const { container } = render(
      <TeamNarrativeHero narrative={NARRATIVE} correlations={[]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("TrainingOpportunitiesCard has no detectable a11y violations", async () => {
    const { container } = render(
      <TrainingOpportunitiesCard
        segments={segments({ ai_native: 2, power_user: 2 })}
        plateau={NONE_PLATEAU}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("CapabilityCoverageCard (with floor note) has no detectable a11y violations", async () => {
    const { container } = render(
      <CapabilityCoverageCard
        rows={[{ slug: "a", label: "Make AI part of daily work", mastered: 3, total: 5 }]}
        floorNote={FLOOR_NOTE}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SegmentBreakdown has no detectable a11y violations", async () => {
    const { container } = render(
      <SegmentBreakdown distribution={segments({ power_user: 4, casual: 2 })} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SegmentBreakdown (with not-yet-active line) has no detectable a11y violations", async () => {
    const { container } = render(
      <SegmentBreakdown
        distribution={segments({ power_user: 4, casual: 2 })}
        notYetActive={3}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("TeamFreshnessLine has no detectable a11y violations", async () => {
    const { container } = render(
      <TeamFreshnessLine dataAsOf="2026-07-15T00:00:00.000Z" stale={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("UsageDistributionPanel has no detectable a11y violations", async () => {
    const { container } = render(
      <UsageDistributionPanel
        distribution={{
          available: true,
          resolvedPeople: 6,
          periodDays: 28,
          medianActiveDays: 4,
          p90ActiveDays: 12,
          maxActiveDays: 24,
          bands: [
            { key: "occasional", label: "Occasional", lowDays: 1, highDays: 6, count: 3 },
            { key: "near_daily", label: "Near-daily", lowDays: 21, highDays: 28, count: 3 },
          ],
        }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("UsageConcentrationPanel has no detectable a11y violations", async () => {
    const { container } = render(
      <UsageConcentrationPanel
        concentration={{
          available: true,
          resolvedPeople: 6,
          totalPrompts: 200,
          excludedPrompts: 0,
          top10SharePct: 40,
          top25SharePct: 60,
          top10Count: 1,
          top25Count: 2,
        }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("DataTrustCard has no detectable a11y violations", async () => {
    const { container } = render(
      <DataTrustCard
        coverage={{ single: 2, total: 5 }}
        gaps={[{ kind: "shared_key_not_person_level", detail: "Cursor team key" }]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
