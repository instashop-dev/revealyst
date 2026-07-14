// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapabilityCoverageCard } from "./capability-coverage-card";

// W7-6: the team coverage card is aggregate + count-only. These pin that it
// renders counts (never a person), and shows the honest empty state below the
// floor. The row prop type structurally excludes any person id/name (a
// compile-time guarantee — there is no field to pass one).

describe("CapabilityCoverageCard", () => {
  it("renders count-only coverage per capability", () => {
    render(
      <CapabilityCoverageCard
        rows={[
          { slug: "ai-coding-foundations", label: "Make AI part of daily work", mastered: 3, total: 5 },
          { slug: "agentic-delivery", label: "Let AI agents do more of the work", mastered: 1, total: 4 },
        ]}
      />,
    );
    expect(screen.getByText("Make AI part of daily work")).toBeTruthy();
    expect(screen.getByText("3 of 5 people")).toBeTruthy();
    expect(screen.getByText("1 of 4 people")).toBeTruthy();
  });

  it("shows the honest empty state when no capability clears the floor", () => {
    render(<CapabilityCoverageCard rows={[]} />);
    expect(screen.getByText(/Not enough people/i)).toBeTruthy();
  });
});
