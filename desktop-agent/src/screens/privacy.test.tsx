import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Screens run inside the Tauri webview; jsdom has no Tauri bridge, so the
// invoke layer is mocked with a small stateful fake of the autostart store
// (the tests pin what the screen sends and shows, not the IPC).
const backend = vi.hoisted(() => ({ autostart: false }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import PrivacyScreen from "./privacy";

function fakeBackend(command: string, args?: unknown): Promise<unknown> {
  if (command === "get_autostart") return Promise.resolve(backend.autostart);
  if (command === "set_autostart") {
    backend.autostart = (args as { enabled: boolean }).enabled;
    return Promise.resolve(undefined);
  }
  return Promise.resolve(undefined);
}

afterEach(cleanup);
beforeEach(() => {
  backend.autostart = false;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(fakeBackend as unknown as typeof invoke);
});

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\logs",
};

describe("PrivacyScreen", () => {
  it("renders the spec §19.4 sections with an honest what-leaves placeholder", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    expect(screen.getByText("Current mode")).toBeTruthy();
    expect(screen.getByText("What leaves this computer")).toBeTruthy();
    expect(screen.getByText("What never leaves this computer")).toBeTruthy();
    expect(screen.getByText("Organization restrictions")).toBeTruthy();
    // F3 honesty: the mode is described as a default that takes effect when
    // collection arrives — not as an active mechanism.
    expect(
      screen.getByText(
        /Nothing is collected or uploaded yet\. When collection arrives, prompt text will not be uploaded in this mode\./,
      ),
    ).toBeTruthy();
    // Law 3: no hand-written collection claims — only the honest placeholder.
    expect(
      screen.getByText(/Nothing yet\. This app does not collect anything right now\./),
    ).toBeTruthy();
  });

  it("shows disabled pause/delete/disconnect controls with plain explanations", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    for (const name of ["Pause collection", "Delete pending local data", "Disconnect this device"]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText("Nothing is collected yet.")).toBeTruthy();
    expect(screen.getByText("There is no local data yet.")).toBeTruthy();
    expect(screen.getByText("This computer is not connected yet.")).toBeTruthy();
  });

  it("reads the persisted autostart state on mount — mount-read wins over a stale snapshot", async () => {
    backend.autostart = true;
    render(<PrivacyScreen snapshot={{ ...snapshot, autostart: false }} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith("get_autostart");
  });

  it("start-at-login is off by default and toggling persists via set_autostart", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    });
    // The checkbox reflects the re-read persisted state, not just hope.
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });
    expect(backend.autostart).toBe(true);
  });

  it("rolls the toggle back if the command fails", async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === "set_autostart") return Promise.reject(new Error("nope"));
      return fakeBackend(command);
    }) as unknown as typeof invoke);
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    });
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(false);
    });
  });
});
