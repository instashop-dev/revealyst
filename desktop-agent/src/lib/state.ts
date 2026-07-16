// Agent connection-state model (spec §20).
//
// MIRROR of desktop-agent/src-tauri/src/state.rs — the Rust enum is the
// source of truth (it is what `get_agent_snapshot` serializes). Any change
// there (states OR labels) must be reflected here in the same PR.

export type AgentState =
  | "onboarding"
  | "healthy"
  | "partially_covered"
  | "offline"
  | "paused"
  | "authentication_required"
  | "policy_blocked"
  | "update_required"
  | "degraded"
  | "storage_full";

/** Plain-English status labels — mirrors `AgentState::status_label()` in state.rs. */
export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  onboarding: "Setup needed",
  healthy: "Syncing normally",
  partially_covered: "Running — some sources not covered",
  offline: "Offline — will retry",
  paused: "Paused",
  authentication_required: "Sign-in needed",
  policy_blocked: "Blocked by your organization",
  update_required: "Update needed",
  degraded: "Running with problems",
  storage_full: "Local storage is full",
};
