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

/**
 * Start browser-based sign-in (spec §8). Opens the system browser, waits for
 * the deep-link callback, and stores the device token in the OS keychain on
 * the Rust side. Resolves `true` when this computer is signed in. The token is
 * never returned here — only this boolean — and errors arrive as plain-English
 * strings.
 */
export function beginSignIn(): Promise<boolean> {
  return invoke<boolean>("begin_sign_in");
}

/** Whether this computer already has a stored device token (keychain-backed).
 * The only signed-in signal the frontend can read — never the token itself. */
export function isSignedIn(): Promise<boolean> {
  return invoke<boolean>("is_signed_in");
}

/** Pause or resume background collection (privacy screen "Pause collection").
 * While paused, neither the periodic loop nor "Sync now" collects. */
export function setCollectionPaused(paused: boolean): Promise<void> {
  return invoke<void>("set_collection_paused", { paused });
}

/** Whether background collection is currently paused. `false` when collection
 * isn't wired up yet (nothing to pause). */
export function getCollectionPaused(): Promise<boolean> {
  return invoke<boolean>("get_collection_paused");
}

/** How many analytics events are waiting locally to be sent. A count only;
 * `0` when nothing is collected yet — never a fabricated number. */
export function getPendingCount(): Promise<number> {
  return invoke<number>("get_pending_count");
}

/** Delete every analytics event still waiting in the local queue (privacy
 * screen "Delete pending local data"). Resolves with the number removed. Only
 * the local outbox is touched — never already-uploaded data. */
export function deletePendingData(): Promise<number> {
  return invoke<number>("delete_pending_data");
}

/** Disconnect this computer: wipe the device token AND the local-store
 * encryption key from the OS keychain (privacy screen "Disconnect this
 * device"). Wiping the store key makes any queued analytics unreadable. */
export function disconnectDevice(): Promise<void> {
  return invoke<void>("disconnect_device");
}
