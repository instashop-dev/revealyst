// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainingOpportunitiesCard } from "./training-opportunities-card";
import type { PlateauResult } from "@/lib/plateau";
import type { SegmentDistribution } from "@/lib/segments";

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

describe("TrainingOpportunitiesCard", () => {
  it("names a leading cohort ONLY above the de-anonymization floor", () => {
    render(
      <TrainingOpportunitiesCard
        segments={segments({ ai_native: 2, power_user: 2, casual: 1 })}
        plateau={NONE_PLATEAU}
      />,
    );
    expect(screen.getByText(/leading cohort is 2 ai natives/i)).toBeTruthy();
  });

  it("suppresses the champion name in a small org (floor not met)", () => {
    render(
      <TrainingOpportunitiesCard
        segments={segments({ ai_native: 1, casual: 1 })}
        plateau={NONE_PLATEAU}
      />,
    );
    expect(screen.queryByText(/leading cohort is/i)).toBeNull();
    expect(screen.getByText(/Too few people are scored yet/i)).toBeTruthy();
  });

  it("surfaces a plateau verdict as a prompt, not a judgment", () => {
    const plateau: PlateauResult = {
      kind: "plateau",
      peak: { weekStart: "2026-05-04", label: "May 4", activePeople: 10 },
      latest: { weekStart: "2026-06-15", label: "Jun 15", activePeople: 7 },
      decliningWeeks: 6,
      declinePct: 30,
    };
    render(
      <TrainingOpportunitiesCard
        segments={segments({ power_user: 4 })}
        plateau={plateau}
      />,
    );
    expect(screen.getByText(/down 30% from its peak/i)).toBeTruthy();
    expect(screen.getByText(/not a verdict that anything is wrong/i)).toBeTruthy();
  });
});
