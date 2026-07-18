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
  /** Keychain-token presence only — never the token itself. */
  signedIn: boolean;
  /** Whether background collection is currently paused. */
  paused: boolean;
  /** Unix-ms of the most recent successful upload, or null if never synced. */
  lastSyncAt: number | null;
  /** Analytics events still waiting locally to be sent. */
  pendingCount: number;
};

export function getAgentSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("get_agent_snapshot");
}

/**
 * Trigger one collect→sync cycle immediately ("Sync now"). Respects the same
 * enrollment/pause gates as the periodic loop, so it is a safe no-op when not
 * signed in or paused. Resolves with a short plain-English result string;
 * errors arrive as plain-English strings, never a token.
 */
export function syncNow(): Promise<string> {
  return invoke<string>("sync_now");
}

/**
 * Check for a newer signed release right now ("Check for updates"). Runs the
 * same signed-updater path as the background loop (startup + every 6 hours) and
 * resolves with a short plain-English result. Safe to call whether or not this
 * computer is signed in — updates are independent of sign-in.
 */
export function checkForUpdates(): Promise<string> {
  return invoke<string>("check_for_updates");
}

/**
 * Send a diagnostics bundle now ("Send diagnostics"). Builds a counts-and-
 * versions bundle from the local store and sends it — never your prompt text or
 * any keys. Resolves with a plain-English result; errors arrive as plain-English
 * strings too.
 */
export function sendDiagnostics(): Promise<string> {
  return invoke<string>("send_diagnostics");
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

/** A supported source found on this computer — presence only (its name). */
export type DetectedSource = { name: string };

/**
 * Check THIS computer for supported sources (onboarding "Sources" step). Runs a
 * local presence check on the Rust side: it reads no prompt text, uploads
 * nothing, and returns only the plain-English names of the sources found.
 * Resolves to an empty list when none are present yet.
 */
export function detectSources(): Promise<DetectedSource[]> {
  return invoke<DetectedSource[]>("detect_sources");
}

/**
 * Open the Revealyst web app in the browser ("Open Revealyst" on the Finish
 * step). Opens only the allowlisted Revealyst origin, entirely on the Rust
 * side — the frontend has no opener capability.
 */
export function openRevealyst(): Promise<void> {
  return invoke<void>("open_revealyst");
}

/**
 * Finish first-run setup ("Done"/"Open Revealyst" on the Finish step). Records
 * that setup is complete and hides the window to the tray — the agent keeps
 * running quietly in the background.
 */
export function finishOnboarding(): Promise<void> {
  return invoke<void>("finish_onboarding");
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

/**
 * The saved answer to "Is this computer used only by you?" — `true` = only you
 * (activity is shown as yours), `false` = shared (kept at the computer level),
 * `null` = not answered yet (the privacy-safe default: computer level, never a
 * guessed person). Drives how this computer's activity is attributed.
 */
export function getDeviceUsedOnlyByMe(): Promise<boolean | null> {
  return invoke<boolean | null>("get_device_used_only_by_me");
}

/**
 * Save the "Is this computer used only by you?" answer. `true` shows this
 * computer's activity as yours; `false` keeps it at the computer level, not
 * tied to a person. The saved answer is the source of truth — no environment
 * flags or guessing.
 */
export function setDeviceUsedOnlyByMe(onlyMe: boolean): Promise<void> {
  return invoke<void>("set_device_used_only_by_me", { onlyMe });
}

/** How many analytics events are waiting locally to be sent. A count only;
 * `0` when nothing is collected yet — never a fabricated number. */
export function getPendingCount(): Promise<number> {
  return invoke<number>("get_pending_count");
}

/** A local, read-only "what we've collected" summary for the Privacy screen.
 * Presence/counts only — never content. */
export type CollectionSummary = {
  /** Distinct days with Claude Code activity on this computer in the last
   * `windowDays`. `null` when the local scan couldn't run (show "—"); a real
   * zero is `0` ("nothing yet"). */
  activeDays: number | null;
  /** The lookback window, in days (30). */
  windowDays: number;
};

/**
 * Read the local "what we've collected" summary (Privacy screen). Computed on
 * this computer from your own Claude Code logs — it sends nothing and reads no
 * prompt text. Resolves with the number of active days seen in the last 30 days
 * (or `null` if it couldn't be worked out).
 */
export function getCollectionSummary(): Promise<CollectionSummary> {
  return invoke<CollectionSummary>("get_collection_summary");
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
