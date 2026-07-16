//! Revealyst Desktop Agent — Tauri 2 application core.
//!
//! Wave M1 app foundation: tray lifecycle, window shells, agent state
//! machine, structured logging. **No data collection exists** (M3/M5) and
//! **no network calls are made** — the only outbound action is opening the
//! Revealyst website in the user's default browser from the tray (validated
//! against the two Revealyst origins in `lifecycle.rs`).

pub mod allowlist;
pub mod commands;
pub mod lifecycle;
pub mod logging;
pub mod state;
pub mod tray;

use tauri::Manager;

/// The agent version, sourced from Cargo.toml so it can never drift from the
/// crate manifest.
pub fn agent_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        // A second launch shows + focuses the existing instance instead of
        // starting a duplicate background process (spec §19.1). Must be the
        // first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            lifecycle::show_main_window(app);
        }))
        // Autostart is OFF by default and only toggled by the user from the
        // privacy screen via `set_autostart` (plan T1.1).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Opener is used ONLY from the Rust side (tray "Open Revealyst",
        // validated allowlist) — the frontend has no opener capability.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_agent_snapshot,
            commands::get_autostart,
            commands::set_autostart,
        ])
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                if let Some(guard) = logging::init_logging(&log_dir) {
                    // Keep the non-blocking writer alive for the app's life.
                    app.manage(guard);
                }
            }
            tray::setup_tray(app.handle())?;
            lifecycle::apply_startup_visibility(app.handle());
            tracing::info!(
                component = "lifecycle",
                version = agent_version(),
                "agent started"
            );
            Ok(())
        })
        // Closing the window hides it — the agent keeps running in the tray
        // (spec §2.1). Quit is only via the tray menu.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Revealyst desktop agent");
}

#[cfg(test)]
mod tests {
    use super::agent_version;

    #[test]
    fn agent_version_is_a_semver_triple() {
        let parts: Vec<&str> = agent_version().split('.').collect();
        assert_eq!(parts.len(), 3, "version must be MAJOR.MINOR.PATCH");
        for part in parts {
            part.parse::<u64>()
                .expect("every version segment must be numeric");
        }
    }
}
