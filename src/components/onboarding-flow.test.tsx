// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { OnboardingFlow } from "./onboarding-flow";
import { stepsForOrgKind } from "@/lib/onboarding-stepper";

const TEAM_STEPS = stepsForOrgKind("team");

function flow(overrides: Partial<Parameters<typeof OnboardingFlow>[0]> = {}) {
  return (
    <OnboardingFlow
      orgKind="team"
      isAdmin
      visibilityMode="private"
      copilotAvailable={false}
      initialConnections={[]}
      initialStepIndex={0}
      privacyResolved={false}
      {...overrides}
    />
  );
}

describe("OnboardingFlow (U4.2)", () => {
  it("opens a team admin on the pitch step with a 4-step nav", () => {
    render(flow());
    expect(screen.getByRole("navigation", { name: /setup progress/i })).toBeTruthy();
    for (const s of TEAM_STEPS) expect(screen.getByText(s.label)).toBeTruthy();
    // Pitch step content is present, with a Next control.
    expect(screen.getByRole("button", { name: /Next: connect a source/i })).toBeTruthy();
  });

  it("resumes a connected-but-unresolved team org on the privacy step", () => {
    render(
      flow({
        initialConnections: [
          { id: "c1", vendor: "anthropic_console", status: "active" },
        ],
        initialStepIndex: 2, // privacy (server-derived)
      }),
    );
    // Admin sees the visibility control (a radiogroup) + the invite affordance.
    expect(screen.getByRole("radiogroup", { name: /visibility mode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /invite member/i })).toBeTruthy();
  });

  it("a team MEMBER sees a read-only privacy note, no admin controls", () => {
    render(
      flow({ isAdmin: false, initialStepIndex: 2 }),
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(/admin controls privacy settings/i)).toBeTruthy();
  });

  it("the review step CTA links to the dashboard", () => {
    render(flow({ initialStepIndex: 3 }));
    const cta = screen.getByRole("button", { name: /Go to Today/i });
    expect(cta.getAttribute("href")).toBe("/dashboard");
  });

  it("personal orgs relabel the connect CTA toward 'what you'll see'", () => {
    render(
      flow({
        orgKind: "personal",
        initialConnections: [
          { id: "c1", vendor: "anthropic_console", status: "active" },
        ],
        initialStepIndex: 1, // connect
      }),
    );
    expect(
      screen.getByRole("button", { name: /Next: what you'll see/i }),
    ).toBeTruthy();
  });

  it("lets a returning user navigate back through the nav", async () => {
    render(flow({ initialStepIndex: 3 }));
    // Review is shown; clicking a completed step in the nav goes back.
    const nav = screen.getByRole("navigation", { name: /setup progress/i });
    const connectBtn = within(nav).getByRole("button", { name: /connect a source/i });
    await userEvent.click(connectBtn);
    // The connect wizard heading appears.
    expect(screen.getByText(/Connect your AI tools/i)).toBeTruthy();
  });
});

describe("OnboardingFlow — axe per step", () => {
  for (const [name, idx] of [
    ["pitch", 0],
    ["connect", 1],
    ["privacy", 2],
    ["review", 3],
  ] as const) {
    it(`${name} step has no detectable a11y violations`, async () => {
      const { container } = render(flow({ initialStepIndex: idx }));
      expect(await axe(container)).toHaveNoViolations();
    });
  }
});
