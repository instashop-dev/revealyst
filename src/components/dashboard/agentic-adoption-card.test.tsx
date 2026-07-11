// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgenticAdoptionCard } from "./agentic-adoption-card";
import type { AgenticAdoption } from "@/lib/agentic-adoption";
import { AGENTIC_ADOPTION_COPY } from "@/lib/metrics-glossary";

function measured(
  overrides: Partial<Extract<AgenticAdoption, { kind: "measured" }>> = {},
): Extract<AgenticAdoption, { kind: "measured" }> {
  return {
    kind: "measured",
    ratePct: 75,
    agenticDays: 3,
    activeDays: 4,
    trend: [
      { weekStart: "2026-06-01", label: "Jun 1–7", ratePct: 50, agenticDays: 1, activeDays: 2 },
      { weekStart: "2026-06-08", label: "Jun 8–14", ratePct: 100, agenticDays: 2, activeDays: 2 },
    ],
    weekToDate: null,
    delta: {
      kind: "delta",
      current: 100,
      previous: 50,
      delta: 50,
      previousPeriodLabel: "Jun 1–7",
    },
    coveragePerVendor: [{ sourceConnector: "anthropic-console@1", agenticDays: 3 }],
    unresolvedSubjects: 0,
    ...overrides,
  };
}

describe("AgenticAdoptionCard", () => {
  it("renders the measured rate, delta, and honest coverage note", () => {
    render(<AgenticAdoptionCard data={measured()} />);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(
      screen.getByText(/3 of 4 AI-active person-days used an agent/),
    ).toBeTruthy();
    expect(screen.getByText(/\+50 pts vs Jun 1–7/)).toBeTruthy();
    // The tools note admits the denominator limit — it never claims the rate
    // covers agent-capable tools only (review F2).
    expect(
      screen.getByText(/count as non-agentic here/),
    ).toBeTruthy();
    expect(screen.queryByText(/agent-capable tools only/i)).toBeNull();
  });

  it("speaks a rate-appropriate screen-reader sentence, not the score one (review F6)", () => {
    render(<AgenticAdoptionCard data={measured()} />);
    expect(
      screen.getByText(
        /Agentic adoption increased by 50 percentage points versus the previous week/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^Score /)).toBeNull();
  });

  it("shows the incomplete week as a labeled week-to-date line (review F3)", () => {
    render(
      <AgenticAdoptionCard
        data={measured({
          weekToDate: {
            weekStart: "2026-06-15",
            label: "Jun 15–16",
            ratePct: 0,
            agenticDays: 0,
            activeDays: 1,
          },
        })}
      />,
    );
    expect(screen.getByText(/Week to date \(Jun 15–16\)/)).toBeTruthy();
    expect(screen.getByText(/Not compared against full weeks/)).toBeTruthy();
  });

  it("discloses unresolved-subject exclusions on the measured card (review F1/F2)", () => {
    render(<AgenticAdoptionCard data={measured({ unresolvedSubjects: 2 })} />);
    expect(
      screen.getByText(/2 accounts with usage in this window aren't linked to a person yet/),
    ).toBeTruthy();
  });

  it("renders the honest no-agentic-telemetry state, never a measured 0%", () => {
    render(
      <AgenticAdoptionCard
        data={{ kind: "noAgenticData", activeDays: 5, unresolvedSubjects: 0 }}
      />,
    );
    expect(screen.getByText(AGENTIC_ADOPTION_COPY.emptyNoAgentic.title)).toBeTruthy();
    // The card must not fabricate a 0% number for a missing-telemetry org.
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText(/not a measured zero/)).toBeTruthy();
  });

  it("renders the no-activity state when nothing has synced", () => {
    render(
      <AgenticAdoptionCard data={{ kind: "noActivity", unresolvedSubjects: 0 }} />,
    );
    expect(screen.getByText(AGENTIC_ADOPTION_COPY.emptyNoActivity.title)).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders the unlinked-activity state when usage exists but none is identity-resolved", () => {
    render(
      <AgenticAdoptionCard data={{ kind: "noActivity", unresolvedSubjects: 4 }} />,
    );
    expect(
      screen.getByText(AGENTIC_ADOPTION_COPY.emptyUnresolvedOnly.title),
    ).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });
});
