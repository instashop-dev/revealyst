import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Screens run inside the Tauri webview; jsdom has no Tauri bridge, so the
// invoke layer is mocked with a small stateful fake of the Rust command
// surface (the tests pin what the screen sends and shows, not the IPC).
const backend = vi.hoisted(() => ({
  autostart: false,
  paused: false,
  signedIn: true,
  pending: 3,
  onlyYou: null as boolean | null,
  summary: { activeDays: 4 as number | null, windowDays: 30 },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import type { AgentSnapshot } from "../lib/agent";
import {
  ENCRYPTION_DISCLOSURE,
  ON_DEVICE_ONLY_FIELDS,
  SENT_FIELDS,
} from "../lib/collection-disclosure";
import PrivacyScreen from "./privacy";

function fakeBackend(command: string, args?: unknown): Promise<unknown> {
  switch (command) {
    case "get_autostart":
      return Promise.resolve(backend.autostart);
    case "set_autostart":
      backend.autostart = (args as { enabled: boolean }).enabled;
      return Promise.resolve(undefined);
    case "get_collection_paused":
      return Promise.resolve(backend.paused);
    case "set_collection_paused":
      backend.paused = (args as { paused: boolean }).paused;
      return Promise.resolve(undefined);
    case "get_pending_count":
      return Promise.resolve(backend.pending);
    case "delete_pending_data": {
      const removed = backend.pending;
      backend.pending = 0;
      return Promise.resolve(removed);
    }
    case "is_signed_in":
      return Promise.resolve(backend.signedIn);
    case "disconnect_device":
      backend.signedIn = false;
      return Promise.resolve(undefined);
    case "get_collection_summary":
      return Promise.resolve(backend.summary);
    case "get_device_used_only_by_me":
      return Promise.resolve(backend.onlyYou);
    case "set_device_used_only_by_me":
      backend.onlyYou = (args as { onlyMe: boolean }).onlyMe;
      return Promise.resolve(undefined);
    default:
      return Promise.resolve(undefined);
  }
}

afterEach(cleanup);
beforeEach(() => {
  backend.autostart = false;
  backend.paused = false;
  backend.signedIn = true;
  backend.pending = 3;
  backend.onlyYou = null;
  backend.summary = { activeDays: 4, windowDays: 30 };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(fakeBackend as unknown as typeof invoke);
});

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\logs",
  signedIn: false,
  paused: false,
  lastSyncAt: null,
  pendingCount: 0,
};

describe("PrivacyScreen", () => {
  it("renders the spec §19.4 sections", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    expect(screen.getByText("Current mode")).toBeTruthy();
    expect(screen.getByText("What leaves this computer")).toBeTruthy();
    expect(screen.getByText("What never leaves this computer")).toBeTruthy();
    expect(screen.getByText("Organization restrictions")).toBeTruthy();
  });

  it("lists EXACTLY the allowlist sent:true fields under 'what leaves' (law 3)", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const leaves = screen.getByTestId("what-leaves");
    const items = leaves.querySelectorAll("li");
    // The rendered set is EXACTLY the allowlist's sent:true fields.
    expect(items.length).toBe(SENT_FIELDS.length);
    // Guard against a vacuous test if the allowlist ever empties.
    expect(SENT_FIELDS.length).toBeGreaterThan(0);
    // Every sent field is rendered (label + purpose from the artifact)...
    for (const f of SENT_FIELDS) {
      expect(leaves.textContent).toContain(f.label);
      expect(leaves.textContent).toContain(f.purpose);
    }
    // ...and NO on-device-only field leaks into the "what leaves" list.
    for (const f of ON_DEVICE_ONLY_FIELDS) {
      expect(leaves.textContent).not.toContain(f.label);
    }
  });

  it("lists EXACTLY the allowlist sent:false fields under 'what never leaves'", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const never = screen.getByTestId("what-never-leaves");
    const items = never.querySelectorAll("li");
    expect(items.length).toBe(ON_DEVICE_ONLY_FIELDS.length);
    expect(ON_DEVICE_ONLY_FIELDS.length).toBeGreaterThan(0);
    for (const f of ON_DEVICE_ONLY_FIELDS) {
      expect(never.textContent).toContain(f.label);
    }
    for (const f of SENT_FIELDS) {
      expect(never.textContent).not.toContain(f.label);
    }
  });

  it("discloses the honest encryption-delta (structure/timestamps/counts readable)", () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    expect(screen.getByText(ENCRYPTION_DISCLOSURE)).toBeTruthy();
    // The delta must name what is NOT hidden — not claim whole-file encryption.
    expect(ENCRYPTION_DISCLOSURE).toMatch(/AES-256-GCM/);
    expect(ENCRYPTION_DISCLOSURE).toMatch(/can be read if someone copies the file/);
  });

  it("shows the real active-day count from the local summary", async () => {
    backend.summary = { activeDays: 4, windowDays: 30 };
    render(<PrivacyScreen snapshot={snapshot} />);
    const proof = await screen.findByTestId("collection-proof");
    await waitFor(() => {
      expect(proof.textContent).toContain("4 days");
    });
    expect(proof.textContent).toContain("last 30 days");
    expect(invoke).toHaveBeenCalledWith("get_collection_summary");
  });

  it("renders a genuine zero as '0 days', never hidden (honest empty state)", async () => {
    backend.summary = { activeDays: 0, windowDays: 30 };
    render(<PrivacyScreen snapshot={snapshot} />);
    const proof = await screen.findByTestId("collection-proof");
    await waitFor(() => {
      expect(proof.textContent).toContain("0 days");
    });
  });

  it("falls back to an honest '—' when the local count can't be read", async () => {
    backend.summary = { activeDays: null, windowDays: 30 };
    render(<PrivacyScreen snapshot={snapshot} />);
    const proof = await screen.findByTestId("collection-proof");
    // The active-day line shows the placeholder, not an invented count.
    await waitFor(() => {
      expect(proof.textContent).toContain("— with Claude Code activity");
    });
    // Never invents an active-day number in the unknown state.
    expect(proof.textContent).not.toMatch(/\d+ days? with Claude Code activity/);
  });

  it("always states the 0-prompts / 0-text guarantee, whatever the count", async () => {
    // The guarantee is structural (a consequence of the allowlist), so it must
    // show regardless of the active-day number — never a computed counter.
    backend.summary = { activeDays: 12, windowDays: 30 };
    render(<PrivacyScreen snapshot={snapshot} />);
    const proof = await screen.findByTestId("collection-proof");
    expect(proof.textContent).toContain("prompts or AI replies read");
    expect(proof.textContent).toContain("words of your text sent");
    // Worded as a permanent guarantee, not a maybe-nonzero measurement.
    expect(screen.getByText(/always zero, by design/i)).toBeTruthy();
  });

  it("shows 'who uses this computer' with neither option pre-selected before an answer", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    expect(screen.getByText("Who uses this computer")).toBeTruthy();
    const onlyMe = screen.getByRole("radio", { name: /Only I use this computer/ });
    const shared = screen.getByRole("radio", { name: /Other people use it too/ });
    // Invariant (b) / safe default: nothing is attributed to a person until the
    // user actively answers, so neither radio is checked.
    await waitFor(() => {
      expect((onlyMe as HTMLInputElement).checked).toBe(false);
      expect((shared as HTMLInputElement).checked).toBe(false);
    });
  });

  it("answering 'only I use this computer' saves via set_device_used_only_by_me", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("radio", { name: /Only I use this computer/ }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_device_used_only_by_me", { onlyMe: true });
    });
    expect(backend.onlyYou).toBe(true);
  });

  it("reflects a saved 'shared computer' answer on mount", async () => {
    backend.onlyYou = false;
    render(<PrivacyScreen snapshot={snapshot} />);
    const shared = screen.getByRole("radio", { name: /Other people use it too/ });
    await waitFor(() => {
      expect((shared as HTMLInputElement).checked).toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith("get_device_used_only_by_me");
  });

  it("pausing collection calls set_collection_paused", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Pause collection/ });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_collection_paused", { paused: true });
    });
    expect(backend.paused).toBe(true);
  });

  it("deleting pending data confirms, then calls delete_pending_data", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete pending local data" }));
    // Confirm step appears — the command has NOT fired yet.
    expect(invoke).not.toHaveBeenCalledWith("delete_pending_data");
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_pending_data");
    });
  });

  it("disconnecting confirms, then calls disconnect_device", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect this device" }));
    expect(invoke).not.toHaveBeenCalledWith("disconnect_device");
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_device");
    });
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

  it("start-at-login toggling persists via set_autostart", async () => {
    render(<PrivacyScreen snapshot={snapshot} />);
    const toggle = screen.getByRole("checkbox", { name: /Start Revealyst when you log in/ });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    });
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });
    expect(backend.autostart).toBe(true);
  });
});
