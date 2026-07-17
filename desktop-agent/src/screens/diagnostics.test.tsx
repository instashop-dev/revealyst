import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Send diagnostics button calls the send_diagnostics command. jsdom has no
// Tauri bridge, so invoke is mocked.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import DiagnosticsScreen from "./diagnostics";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(
    "Diagnostics sent. Thanks — this helps us fix problems.",
  );
});

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\Users\\me\\AppData\\Local\\com.revealyst.desktop\\logs",
  signedIn: false,
  paused: false,
  lastSyncAt: null,
  pendingCount: 0,
};

describe("DiagnosticsScreen", () => {
  it("shows version, platform, and log location", () => {
    render(<DiagnosticsScreen snapshot={snapshot} />);
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Windows")).toBeTruthy();
    expect(screen.getByText(snapshot.logDir)).toBeTruthy();
  });

  it("Send diagnostics is enabled and no longer shows a placeholder", () => {
    render(<DiagnosticsScreen snapshot={snapshot} />);
    const button = screen.getByRole("button", {
      name: "Send diagnostics",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText("Not available yet.")).toBeNull();
  });

  it("Send diagnostics triggers the send_diagnostics command and shows the result", async () => {
    render(<DiagnosticsScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Send diagnostics" }));
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("send_diagnostics");
    });
    expect(
      await screen.findByText(
        "Diagnostics sent. Thanks — this helps us fix problems.",
      ),
    ).toBeTruthy();
  });

  it("shows the plain-English error when the send fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      "Sign in first, then you can send diagnostics.",
    );
    render(<DiagnosticsScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Send diagnostics" }));
    expect(
      await screen.findByText("Sign in first, then you can send diagnostics."),
    ).toBeTruthy();
  });

  it("renders placeholders when no snapshot is available yet", () => {
    render(<DiagnosticsScreen snapshot={null} />);
    expect(screen.getAllByText("—").length).toBe(3);
  });
});
