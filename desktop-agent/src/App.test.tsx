import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no Tauri bridge — mock the two @tauri-apps/api modules the shell
// touches (spec §22.2: the frontend surface is exactly these).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_agent_snapshot") {
      return Promise.resolve({
        state: "onboarding",
        version: "0.1.0",
        platform: "windows",
        autostart: false,
        logDir: "C:\\logs",
        signedIn: false,
        paused: false,
        lastSyncAt: null,
        pendingCount: 0,
      });
    }
    if (command === "get_autostart") {
      return Promise.resolve(false);
    }
    return Promise.resolve();
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import App from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the sidebar navigation and starts on the set-up screen", () => {
    render(<App />);
    for (const label of ["Set up", "Status", "Privacy", "About"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("Set up Revealyst on this computer")).toBeTruthy();
  });

  it("navigates to the status screen and shows the snapshot-derived status", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    await waitFor(() => {
      expect(screen.getByText("Setup needed")).toBeTruthy();
    });
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
  });

  it("navigates to privacy and about screens", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));
    expect(screen.getByText("What leaves this computer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("Log location")).toBeTruthy();
  });

  it("opens on the status screen when the device is already set up", async () => {
    // A device that finished setup reports a non-"onboarding" state; the app
    // should open on Status rather than the setup stepper. Runs last so the
    // remocked invoke (no per-test reset in this file) can't affect the others.
    const core = await import("@tauri-apps/api/core");
    vi.mocked(core.invoke).mockImplementation((command: string) => {
      if (command === "get_agent_snapshot") {
        return Promise.resolve({
          state: "healthy",
          version: "0.1.0",
          platform: "windows",
          autostart: false,
          logDir: "C:\\logs",
          signedIn: true,
          paused: false,
          lastSyncAt: 1_767_000_000_000,
          pendingCount: 0,
        });
      }
      if (command === "get_autostart") return Promise.resolve(false);
      return Promise.resolve();
    });
    render(<App />);
    // Once the first snapshot resolves, the opening screen switches to Status.
    await waitFor(() => {
      expect(screen.getByText("Syncing normally")).toBeTruthy();
    });
  });
});
