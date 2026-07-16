//! Revealyst Desktop Agent — Tauri 2 application core.
//!
//! Wave M0 scaffold: a single placeholder window, single-instance
//! enforcement, and nothing else. No data collection exists (D-DA-1 gates
//! all collection behavior; see docs/Revealyst_Desktop_Agent_Execution_Plan.md).

/// The agent version, sourced from Cargo.toml so it can never drift from the
/// crate manifest.
pub fn agent_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        // A second launch focuses the existing instance instead of starting a
        // duplicate background process (spec §19.1).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
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
