// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PeriodNarrativeCard } from "./period-narrative-card";
import type { CorrelationResult } from "@/lib/correlation";
import type { Narrative } from "@/lib/narrative";

const NARRATIVE: Narrative = {
  sentences: [
    "Over the last 4 weeks, 12 people were active on AI tools (up from 9).",
    "Agentic tools were used on 34% of active days.",
  ],
};

const MEASURED: CorrelationResult = {
  kind: "measured",
  pair: "active_people__spend",
  agreementPct: 78,
  comparableWeeks: 9,
  agreeingWeeks: 7,
  weeks: 10,
};

const INSUFFICIENT: CorrelationResult = {
  kind: "insufficient",
  pair: "agentic_share__prompts",
  weeks: 3,
};

describe("PeriodNarrativeCard", () => {
  it("renders the composed prose and the directional moved-together panel", () => {
    render(
      <PeriodNarrativeCard
        narrative={NARRATIVE}
        correlations={[MEASURED, INSUFFICIENT]}
      />,
    );
    expect(
      screen.getByText(/12 people were active on AI tools/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Active people and spend moved the same way in 7 of 9 recent weeks/),
    ).toBeTruthy();
    // The standing non-causal disclaimer is always shown under the panel.
    expect(
      screen.getByText(/not that one moved the other/),
    ).toBeTruthy();
  });

  it("omits insufficient pairs entirely (no fabricated %)", () => {
    render(
      <PeriodNarrativeCard
        narrative={NARRATIVE}
        correlations={[INSUFFICIENT]}
      />,
    );
    // No moved-together lines at all when nothing is measured.
    expect(screen.queryByText(/moved the same way/)).toBeNull();
    expect(screen.queryByText(/Moved together/)).toBeNull();
  });

  it("shows an honest empty state when nothing is measurable", () => {
    render(
      <PeriodNarrativeCard
        narrative={{ sentences: [] }}
        correlations={[INSUFFICIENT]}
      />,
    );
    expect(
      screen.getByText(/appears here once there's enough measured activity/),
    ).toBeTruthy();
    // Never a teaser number in the empty state.
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
