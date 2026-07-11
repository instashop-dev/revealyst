// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MaturityReport } from "./maturity-report";
import {
  computeMaturity,
  type MaturityInput,
  type MetricRowLike,
} from "@/lib/maturity";

const WINDOW_TO = "2026-07-01";
const WEEKLY_DAYS = [
  "2026-04-08",
  "2026-04-15",
  "2026-04-22",
  "2026-04-29",
  "2026-05-06",
  "2026-05-13",
  "2026-05-20",
  "2026-05-27",
  "2026-06-03",
  "2026-06-10",
];

/** A broad + steady + deep scenario (lands at a high level) with spend and a
 * connection, so every number card has a real value to render. */
function scenarioView(orgPeople = 10) {
  const active = 9;
  const activeDayRows: MetricRowLike[] = [];
  const agentActiveRows: MetricRowLike[] = [];
  const spendRows: MetricRowLike[] = [];
  const identityLinks = [];
  for (let i = 0; i < active; i++) {
    identityLinks.push({ subjectId: `s${i}`, personId: `p${i}` });
    for (const day of WEEKLY_DAYS) {
      activeDayRows.push({ subjectId: `s${i}`, day, value: 1, connectionId: "c1" });
      agentActiveRows.push({ subjectId: `s${i}`, day, value: 1 });
    }
  }
  spendRows.push({ subjectId: "s0", day: "2026-06-10", value: 9000, connectionId: "c1" });
  const input: MaturityInput = {
    windowTo: WINDOW_TO,
    knownPeople: orgPeople,
    identityLinks,
    activeDayRows,
    agentActiveRows,
    featureRows: [],
    signalRows: [],
    promptRows: [],
    spendRows,
    connections: [
      {
        id: "c1",
        vendor: "anthropic",
        status: "active",
        displayName: "Claude",
        lastSuccessAt: new Date("2026-06-30T12:00:00Z"),
      },
    ],
    adoptionScore: 62,
  };
  return computeMaturity(input);
}

describe("MaturityReport", () => {
  it("renders the level banner, three axes, board numbers, and the not-scored section (team)", () => {
    render(<MaturityReport view={scenarioView()} orgKind="team" />);

    // Level banner (modeled label + a real level name — appears in the
    // headline and again in the L0→L4 scale, so getAllByText).
    expect(screen.getAllByText("Modeled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Amplified").length).toBeGreaterThan(0);

    // Three axes.
    expect(screen.getByText("Breadth")).toBeTruthy();
    expect(screen.getByText("Depth")).toBeTruthy();
    expect(screen.getByText("Consistency")).toBeTruthy();

    // A couple of the board numbers, team-only ones included.
    expect(screen.getByText("Activation")).toBeTruthy();
    expect(screen.getByText("Concentration")).toBeTruthy();
    expect(screen.getByText("Agentic share")).toBeTruthy();

    // The honesty differentiator section is first-class content.
    expect(
      screen.getByText(/What we deliberately don't measure/),
    ).toBeTruthy();
    expect(screen.getByText("Shadow AI")).toBeTruthy();
    // Dark-seat waste is explicitly not measured, never estimated.
    expect(screen.getAllByText("Not measured").length).toBeGreaterThan(0);
  });

  it("personal orgs get the reduced self-version — no activation or concentration cards", () => {
    render(<MaturityReport view={scenarioView(1)} orgKind="personal" />);
    // Cross-people measures are dropped for an org of one.
    expect(screen.queryByText("Activation")).toBeNull();
    expect(screen.queryByText("Concentration")).toBeNull();
    // But the level, axes, and personal-relevant numbers still render.
    expect(screen.getByText("Depth")).toBeTruthy();
    expect(screen.getByText("Agentic share")).toBeTruthy();
  });
});
