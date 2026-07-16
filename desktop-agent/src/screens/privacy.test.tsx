import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Screens run inside the Tauri webview; jsdom has no Tauri bridge, so the
// invoke layer is mocked (the tests pin what the screen sends, not the IPC).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import PrivacyScreen from "./privacy";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(invoke).mockClear();
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
    // Law 3: no hand-written collection claims — only the honest placeholder.
    expect(screen.getByText(/Nothing yet\. This app does not collect anything right now\./)).toBeTruthy();
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

  it("start-at-login is off by default and toggling calls set_autostart", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it("rolls the toggle back if the command fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(false);
    });
  });
});
