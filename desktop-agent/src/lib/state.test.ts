import { describe, expect, it } from "vitest";

import { AGENT_STATE_LABELS, type AgentState } from "./state";

// Pinned to the Rust source of truth (src-tauri/src/state.rs).
const ALL_STATES: AgentState[] = [
  "onboarding",
  "healthy",
  "partially_covered",
  "offline",
  "paused",
  "authentication_required",
  "policy_blocked",
  "update_required",
  "degraded",
  "storage_full",
];

describe("agent state mirror", () => {
  it("has a non-empty plain-English label for all 10 states", () => {
    expect(Object.keys(AGENT_STATE_LABELS).sort()).toEqual([...ALL_STATES].sort());
    for (const state of ALL_STATES) {
      expect(AGENT_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it("mirrors the Rust status labels for key states", () => {
    expect(AGENT_STATE_LABELS.onboarding).toBe("Setup needed");
    expect(AGENT_STATE_LABELS.healthy).toBe("Syncing normally");
    expect(AGENT_STATE_LABELS.update_required).toBe("Update needed");
  });
});
