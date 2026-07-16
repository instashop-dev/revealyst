// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { SetupStepper } from "./setup-stepper";
import { stepsForOrgKind } from "@/lib/onboarding-stepper";

const TEAM_STEPS = stepsForOrgKind("team");

describe("SetupStepper (U4.2)", () => {
  it("marks the active step with aria-current='step'", () => {
    render(<SetupStepper steps={TEAM_STEPS} currentIndex={1} />);
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain(TEAM_STEPS[1].label);
    // Exactly one current step.
    expect(document.querySelectorAll('[aria-current="step"]').length).toBe(1);
  });

  it("renders every step's number + label", () => {
    render(<SetupStepper steps={TEAM_STEPS} currentIndex={0} />);
    for (const step of TEAM_STEPS) {
      expect(screen.getByText(step.label)).toBeTruthy();
    }
  });

  it("lets a returning user click back to a COMPLETED step only", async () => {
    const onSelect = vi.fn();
    render(
      <SetupStepper steps={TEAM_STEPS} currentIndex={2} onSelect={onSelect} />,
    );
    // Completed steps (index 0, 1) are buttons; the current (2) and future (3)
    // are not navigable.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    await userEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("has no detectable a11y violations", async () => {
    const { container } = render(
      <SetupStepper steps={TEAM_STEPS} currentIndex={1} onSelect={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
