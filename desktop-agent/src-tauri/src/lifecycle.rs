//! Window + process lifecycle (spec §19.1, §2.1).
//!
//! The agent is a background tray utility: closing the window hides it (the
//! app keeps running in the tray), a second launch focuses the existing
//! instance, and the window is shown on startup only on first run or when
//! `--show` is passed.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

/// The only URL the agent ever opens in the user's browser.
pub const APP_URL: &str = "https://app.revealyst.com";

/// Origin allowlist for outbound browser opens: the two Revealyst origins,
/// nothing else (the opener is the agent's ONLY outbound surface in M1 —
/// there are no network calls). Kept as a pure function so it is testable.
pub fn is_allowed_revealyst_url(url: &str) -> bool {
    const ORIGINS: [&str; 2] = ["https://app.revealyst.com", "https://revealyst.com"];
    ORIGINS
        .iter()
        .any(|origin| url == *origin || url.starts_with(&format!("{origin}/")))
}

/// Open the Revealyst app in the user's default browser (tray "Open
/// Revealyst"). Uses the opener plugin's Rust-side API — the frontend has no
/// opener capability, so only this validated Rust path can open anything.
pub fn open_revealyst<R: Runtime>(app: &AppHandle<R>) {
    open_external(app, APP_URL);
}

fn open_external<R: Runtime>(app: &AppHandle<R>, url: &str) {
    if !is_allowed_revealyst_url(url) {
        tracing::warn!(
            component = "lifecycle",
            error_code = "url_not_allowlisted",
            "refused to open a non-Revealyst URL"
        );
        return;
    }
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        tracing::warn!(
            component = "lifecycle",
            error_code = "open_url_failed",
            error = %error,
            "could not open the browser"
        );
    }
}

/// Show + focus the main window (used by the tray, single-instance callback,
/// and startup logic).
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Show the main window and ask the frontend to switch to a screen
/// ("status" / "privacy"). The frontend listens for the `navigate` event.
pub fn show_screen<R: Runtime>(app: &AppHandle<R>, screen: &str) {
    show_main_window(app);
    if let Err(error) = app.emit("navigate", screen) {
        tracing::warn!(
            component = "lifecycle",
            error_code = "navigate_emit_failed",
            error = %error,
            "could not send the navigate event"
        );
    }
}

/// Startup visibility rule (documented choice for M1): the window is shown
/// only on first run (no prior-state marker on disk) or when `--show` is
/// passed; otherwise the app starts hidden in the tray. Pure and tested.
pub fn should_show_on_startup(args: &[String], first_run: bool) -> bool {
    first_run || args.iter().any(|arg| arg == "--show")
}

/// Marker file whose existence means "not the first run". Lives in the app
/// data dir; contains nothing.
fn first_run_marker<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("first-run-complete"))
}

/// Apply the startup visibility rule and record that the first run happened.
/// The main window is configured `visible: false` in tauri.conf.json, so
/// doing nothing here leaves the app hidden in the tray.
pub fn apply_startup_visibility<R: Runtime>(app: &AppHandle<R>) {
    let args: Vec<String> = std::env::args().collect();
    let marker = first_run_marker(app);
    let first_run = marker.as_ref().is_none_or(|m| !m.exists());

    if should_show_on_startup(&args, first_run) {
        show_main_window(app);
    }

    if first_run {
        if let Some(marker) = marker {
            if let Some(parent) = marker.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(error) = std::fs::write(&marker, b"") {
                tracing::warn!(
                    component = "lifecycle",
                    error_code = "first_run_marker_write_failed",
                    error = %error,
                    "could not record the first run"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_exactly_the_two_revealyst_origins() {
        assert!(is_allowed_revealyst_url("https://app.revealyst.com"));
        assert!(is_allowed_revealyst_url(
            "https://app.revealyst.com/dashboard"
        ));
        assert!(is_allowed_revealyst_url("https://revealyst.com"));
        assert!(is_allowed_revealyst_url(
            "https://revealyst.com/legal/what-we-collect"
        ));
    }

    #[test]
    fn rejects_everything_else() {
        for url in [
            "http://app.revealyst.com",             // not https
            "https://app.revealyst.com.evil.com",   // suffix spoof
            "https://app.revealyst.com.evil.com/x", // suffix spoof with path
            "https://evil.com/https://app.revealyst.com",
            "https://example.com",
            "file:///etc/passwd",
            "revealyst.com",
            "",
        ] {
            assert!(!is_allowed_revealyst_url(url), "must reject `{url}`");
        }
        assert!(
            is_allowed_revealyst_url(APP_URL),
            "the hard-coded URL must pass its own gate"
        );
    }

    #[test]
    fn startup_visibility_rule() {
        let no_args: Vec<String> = vec!["app.exe".into()];
        let show_flag: Vec<String> = vec!["app.exe".into(), "--show".into()];

        // First run always shows.
        assert!(should_show_on_startup(&no_args, true));
        // Subsequent runs stay hidden…
        assert!(!should_show_on_startup(&no_args, false));
        // …unless --show is passed.
        assert!(should_show_on_startup(&show_flag, false));
        // Similar-looking args don't count.
        let lookalike: Vec<String> = vec!["app.exe".into(), "--show-me".into()];
        assert!(!should_show_on_startup(&lookalike, false));
    }
}
