// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgenticAdoptionCard } from "./agentic-adoption-card";
import type { AgenticAdoption } from "@/lib/agentic-adoption";
import { AGENTIC_ADOPTION_COPY } from "@/lib/metrics-glossary";

const measured: Extract<AgenticAdoption, { kind: "measured" }> = {
  kind: "measured",
  ratePct: 75,
  agenticDays: 3,
  activeDays: 4,
  trend: [
    { weekStart: "2026-06-01", label: "Jun 1–7", ratePct: 50, agenticDays: 1, activeDays: 2 },
    { weekStart: "2026-06-08", label: "Jun 8–14", ratePct: 100, agenticDays: 2, activeDays: 2 },
  ],
  delta: {
    kind: "delta",
    current: 100,
    previous: 50,
    delta: 50,
    previousPeriodLabel: "Jun 1–7",
  },
  coveragePerVendor: [{ sourceConnector: "anthropic-console@1", agenticDays: 3 }],
};

describe("AgenticAdoptionCard", () => {
  it("renders the measured rate, delta, and coverage note", () => {
    render(<AgenticAdoptionCard data={measured} />);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText(/3 of 4 active days used an agent/)).toBeTruthy();
    expect(screen.getByText(/\+50 pts vs Jun 1–7/)).toBeTruthy();
    // Aggregate-only coverage note — reflects agent-capable tools, no per-person ranking.
    expect(screen.getByText(/reported by 1 connected tool\b/)).toBeTruthy();
  });

  it("renders the honest no-agentic-telemetry state, never a measured 0%", () => {
    render(<AgenticAdoptionCard data={{ kind: "noAgenticData", activeDays: 5 }} />);
    expect(screen.getByText(AGENTIC_ADOPTION_COPY.emptyNoAgentic.title)).toBeTruthy();
    // The card must not fabricate a 0% number for a missing-telemetry org.
    expect(screen.queryByText("0%")).toBeNull();
    // And it explains it is not a measured zero.
    expect(screen.getByText(/not a measured zero/)).toBeTruthy();
  });

  it("renders the no-activity state when nothing has synced", () => {
    render(<AgenticAdoptionCard data={{ kind: "noActivity" }} />);
    expect(screen.getByText(AGENTIC_ADOPTION_COPY.emptyNoActivity.title)).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });
});
