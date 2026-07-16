import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no Tauri bridge — mock the core invoke the sign-in step touches.
// Each test sets the behaviour it needs via `invokeMock`.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

import OnboardingScreen from "./onboarding";

beforeEach(() => {
  invokeMock.mockReset();
  // Default: not signed in, and begin_sign_in never resolves during the test
  // unless a test overrides it.
  invokeMock.mockImplementation((command: string) => {
    if (command === "is_signed_in") return Promise.resolve(false);
    return new Promise(() => {});
  });
});

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

  it("enables the Sign in button and calls begin_sign_in (M2)", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const openBrowser = await screen.findByRole("button", { name: "Open browser" });
    expect((openBrowser as HTMLButtonElement).disabled).toBe(false);
    // No stale "Available soon" placeholder on the enabled step.
    expect(screen.queryByText("Available soon")).toBeNull();

    fireEvent.click(openBrowser);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("begin_sign_in", undefined),
    );
    // While the browser round-trip is pending the button reflects the wait.
    expect(screen.getByRole("button", { name: "Waiting for your browser…" })).toBeTruthy();
  });

  it("reflects an already-signed-in computer without a sign-in button", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(true);
      return new Promise(() => {});
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("This computer is signed in to Revealyst."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open browser" })).toBeNull();
  });

  it("shows a plain-English error when sign-in fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(false);
      if (command === "begin_sign_in")
        return Promise.reject("Couldn't reach Revealyst. Check your connection and try again.");
      return new Promise(() => {});
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open browser" }));
    expect(
      await screen.findByText(
        "Couldn't reach Revealyst. Check your connection and try again.",
      ),
    ).toBeTruthy();
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

  it("shows an honest finish placeholder — no 'connected'/'syncing' claim before sign-in", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByText(/Complete the .Sign in. step to connect this computer\./),
    ).toBeTruthy();
    // Invariant (b): "connected" / "syncing" must NOT render until real
    // enrollment + collection back them.
    expect(screen.queryByText(/This computer is connected/)).toBeNull();
    for (const name of ["Open Revealyst", "Done"]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
