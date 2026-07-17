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
    // No saved shared-computer answer yet (the privacy-safe default).
    if (command === "get_device_used_only_by_me") return Promise.resolve(null);
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

  it("asks one plain 'who uses this computer' question with neither option pre-selected", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "This computer" }));
    const onlyMe = screen.getByRole("radio", { name: /Only I use this computer/ });
    const shared = screen.getByRole("radio", { name: /Other people use it too/ });
    // Safe default: no attribution to a person until the user actively answers.
    await waitFor(() => {
      expect((onlyMe as HTMLInputElement).checked).toBe(false);
      expect((shared as HTMLInputElement).checked).toBe(false);
    });
  });

  it("saves the shared-computer answer via set_device_used_only_by_me", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(false);
      if (command === "get_device_used_only_by_me") return Promise.resolve(null);
      if (command === "set_device_used_only_by_me") return Promise.resolve();
      return new Promise(() => {});
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "This computer" }));
    fireEvent.click(screen.getByRole("radio", { name: /Other people use it too/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_device_used_only_by_me", { onlyMe: false }),
    );
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

  it("shows the detected source in plain words on the Sources step", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(true);
      if (command === "detect_sources")
        return Promise.resolve([{ name: "Claude Code" }]);
      return new Promise(() => {});
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(
      await screen.findByText("We found Claude Code on this computer."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("detect_sources", undefined),
    );
  });

  it("shows an honest empty state on the Sources step when nothing is found", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(false);
      if (command === "detect_sources") return Promise.resolve([]);
      return new Promise(() => {});
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(
      await screen.findByText(/No supported AI tools found on this computer yet/),
    ).toBeTruthy();
    // Invariant (b): no fabricated "found" claim when the list is empty.
    expect(screen.queryByText(/We found/)).toBeNull();
  });

  it("shows an honest finish placeholder — no 'connected' claim, buttons off before sign-in", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByText(/Complete the .Sign in. step to connect this computer\./),
    ).toBeTruthy();
    // Invariant (b): "connected" must NOT render until real enrollment backs it.
    expect(screen.queryByText(/This computer is connected/)).toBeNull();
    for (const name of ["Open Revealyst", "Done"]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("completes onboarding from the Finish step when signed in ('Done')", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(true);
      return Promise.resolve();
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    // Once the signed-in state settles, the buttons become real.
    await waitFor(() => {
      const done = screen.getByRole("button", { name: "Done" });
      expect((done as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("finish_onboarding", undefined),
    );
  });

  it("opens the web app and completes onboarding ('Open Revealyst')", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "is_signed_in") return Promise.resolve(true);
      return Promise.resolve();
    });
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => {
      const open = screen.getByRole("button", { name: "Open Revealyst" });
      expect((open as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Revealyst" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_revealyst", undefined);
      expect(invokeMock).toHaveBeenCalledWith("finish_onboarding", undefined);
    });
  });
});
