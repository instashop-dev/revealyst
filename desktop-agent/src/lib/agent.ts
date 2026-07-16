// The frontend's ONLY window into the Rust core (spec §22.2): one read-only
// snapshot command plus the two autostart commands used by the privacy
// screen. Do not add invoke calls anywhere else — new surface area is a
// reviewed decision, not a convenience.

import { invoke } from "@tauri-apps/api/core";

import type { AgentState } from "./state";

/** Mirrors `AgentSnapshot` in src-tauri/src/commands.rs (camelCase serde). */
export type AgentSnapshot = {
  state: AgentState;
  version: string;
  platform: string;
  autostart: boolean;
  logDir: string;
};

export function getAgentSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("get_agent_snapshot");
}

export function getAutostart(): Promise<boolean> {
  return invoke<boolean>("get_autostart");
}

export function setAutostart(enabled: boolean): Promise<void> {
  return invoke<void>("set_autostart", { enabled });
}
