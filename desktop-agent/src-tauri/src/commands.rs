//! The narrow Tauri command surface (spec §22.2: the frontend must not
//! directly access filesystem/shell/network/etc. — it calls these narrowly
//! scoped Rust commands and nothing else).
//!
//! The surface grows one narrowly-scoped command at a time, per wave: the
//! read-only snapshot + autostart (M1), sign-in (M2), sync/pause (M4/T5.1),
//! and the M5 privacy-screen reads/actions (`get_collection_paused`,
//! `get_pending_count`, `delete_pending_data`, `disconnect_device`). Each is a
//! bounded Rust command — no filesystem/shell/network capability crosses to
//! the frontend (spec §22.2).

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::runtime::{self, CollectionControl};
use crate::state::{resolve_state, AgentState, StateInputs};
use crate::store::Store;
use crate::sync::{ReqwestTransport, SyncEngine};

/// The default (pre-enrollment) agent state: not enrolled → `Onboarding`. Used
/// for the tray's initial render before any managed state exists. The LIVE
/// state (once the store/control/sync-status are managed) is
/// [`resolve_live_state`], which the frontend snapshot uses.
pub fn current_state() -> AgentState {
    resolve_state(&StateInputs::default())
}

/// Resolve the agent's CURRENT state from live signals: enrollment (keychain
/// token), pause + mandatory-update ([`CollectionControl`]), and the sticky
/// sync-outcome flags ([`runtime::SyncStatus`], set by each sync cycle). Falls
/// back to the honest default (`Onboarding`) when the managed state isn't ready
/// yet. This is what makes "Syncing normally" / "Running with problems" etc.
/// reflect reality instead of the frozen M1 placeholder.
fn resolve_live_state<R: Runtime>(app: &AppHandle<R>) -> AgentState {
    let mut inputs = app
        .try_state::<Arc<runtime::SyncStatus>>()
        .map(|s| s.current())
        .unwrap_or_default();
    inputs.enrolled = crate::secrets::has_token();
    if let Some(control) = app.try_state::<Arc<CollectionControl>>() {
        inputs.paused = control.is_paused();
        inputs.update_required = control.is_update_required();
    }
    resolve_state(&inputs)
}

/// Everything the frontend is allowed to know, in one serializable snapshot.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshot {
    /// Spec §20 state string (e.g. "onboarding"), resolved live.
    pub state: AgentState,
    /// App version from Cargo.toml.
    pub version: String,
    /// OS family: "windows" | "macos" | "linux".
    pub platform: String,
    /// Whether "start at login" is currently on.
    pub autostart: bool,
    /// Where the log files live (shown on the diagnostics screen).
    pub log_dir: String,
    /// Whether this computer holds a device token (keychain presence only).
    pub signed_in: bool,
    /// Whether background collection is currently paused.
    pub paused: bool,
    /// Unix-ms of the most recent SUCCESSFUL upload, or `None` if never synced.
    /// Persisted in the store (`latest_upload_at`), so it survives a restart.
    pub last_sync_at: Option<i64>,
    /// How many analytics events are still waiting locally to be sent.
    pub pending_count: i64,
}

#[tauri::command]
pub fn get_agent_snapshot<R: Runtime>(app: AppHandle<R>) -> AgentSnapshot {
    let store = app.try_state::<Arc<Store>>().map(|s| s.inner().clone());
    let pending_count = store
        .as_ref()
        .map(|s| s.pending_count().unwrap_or(0))
        .unwrap_or(0);
    let last_sync_at = store
        .as_ref()
        .and_then(|s| s.latest_upload_at().ok().flatten());
    let paused = app
        .try_state::<Arc<CollectionControl>>()
        .map(|c| c.is_paused())
        .unwrap_or(false);

    AgentSnapshot {
        state: resolve_live_state(&app),
        version: crate::agent_version().to_string(),
        platform: std::env::consts::OS.to_string(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        log_dir: app
            .path()
            .app_log_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        signed_in: crate::secrets::has_token(),
        paused,
        last_sync_at,
        pending_count,
    }
}

#[tauri::command]
pub fn get_autostart<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Toggle "start at login". OFF by default; only ever changed by the user
/// from the privacy screen (plan T1.1: opt-in, "after user approval").
/// Begin browser-based sign-in (spec §8). Runs the full PKCE pairing dance and
/// stores the resulting device token in the OS keychain. Returns ONLY a
/// boolean (`true` = now signed in) — the token never crosses this boundary
/// (spec §8.3/§22.2). Errors surface as plain-English strings, never a token.
#[tauri::command]
pub async fn begin_sign_in<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    match crate::auth::run_pairing(&app).await {
        Ok(()) => Ok(true),
        Err(error) => {
            tracing::warn!(
                component = "commands",
                error_code = error.code(),
                "sign-in failed"
            );
            Err(error.user_message().to_string())
        }
    }
}

/// Whether this computer is signed in — a keychain-token presence check. The
/// ONLY signed-in signal the frontend can observe (never the token itself).
#[tauri::command]
pub fn is_signed_in() -> bool {
    crate::secrets::has_token()
}

/// Trigger one collect→sync cycle immediately ("Sync now"). Respects the same
/// enrollment/Personal-org/pause gates as the periodic loop (a no-op if not
/// enrolled or paused). Returns a plain-English status; never a token or path.
#[tauri::command]
pub async fn sync_now<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let store = match app.try_state::<Arc<Store>>() {
        Some(store) => store.inner().clone(),
        None => return Err("Collection isn't ready yet.".to_string()),
    };
    let control = match app.try_state::<Arc<CollectionControl>>() {
        Some(control) => control.inner().clone(),
        None => return Err("Collection isn't ready yet.".to_string()),
    };
    let status = match app.try_state::<Arc<runtime::SyncStatus>>() {
        Some(status) => status.inner().clone(),
        None => return Err("Collection isn't ready yet.".to_string()),
    };
    // Reuse the SHARED engine (managed in lib.rs) so the single-in-flight guard
    // serializes this manual sync against the background loop — a fresh engine
    // per click would let the two race and double-upload the same events.
    let engine = match app.try_state::<Arc<SyncEngine<ReqwestTransport>>>() {
        Some(engine) => engine.inner().clone(),
        None => return Err("Collection isn't ready yet.".to_string()),
    };
    if !runtime::collection_allowed(&control) {
        return Ok(
            "Nothing to sync yet — sign in first (and make sure sync isn't paused).".to_string(),
        );
    }
    let cfg = runtime::CollectConfig::from_env();
    let outcome = runtime::run_cycle(&store, &engine, &control, &cfg, &status).await;
    Ok(runtime::sync_now_message(outcome).to_string())
}

/// The `{imported, skipped, failed}` counts one export import produced, for the
/// import screen (spec §11.3.2). Counts only — never a path or any content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// User-initiated Claude data-export import (spec §11.3.2). Given a local file
/// path the user picked, the Rust core validates + parses the export ENTIRELY in
/// memory (hardened against path traversal + zip bombs) and privacy-gates the
/// day-aggregates, returning the imported/skipped/failed counts. Errors surface
/// as plain-English strings, never a path or content. Reading the file uses
/// `std::fs` on the Rust side — the frontend has no `fs:` capability.
///
/// NOTE: the projected events are computed + validated but NOT enqueued into the
/// shared sync queue. Live import→sync is gated on a connector-scoped-ingest ADR
/// (the server's window-delete is connection-scoped, so enqueuing an import that
/// overlaps the live connector's days would clobber those rows — see
/// `connectors::claude_export`). This command therefore reports what WOULD import
/// without yet persisting it.
#[tauri::command]
pub fn import_claude_export<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<ImportSummary, String> {
    let store = match app.try_state::<Arc<Store>>() {
        Some(store) => store.inner().clone(),
        None => return Err("Import isn't ready yet.".to_string()),
    };
    let cfg = runtime::CollectConfig::from_env();
    let now = crate::store::queue::now_ms();
    let ctx = runtime::build_context(now, &cfg);
    let archive_path = std::path::PathBuf::from(&path);
    match crate::connectors::claude_export::import_archive(&store, &ctx, &archive_path, now) {
        Ok(outcome) => Ok(ImportSummary {
            imported: outcome.imported,
            skipped: outcome.skipped,
            failed: outcome.failed,
        }),
        Err(error) => {
            tracing::warn!(
                component = "commands",
                error_code = error.code(),
                "claude export import failed"
            );
            Err(error.user_message().to_string())
        }
    }
}

/// Pause or resume background collection (the tray/privacy "Pause" control). While
/// paused, neither the periodic loop nor "Sync now" collects.
#[tauri::command]
pub fn set_collection_paused<R: Runtime>(app: AppHandle<R>, paused: bool) -> Result<(), String> {
    match app.try_state::<Arc<CollectionControl>>() {
        Some(control) => {
            control.set_paused(paused);
            tracing::info!(component = "commands", paused, "collection pause toggled");
            Ok(())
        }
        None => Err("Collection isn't ready yet.".to_string()),
    }
}

/// Whether background collection is currently paused (drives the privacy
/// screen's "Pause collection" toggle and the status "Privacy mode" row). When
/// collection isn't wired up yet there is nothing to pause, so the honest
/// default is `false`. A boolean only — never a path or token.
#[tauri::command]
pub fn get_collection_paused<R: Runtime>(app: AppHandle<R>) -> bool {
    let control = match app.try_state::<Arc<CollectionControl>>() {
        Some(control) => control.inner().clone(),
        None => return false,
    };
    control.is_paused()
}

/// How many analytics events are waiting in the local queue to be sent (the
/// "Waiting to send" status row + the "Delete pending local data" count). A
/// count only, never a payload; `0` when collection isn't ready — never a
/// fabricated number.
#[tauri::command]
pub fn get_pending_count<R: Runtime>(app: AppHandle<R>) -> i64 {
    let store = match app.try_state::<Arc<Store>>() {
        Some(store) => store.inner().clone(),
        None => return 0,
    };
    store.pending_count().unwrap_or(0)
}

/// Delete every analytics event still waiting in the local queue (the privacy
/// screen's "Delete pending local data" control, spec §19.4). Returns the
/// number removed. Touches ONLY the local outbox — never anything already
/// uploaded. A no-op returning 0 when collection isn't ready.
#[tauri::command]
pub fn delete_pending_data<R: Runtime>(app: AppHandle<R>) -> Result<usize, String> {
    let store = match app.try_state::<Arc<Store>>() {
        Some(store) => store.inner().clone(),
        None => return Ok(0),
    };
    store.purge_all_pending().map_err(|error| {
        tracing::warn!(
            component = "commands",
            error_code = error.code(),
            "delete pending data failed"
        );
        "Could not delete the pending data. Please try again.".to_string()
    })
}

/// Disconnect this computer from Revealyst (the privacy screen's "Disconnect
/// this device", spec §19.4). Wipes BOTH keychain secrets: the device token
/// (so the background loop idles — [`runtime::collection_allowed`] is
/// token-gated — and the server rejects the next attempt) AND the local-store
/// encryption key (which makes any queued analytics permanently unreadable by
/// design, spec §13). Absence of either secret is treated as success. Returns
/// nothing; errors surface as plain English, never a secret.
#[tauri::command]
pub fn disconnect_device() -> Result<(), String> {
    // Attempt BOTH wipes even if the first fails, so a half-disconnect can't
    // strand one secret. Report a single plain-English failure if either errs.
    let token = crate::secrets::delete_token();
    let db_key = crate::secrets::delete_db_key();
    if token.is_err() || db_key.is_err() {
        tracing::warn!(
            component = "commands",
            error_code = "disconnect_failed",
            "disconnect: wiping a keychain secret failed"
        );
        return Err("Could not fully disconnect this computer. Please try again.".to_string());
    }
    tracing::info!(
        component = "commands",
        "device disconnected (keychain secrets wiped)"
    );
    Ok(())
}

#[tauri::command]
pub fn set_autostart<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    match &result {
        Ok(()) => tracing::info!(component = "commands", enabled, "autostart changed"),
        Err(error) => tracing::warn!(
            component = "commands",
            error_code = "autostart_toggle_failed",
            error = %error,
            "could not change autostart"
        ),
    }
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave_m1_state_is_onboarding() {
        // No enrollment exists yet, so the only honest state is Onboarding.
        assert_eq!(current_state(), AgentState::Onboarding);
    }

    #[test]
    fn snapshot_serializes_with_camel_case_keys_and_spec_state_literal() {
        let snapshot = AgentSnapshot {
            state: current_state(),
            version: "0.1.0".into(),
            platform: "windows".into(),
            autostart: false,
            log_dir: "C:\\logs".into(),
            signed_in: true,
            paused: false,
            last_sync_at: Some(1_767_000_000_000),
            pending_count: 3,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["state"], "onboarding");
        assert_eq!(json["version"], "0.1.0");
        assert_eq!(json["platform"], "windows");
        assert_eq!(json["autostart"], false);
        assert_eq!(json["logDir"], "C:\\logs");
        // New live-status fields (camelCase serde) the status screen renders.
        assert_eq!(json["signedIn"], true);
        assert_eq!(json["paused"], false);
        assert_eq!(json["lastSyncAt"], 1_767_000_000_000i64);
        assert_eq!(json["pendingCount"], 3);
    }

    #[test]
    fn snapshot_serializes_never_synced_as_null_last_sync() {
        let snapshot = AgentSnapshot {
            state: current_state(),
            version: "0.1.0".into(),
            platform: "macos".into(),
            autostart: false,
            log_dir: String::new(),
            signed_in: false,
            paused: false,
            last_sync_at: None,
            pending_count: 0,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert!(json["lastSyncAt"].is_null(), "never-synced → null, not 0");
    }
}
