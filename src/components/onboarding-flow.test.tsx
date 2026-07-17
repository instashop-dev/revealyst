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
// The agent device-token mint succeeds without a backend — the flow only needs
// the connection id + token so SyncAgentCard flips to "Paired" and fires
// onConnected, marking the source connected for the session (Fix 1). One mock
// covers both calls (create reads payload.connection.id; token reads
// payload.token).
vi.mock("@/lib/client-fetch", () => ({
  postJson: vi.fn(async () => ({
    ok: true,
    status: 200,
    payload: { connection: { id: "new-conn-1" }, token: "rva1.test-token" },
  })),
  errorText: (_payload: unknown, fallback: string) => fallback,
}));

import { OnboardingFlow } from "./onboarding-flow";
import { stepsForOrgKind } from "@/lib/onboarding-stepper";

const TEAM_STEPS = stepsForOrgKind("team");

function flow(overrides: Partial<Parameters<typeof OnboardingFlow>[0]> = {}) {
  return (
    <OnboardingFlow
      orgKind="team"
      isAdmin
      visibilityMode="private"
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
    expect(screen.getByText(/Bring in your Claude Code usage/i)).toBeTruthy();
  });
});

// Fix 1 — same-session connect state must survive the wizard's remount and
// feed the review step, since `initialConnections` is only the SSR snapshot.
describe("OnboardingFlow — same-session connect (Fix 1)", () => {
  async function connectAgent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("button", { name: /Generate device token/i }),
    );
    // The card flips to a Paired badge once the mocked mint resolves.
    await screen.findByText("Paired");
  }

  it("reaching review after a same-session connect shows no 'haven't connected' copy", async () => {
    const user = userEvent.setup();
    render(
      flow({ orgKind: "personal", initialConnections: [], initialStepIndex: 1 }),
    );
    await connectAgent(user);
    // Advance to the review step.
    await user.click(
      screen.getByRole("button", { name: /Next: what you'll see/i }),
    );
    // We're on review (its CTA is present) and it does NOT falsely claim the
    // user hasn't connected anything.
    expect(screen.getByRole("button", { name: /Go to Today/i })).toBeTruthy();
    expect(screen.queryByText(/haven't connected a source/i)).toBeNull();
  });

  it("stepping back to connect after a same-session connect still shows it connected", async () => {
    const user = userEvent.setup();
    render(
      flow({ orgKind: "personal", initialConnections: [], initialStepIndex: 1 }),
    );
    await connectAgent(user);
    // Forward to review, then back to connect via the stepper nav — this
    // REMOUNTS the wizard from the (empty) SSR snapshot.
    await user.click(
      screen.getByRole("button", { name: /Next: what you'll see/i }),
    );
    const nav = screen.getByRole("navigation", { name: /setup progress/i });
    await user.click(
      within(nav).getByRole("button", { name: /connect a source/i }),
    );
    // The session connect survived the remount: the agent still reads Paired,
    // and the end CTA is the advance button — never the disabled
    // "set up the agent to continue".
    expect(await screen.findByText("Paired")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Set up the agent to continue/i }),
    ).toBeNull();
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
