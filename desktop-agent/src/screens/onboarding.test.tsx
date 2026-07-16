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

  it("shows the finish step with the spec copy and disabled buttons", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByText(
        /This computer is connected\. Revealyst will run quietly in the background\. Prompt text is not uploaded in Analytics Only mode\./,
      ),
    ).toBeTruthy();
    for (const name of ["Open Revealyst", "Done"]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
