// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { TeamCostVisibilityCard } from "./team-cost-visibility-card";

afterEach(() => {
  vi.clearAllMocks();
});

// ADR 0045 spend half (D-TCI-2): axe smoke + copy checks for the admin
// cost-visibility card. Each per-team toggle is aria-labelled; the card must
// stay violation-free in populated + empty states.

describe("TeamCostVisibilityCard", () => {
  it("renders a per-team toggle with an accessible label and no axe violations", async () => {
    const { container } = render(
      <TeamCostVisibilityCard
        teams={[
          { id: "t1", name: "Platform", managersSeeIndividualCost: true },
          { id: "t2", name: "Product", managersSeeIndividualCost: false },
        ]}
      />,
    );
    expect(
      screen.getByLabelText(/Let managers of Platform see individual costs/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Let managers of Product see individual costs/i),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an empty state with no teams and no axe violations", async () => {
    const { container } = render(<TeamCostVisibilityCard teams={[]} />);
    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
