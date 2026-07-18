// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { OnboardingWizard } from "./onboarding-wizard";
import { SCORE_TIMING_COPY } from "@/lib/onboarding-guide";

// End-state copy honesty (F1.6 review F1): the wizard's timing line must key
// on the connection's REAL sync state, never on this session's connect
// events — a paired-but-never-run agent is `pending` and gets the waiting
// copy, not "your data is in".

describe("OnboardingWizard end-state timing copy", () => {
  it("shows the waiting copy for a paired-but-never-synced agent (pending)", () => {
    render(
      <OnboardingWizard
        initialConnections={[
          { id: "c1", vendor: "claude_code_local", status: "pending" },
        ]}
      />,
    );

    expect(
      screen.getByText(SCORE_TIMING_COPY.awaiting_agent.headline),
    ).toBeInTheDocument();
    expect(screen.queryByText(/data is in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/by tomorrow/i)).not.toBeInTheDocument();
  });

  it("shows the overnight copy only once the agent has actually synced (active)", () => {
    render(
      <OnboardingWizard
        initialConnections={[
          { id: "c1", vendor: "claude_code_local", status: "active" },
        ]}
      />,
    );

    expect(
      screen.getByText(SCORE_TIMING_COPY.overnight.headline),
    ).toBeInTheDocument();
    expect(screen.getByText(/nightly run/i)).toBeInTheDocument();
  });

  it("shows no timing line when nothing is connected", () => {
    render(<OnboardingWizard initialConnections={[]} />);

    expect(
      screen.queryByText(SCORE_TIMING_COPY.overnight.headline),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(SCORE_TIMING_COPY.awaiting_agent.headline),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Set up the agent to continue"),
    ).toBeInTheDocument();
  });
});

// U4.2 — inside the setup stepper, the end CTA advances to the next step
// instead of linking to the dashboard.
describe("OnboardingWizard — stepper continueTo", () => {
  it("advances (no dashboard link) once connected, when continueTo is given", async () => {
    const onContinue = vi.fn();
    render(
      <OnboardingWizard
        initialConnections={[
          { id: "c1", vendor: "claude_code_local", status: "active" },
        ]}
        continueTo={{ label: "Next: privacy & people", onContinue }}
      />,
    );
    // The step CTA replaces "View my dashboard".
    expect(screen.queryByText("View my dashboard")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Next: privacy & people/i }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("renders the per-connector scope explainer lines (sourced claim surface)", () => {
    render(<OnboardingWizard initialConnections={[]} />);
    // The agent's schema-verified standing privacy line appears beside its card
    // (and the wizard header repeats the "prompts never leave your computer"
    // promise — ADR 0059: the honest guarantee is about leaving/uploading, not
    // "never read"), so at least one such line renders.
    expect(
      screen.getAllByText(/prompts never leave/i).length,
    ).toBeGreaterThan(0);
  });
});

// T2.6 item 7 — axe smoke (WCAG 2.1 AA structural basics). jsdom axe catches
// structural issues (labels, roles, landmarks, heading order) only — it
// cannot compute real rendered contrast, which needs a real browser (out of
// scope here; no Playwright infra in this repo).
describe("OnboardingWizard — axe smoke", () => {
  it("has no detectable a11y violations in the connect-a-source state", async () => {
    const { container } = render(<OnboardingWizard initialConnections={[]} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
