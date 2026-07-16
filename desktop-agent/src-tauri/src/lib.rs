//! Revealyst Desktop Agent — Tauri 2 application core.
//!
//! Wave M1 app foundation: tray lifecycle, window shells, agent state
//! machine, structured logging. Wave M2 adds browser-based sign-in: the ONLY
//! network calls are the two PKCE pairing requests in `auth.rs`
//! (`/api/desktop/auth/start` + `/exchange`); **no data collection exists**
//! (M3/M5). The resulting device token lives solely in the OS keychain
//! (`secrets.rs`) and never touches the frontend, logs, or disk.

pub mod allowlist;
pub mod auth;
pub mod commands;
pub mod deeplink;
pub mod lifecycle;
pub mod logging;
pub mod privacy;
pub mod secrets;
pub mod state;
pub mod store;
pub mod sync;
pub mod tray;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

/// Route one incoming `revealyst://` URL through the pending-auth store and log
/// the outcome. The URL itself is NEVER logged — it carries the one-time code
/// (spec §23.1); only the fixed outcome reason is.
fn dispatch_deep_link<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let store = app.state::<deeplink::PendingAuthStore>();
    match store.handle(url) {
        deeplink::CallbackOutcome::Accepted => {
            tracing::info!(
                component = "deeplink",
                result = "accepted",
                "pairing callback accepted"
            );
            lifecycle::show_main_window(app);
        }
        deeplink::CallbackOutcome::Ignored => tracing::info!(
            component = "deeplink",
            result = "ignored",
            "callback ignored (no pending sign-in or a replay)"
        ),
        deeplink::CallbackOutcome::Rejected(reason) => tracing::warn!(
            component = "deeplink",
            result = "rejected",
            error_code = reason,
            "callback rejected"
        ),
    }
}

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
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            lifecycle::show_main_window(app);
            // On Windows/Linux a deep link fired while the app is already
            // running re-launches it with the URL as an argv entry, which
            // single-instance forwards here.
            if let Some(url) = deeplink::first_scheme_url(&args) {
                dispatch_deep_link(app, url);
            }
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
        // Deep-link callbacks are handled ONLY on the Rust side (deeplink.rs);
        // no frontend deep-link capability exists. Production scheme
        // registration is via tauri.conf.json `plugins.deep-link`.
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_agent_snapshot,
            commands::get_autostart,
            commands::set_autostart,
            commands::begin_sign_in,
            commands::is_signed_in,
        ])
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                if let Some(guard) = logging::init_logging(&log_dir) {
                    // Keep the non-blocking writer alive for the app's life.
                    app.manage(guard);
                }
            }

            // The single in-flight pairing slot the deep-link handler and the
            // auth flow share.
            app.manage(deeplink::PendingAuthStore::default());

            // Register the revealyst:// scheme at runtime on Windows/Linux so
            // it works in a dev build without an installer. macOS registers it
            // from the bundle's Info.plist (tauri.conf.json config), where
            // runtime registration is not supported.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                if let Err(error) = app.deep_link().register(deeplink::SCHEME) {
                    tracing::warn!(
                        component = "deeplink",
                        error_code = "scheme_register_failed",
                        error = %error,
                        "could not register the deep-link scheme"
                    );
                }
            }

            // Deep links received while the app is running (macOS always;
            // Windows/Linux cold-start).
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    dispatch_deep_link(&handle, url.as_str());
                }
            });

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
