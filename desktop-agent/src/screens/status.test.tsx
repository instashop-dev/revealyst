import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The status screen renders from the snapshot prop; "Sync now" calls the
// sync_now command. jsdom has no Tauri bridge, so invoke is mocked.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import { UNSUPPORTED_SOURCES } from "../lib/collection-disclosure";
import StatusScreen from "./status";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue("Sync finished.");
});

/** A signed-in, healthy snapshot; override per test. */
function snap(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    state: "healthy",
    version: "0.1.0",
    platform: "windows",
    autostart: false,
    logDir: "C:\\Users\\me\\AppData\\Local\\com.revealyst.desktop\\logs",
    signedIn: true,
    paused: false,
    lastSyncAt: null,
    pendingCount: 0,
    ...overrides,
  };
}

const notSignedIn = snap({ state: "onboarding", signedIn: false });

describe("StatusScreen", () => {
  it("shows honest not-signed-in placeholders — never fake data", () => {
    render(<StatusScreen snapshot={notSignedIn} />);
    expect(screen.getByText("Setup needed")).toBeTruthy();
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
    expect(screen.getByText("Never — not signed in yet")).toBeTruthy();
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Nothing waiting")).toBeTruthy();
    expect(
      screen.getByText(
        "Automatic updates are on. New signed versions install in the background.",
      ),
    ).toBeTruthy();
    // The stale "not available yet" copy is gone.
    expect(screen.queryByText("Automatic updates aren't available yet")).toBeNull();
    // No Sync now button while signed out...
    expect(screen.queryByRole("button", { name: /sync now/i })).toBeNull();
    // ...but Check for updates is always available (updates are sign-in-independent).
    expect(
      screen.getByRole("button", { name: /check for updates/i }),
    ).toBeTruthy();
  });

  it("surfaces the Claude Desktop Phase-1 limitation from the disclosure registry", () => {
    render(<StatusScreen snapshot={notSignedIn} />);
    for (const line of UNSUPPORTED_SOURCES) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(
      screen.getByText(
        "Claude Desktop: detailed conversation sync is not available in Phase 1",
      ),
    ).toBeTruthy();
  });

  it("reflects a signed-in, paused device honestly and disables Sync now", () => {
    render(
      <StatusScreen
        snapshot={snap({ state: "paused", paused: true, pendingCount: 2 })}
      />,
    );
    expect(screen.getByText("Yes — this computer is signed in")).toBeTruthy();
    expect(screen.getByText("Analytics Only (collection paused)")).toBeTruthy();
    expect(screen.getByText("Claude Code (collection paused)")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
    const button = screen.getByRole("button", { name: /sync now/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Resume collection to sync.")).toBeTruthy();
  });

  it("never asserts active reading from sign-in alone — hedges 'if installed'", () => {
    render(<StatusScreen snapshot={snap()} />);
    expect(
      screen.getByText(
        "Claude Code — if installed, this computer reads its local logs",
      ),
    ).toBeTruthy();
  });

  it("shows the real overall status label from the snapshot state", () => {
    render(<StatusScreen snapshot={snap({ state: "degraded" })} />);
    // The status is now LIVE — a degraded sync shows the problem, not "Setup needed".
    expect(screen.getByText("Running with problems")).toBeTruthy();
  });

  it("renders a real last-sync time when present", () => {
    render(<StatusScreen snapshot={snap({ lastSyncAt: Date.now() })} />);
    expect(screen.getByText("just now")).toBeTruthy();
  });

  it("does not claim 'Syncing normally' before the first sync has completed", () => {
    // Signed in + healthy flags but never synced (lastSyncAt null): an honest
    // "getting ready", not a false-positive "Syncing normally".
    render(<StatusScreen snapshot={snap({ state: "healthy", lastSyncAt: null })} />);
    expect(screen.getByText("Getting ready — first sync hasn't run yet")).toBeTruthy();
    expect(screen.queryByText("Syncing normally")).toBeNull();
  });

  it("shows 'Syncing normally' only once a sync has actually landed", () => {
    render(<StatusScreen snapshot={snap({ state: "healthy", lastSyncAt: Date.now() })} />);
    expect(screen.getByText("Syncing normally")).toBeTruthy();
  });

  it("Sync now triggers the sync_now command and refreshes", async () => {
    const onRefresh = vi.fn();
    render(<StatusScreen snapshot={snap()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("sync_now");
    });
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
    expect(screen.getByText("Sync finished.")).toBeTruthy();
  });

  it("shows the real app version from the snapshot", () => {
    render(<StatusScreen snapshot={snap()} />);
    expect(screen.getByText("0.1.0")).toBeTruthy();
  });

  it("renders placeholders when no snapshot is available yet", () => {
    render(<StatusScreen snapshot={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("reflects a pending required update in the Updates row", () => {
    render(<StatusScreen snapshot={snap({ state: "update_required" })} />);
    expect(
      screen.getByText(
        "A required update is pending — restart Revealyst to finish updating.",
      ),
    ).toBeTruthy();
  });

  it("Check for updates triggers the command and shows the plain-English result", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("You're on the latest version.");
    render(<StatusScreen snapshot={snap()} />);
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("check_for_updates");
    });
    expect(await screen.findByText("You're on the latest version.")).toBeTruthy();
  });

  it("shows a tray-pushed update result via the updateNotice prop", () => {
    render(
      <StatusScreen
        snapshot={snap()}
        updateNotice="A new version is ready. Restart Revealyst to finish updating."
      />,
    );
    expect(
      screen.getByText(
        "A new version is ready. Restart Revealyst to finish updating.",
      ),
    ).toBeTruthy();
  });
});
