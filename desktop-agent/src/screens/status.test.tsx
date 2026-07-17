import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The status screen makes a few narrow live reads (signed-in, paused, pending
// count). jsdom has no Tauri bridge, so invoke is mocked.
const backend = vi.hoisted(() => ({
  signedIn: false,
  paused: false,
  pending: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import { UNSUPPORTED_SOURCES } from "../lib/collection-disclosure";
import StatusScreen from "./status";

function fakeBackend(command: string): Promise<unknown> {
  switch (command) {
    case "is_signed_in":
      return Promise.resolve(backend.signedIn);
    case "get_collection_paused":
      return Promise.resolve(backend.paused);
    case "get_pending_count":
      return Promise.resolve(backend.pending);
    default:
      return Promise.resolve(undefined);
  }
}

afterEach(cleanup);
beforeEach(() => {
  backend.signedIn = false;
  backend.paused = false;
  backend.pending = 0;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(fakeBackend as unknown as typeof invoke);
});

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\Users\\me\\AppData\\Local\\com.revealyst.desktop\\logs",
};

describe("StatusScreen", () => {
  it("shows honest not-signed-in placeholders — never fake data", async () => {
    render(<StatusScreen snapshot={snapshot} />);
    // Overall status comes from the snapshot's honest state label.
    expect(screen.getByText("Setup needed")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Not signed in yet")).toBeTruthy();
    });
    expect(screen.getByText("Never — not signed in yet")).toBeTruthy();
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Nothing waiting")).toBeTruthy();
    expect(screen.getByText("Automatic updates aren't available yet")).toBeTruthy();
  });

  it("surfaces the Claude Desktop Phase-1 limitation from the disclosure registry", () => {
    render(<StatusScreen snapshot={snapshot} />);
    for (const line of UNSUPPORTED_SOURCES) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(
      screen.getByText(
        "Claude Desktop: detailed conversation sync is not available in Phase 1",
      ),
    ).toBeTruthy();
  });

  it("reflects a signed-in, paused device honestly", async () => {
    backend.signedIn = true;
    backend.paused = true;
    backend.pending = 2;
    render(<StatusScreen snapshot={snapshot} />);
    await waitFor(() => {
      expect(screen.getByText("Yes — this computer is signed in")).toBeTruthy();
    });
    expect(screen.getByText("Analytics Only (collection paused)")).toBeTruthy();
    // Connected sources must NOT claim active reading while paused (it would
    // contradict the paused mode). No present-tense "is reading" from auth.
    expect(screen.getByText("Claude Code (collection paused)")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("never asserts active reading from sign-in alone — hedges 'if installed'", async () => {
    // Signed in + not paused: the strongest honest claim is still conditional,
    // because sign-in doesn't prove Claude Code is installed or running.
    backend.signedIn = true;
    backend.paused = false;
    render(<StatusScreen snapshot={snapshot} />);
    await waitFor(() => {
      expect(
        screen.getByText(
          "Claude Code — if installed, this computer reads its local logs",
        ),
      ).toBeTruthy();
    });
  });

  it("shows the real app version from the snapshot", () => {
    render(<StatusScreen snapshot={snapshot} />);
    expect(screen.getByText("0.1.0")).toBeTruthy();
  });

  it("renders placeholders when no snapshot is available yet", () => {
    render(<StatusScreen snapshot={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
