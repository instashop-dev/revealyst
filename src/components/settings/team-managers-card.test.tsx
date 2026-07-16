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

import { TeamManagersCard } from "./team-managers-card";

afterEach(() => {
  vi.clearAllMocks();
});

// D-TCI-3 (ADR 0044): axe smoke + copy checks for the admin Team-managers card
// (the assign/remove control's remove buttons and add-manager <select> are
// aria-labelled; the card must stay violation-free in both the populated and
// empty-team states).

const MEMBERS = [
  { userId: "u-ada", label: "Ada Lovelace" },
  { userId: "u-grace", label: "Grace Hopper" },
];

describe("TeamManagersCard", () => {
  it("renders teams with managers and no axe violations", async () => {
    const { container } = render(
      <TeamManagersCard
        teams={[
          { id: "t1", name: "Platform", managerUserIds: ["u-ada"] },
          { id: "t2", name: "Product", managerUserIds: [] },
        ]}
        members={MEMBERS}
      />,
    );
    // A current manager has an accessible remove control on its team row.
    expect(
      screen.getByRole("button", {
        name: /Remove Ada Lovelace as a manager of Platform/i,
      }),
    ).toBeInTheDocument();
    // The add-manager picker is labelled per team.
    expect(
      screen.getByLabelText("Add a manager to Product"),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an empty state with no teams and no axe violations", async () => {
    const { container } = render(
      <TeamManagersCard teams={[]} members={MEMBERS} />,
    );
    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
