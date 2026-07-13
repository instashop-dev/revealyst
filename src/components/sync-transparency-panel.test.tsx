// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncTransparencyPanel } from "./sync-transparency-panel";
import {
  AGENT_NEVER_COLLECTED,
  AGENT_SENT_FIELDS,
} from "@/lib/agent-collection-schema";

describe("SyncTransparencyPanel", () => {
  it("renders the actual allowlisted field labels (derive-from-code)", () => {
    render(<SyncTransparencyPanel lastRun={null} />);
    // Every field that leaves the device is named — from the schema module.
    for (const f of AGENT_SENT_FIELDS) {
      expect(screen.getByText(f.label)).toBeInTheDocument();
    }
    // The model + a token field are the load-bearing "sent" ones.
    expect(screen.getByText("Model id")).toBeInTheDocument();
    expect(screen.getByText("Input tokens")).toBeInTheDocument();
    // On-device-only fields are shown too.
    expect(screen.getByText("Session id")).toBeInTheDocument();
  });

  it("lists what is never collected", () => {
    render(<SyncTransparencyPanel lastRun={null} />);
    for (const item of AGENT_NEVER_COLLECTED) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it("honesty gate: no run yet → neutral copy, no fabricated numbers", () => {
    render(<SyncTransparencyPanel lastRun={null} />);
    expect(screen.getByText(/No sync yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Your last sync/)).not.toBeInTheDocument();
    // Never a staleness nag (G5).
    expect(screen.queryByText(/sync now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue|out of date|haven't synced/i)).toBeNull();
  });

  it("shows real last-run counts and window when a successful run exists", () => {
    render(
      <SyncTransparencyPanel
        lastRun={{
          records: 340,
          signals: 12,
          subjects: 1,
          windowStart: "2026-07-01",
          windowEnd: "2026-07-12",
          syncedAt: new Date(),
        }}
      />,
    );
    expect(screen.getByText(/340 records/)).toBeInTheDocument();
    expect(screen.getByText(/12 day signals/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 → 2026-07-12/)).toBeInTheDocument();
    expect(screen.queryByText(/No sync yet/)).not.toBeInTheDocument();
  });
});
