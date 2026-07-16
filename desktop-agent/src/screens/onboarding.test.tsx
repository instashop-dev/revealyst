import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import OnboardingScreen from "./onboarding";

afterEach(cleanup);

describe("OnboardingScreen", () => {
  it("shows the spec §19.2 welcome copy", () => {
    render(<OnboardingScreen />);
    expect(
      screen.getByText(
        /Connect this computer to Revealyst\. Revealyst securely syncs supported AI-usage analytics from this computer\. Prompt text is not uploaded in the default mode\./,
      ),
    ).toBeTruthy();
  });

  it("continues to the sign-in step where Open browser is disabled (M2 not built)", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("Your browser will open so you can securely connect this computer."),
    ).toBeTruthy();
    const openBrowser = screen.getByRole("button", { name: "Open browser" });
    expect((openBrowser as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Available soon")).toBeTruthy();
  });

  it("shows the privacy-mode step with Analytics Only selected and the others not selectable", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Privacy mode" }));
    const analytics = screen.getByRole("radio", { name: /Analytics Only/ });
    expect((analytics as HTMLInputElement).checked).toBe(true);
    const redacted = screen.getByRole("radio", { name: /Redacted Summary/ });
    expect((redacted as HTMLInputElement).disabled).toBe(true);
    const full = screen.getByRole("radio", { name: /Full Content/ });
    expect((full as HTMLInputElement).disabled).toBe(true);
  });

  it("shows an honest source-detection placeholder — no unbacked 'sources found' claim", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(
      screen.getByText(
        /After you sign in, Revealyst checks this computer for supported sources\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Source detection is not available yet.")).toBeTruthy();
    // Invariant (b): the spec's target copy must NOT render until real
    // detection backs it (M5).
    expect(screen.queryByText(/Supported sources found/)).toBeNull();
    expect(screen.queryByText(/Ready to connect/)).toBeNull();
  });

  it("shows an honest finish placeholder with disabled buttons — no 'connected' claim", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByText(
        /Sign-in isn't available yet\. When it is, this step will confirm your connection\./,
      ),
    ).toBeTruthy();
    // Invariant (b): "this computer is connected" must NOT render until real
    // enrollment backs it (M2).
    expect(screen.queryByText(/This computer is connected/)).toBeNull();
    for (const name of ["Open Revealyst", "Done"]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
