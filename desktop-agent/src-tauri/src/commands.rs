//! The narrow Tauri command surface (spec §22.2: the frontend must not
//! directly access filesystem/shell/network/etc. — it calls these narrowly
//! scoped Rust commands and nothing else).
//!
//! Wave M1 surface: ONE read-only snapshot command plus the two autostart
//! commands used by the privacy screen. No other commands exist.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::state::{resolve_state, AgentState, StateInputs};

/// The agent's current state. Wave M1 has no enrollment (M2) and no
/// collection (M3/M5), so the inputs are the honest defaults: not enrolled →
/// `Onboarding`. Later waves feed real signals in here.
pub fn current_state() -> AgentState {
    resolve_state(&StateInputs::default())
}

/// Everything the frontend is allowed to know, in one serializable snapshot.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshot {
    /// Spec §20 state string (e.g. "onboarding").
    pub state: AgentState,
    /// App version from Cargo.toml.
    pub version: String,
    /// OS family: "windows" | "macos" | "linux".
    pub platform: String,
    /// Whether "start at login" is currently on.
    pub autostart: bool,
    /// Where the log files live (shown on the diagnostics screen).
    pub log_dir: String,
}

#[tauri::command]
pub fn get_agent_snapshot<R: Runtime>(app: AppHandle<R>) -> AgentSnapshot {
    AgentSnapshot {
        state: current_state(),
        version: crate::agent_version().to_string(),
        platform: std::env::consts::OS.to_string(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        log_dir: app
            .path()
            .app_log_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

#[tauri::command]
pub fn get_autostart<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Toggle "start at login". OFF by default; only ever changed by the user
/// from the privacy screen (plan T1.1: opt-in, "after user approval").
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
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["state"], "onboarding");
        assert_eq!(json["version"], "0.1.0");
        assert_eq!(json["platform"], "windows");
        assert_eq!(json["autostart"], false);
        assert_eq!(json["logDir"], "C:\\logs");
    }
}
