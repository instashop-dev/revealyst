//! Tray menu (spec §19.1).
//!
//! The menu is derived by `menu_model`, a pure function over
//! (`AgentState`, last sync, paused) — the tray plumbing below is a thin
//! renderer of that model, and the table-driven tests pin the model, not the
//! plumbing. The menu is rebuilt in place ([`refresh_tray`]) when the pause
//! state changes so the Pause/Resume label stays honest.

use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::lifecycle;
use crate::runtime::CollectionControl;
use crate::state::AgentState;
use crate::store::Store;
use crate::update;

/// The tray icon's stable id — used to look the icon back up so its menu can be
/// rebuilt when live state (e.g. the pause toggle) changes.
const TRAY_ID: &str = "revealyst-tray";

/// Stable menu-entry ids (used by the click handler; never shown to users).
pub mod ids {
    pub const STATUS: &str = "status";
    pub const LAST_SYNC: &str = "last-sync";
    pub const OPEN_REVEALYST: &str = "open-revealyst";
    pub const CONNECTION_STATUS: &str = "connection-status";
    pub const PRIVACY_SETTINGS: &str = "privacy-settings";
    pub const PAUSE_COLLECTION: &str = "pause-collection";
    pub const CHECK_UPDATES: &str = "check-updates";
    pub const SEND_DIAGNOSTICS: &str = "send-diagnostics";
    pub const QUIT: &str = "quit";
}

/// One entry of the tray menu model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuEntry {
    /// Non-clickable information line (rendered as a disabled item).
    Info {
        id: &'static str,
        text: String,
    },
    Separator,
    /// A clickable action — or a deliberately disabled placeholder.
    ///
    /// `note`: plain-English explanation of WHY a placeholder is disabled.
    /// Native menus have no tooltips (Tauri/muda expose none), so the
    /// renderer folds the note into the visible label — an unexplained dead
    /// menu item would violate the plain-English UX principles.
    Action {
        id: &'static str,
        label: &'static str,
        enabled: bool,
        note: Option<&'static str>,
    },
}

impl MenuEntry {
    /// The exact text the user sees for this entry.
    pub fn text(&self) -> String {
        match self {
            MenuEntry::Info { text, .. } => text.clone(),
            MenuEntry::Separator => String::new(),
            MenuEntry::Action { label, note, .. } => match note {
                Some(note) => format!("{label} ({note})"),
                None => (*label).to_string(),
            },
        }
    }
}

/// A small, glanceable status the tray icon encodes as a colored accent dot.
/// A tray icon is looked at, not opened, so the ten spec §20 states are
/// collapsed into three clearly-distinct meanings — the most a user can read at
/// tray size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayStatus {
    /// Running and healthy — nothing for the user to do.
    Normal,
    /// Needs the user's attention (set-up, sign-in, an update, storage, a
    /// blocked policy, or a problem while running).
    Attention,
    /// Deliberately not collecting right now (paused, or offline and retrying).
    Idle,
}

impl TrayStatus {
    /// Project the resolved [`AgentState`] onto one of the three tray meanings.
    /// This NEVER derives state itself — it is a pure mapping of the state
    /// `resolve_state` already produced, so the icon can never disagree with the
    /// status line (both read the same resolved state).
    pub fn for_state(state: AgentState) -> TrayStatus {
        match state {
            // Running fine (some-sources-uncovered is still "running").
            AgentState::Healthy | AgentState::PartiallyCovered => TrayStatus::Normal,
            // The user needs to act, or the agent hit a problem.
            AgentState::Onboarding
            | AgentState::AuthenticationRequired
            | AgentState::PolicyBlocked
            | AgentState::UpdateRequired
            | AgentState::Degraded
            | AgentState::StorageFull => TrayStatus::Attention,
            // Not collecting on purpose (paused) or temporarily (offline).
            AgentState::Paused | AgentState::Offline => TrayStatus::Idle,
        }
    }

    /// The accent-dot color (opaque RGB) for this status. Green = good, amber =
    /// needs attention, slate-grey = idle/paused — a familiar traffic-light read.
    fn accent_rgb(self) -> [u8; 3] {
        match self {
            TrayStatus::Normal => [34, 197, 94],     // green
            TrayStatus::Attention => [245, 158, 11], // amber
            TrayStatus::Idle => [148, 163, 184],     // slate grey
        }
    }
}

/// Paint the status accent onto a COPY of the bundled base mark and return a new
/// owned image. The base icon is reused unchanged; only a small dot in the
/// bottom-right corner (with a thin light ring so it stays visible against any
/// mark) is drawn — so the three variants read as the same app with a clear
/// status accent, not three unrelated drawings. The dot is sized as a fraction
/// of the icon, so it stays crisp whatever size the OS renders the tray at.
fn status_icon(base: &Image<'_>, status: TrayStatus) -> Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();
    let [ar, ag, ab] = status.accent_rgb();

    let w = width as i32;
    let h = height as i32;
    let min = w.min(h) as f32;
    // Dot radius ~26% of the smaller side, inset from the corner; the ring is a
    // thin lighter halo just outside the solid core.
    let radius = (min * 0.26).max(3.0);
    let ring = (radius * 0.30).max(1.0);
    let inset = min * 0.06;
    let cx = w as f32 - radius - inset;
    let cy = h as f32 - radius - inset;

    for y in 0..h {
        for x in 0..w {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist > radius + ring {
                continue;
            }
            let idx = ((y * w + x) as usize) * 4;
            if idx + 3 >= rgba.len() {
                continue;
            }
            if dist <= radius {
                // Solid accent core, fully opaque.
                rgba[idx] = ar;
                rgba[idx + 1] = ag;
                rgba[idx + 2] = ab;
                rgba[idx + 3] = 255;
            } else {
                // Light contrast ring around the core.
                rgba[idx] = 248;
                rgba[idx + 1] = 250;
                rgba[idx + 2] = 252;
                rgba[idx + 3] = 255;
            }
        }
    }
    Image::new_owned(rgba, width, height)
}

/// Build the status-accented tray icon for the app's CURRENT resolved state,
/// reusing the bundled base mark. `None` only if the base icon is missing (then
/// the caller keeps whatever icon is already showing).
fn live_status_icon<R: Runtime>(app: &AppHandle<R>) -> Option<Image<'static>> {
    let status = TrayStatus::for_state(crate::commands::resolve_live_state(app));
    let base = app.default_window_icon()?;
    Some(status_icon(base, status))
}

/// Derive the spec §19.1 tray menu from the agent state, last-sync time, and
/// whether background collection is currently paused.
///
/// Every action is now LIVE (the backends all shipped):
/// - "Pause collection" / "Resume collection" toggles the same
///   [`CollectionControl`] the Privacy screen uses; the label reflects the
///   current pause state (`paused`).
/// - "Check for updates" runs the signed updater on demand (startup + 6-hourly
///   loop already runs it in the background).
/// - "Send diagnostics" builds a counts-only bundle from the local store and
///   POSTs it to `/api/desktop/diagnostics`.
pub fn menu_model(state: &AgentState, last_sync: Option<&str>, paused: bool) -> Vec<MenuEntry> {
    // Pausing when collecting, resuming when paused — the label reflects the
    // live pause state so it never lies about what the click will do.
    let pause_label = if paused {
        "Resume collection"
    } else {
        "Pause collection"
    };
    vec![
        MenuEntry::Info {
            id: ids::STATUS,
            text: format!("● {}", state.status_label()),
        },
        MenuEntry::Info {
            id: ids::LAST_SYNC,
            text: format!("Last sync: {}", last_sync.unwrap_or("—")),
        },
        MenuEntry::Separator,
        MenuEntry::Action {
            id: ids::OPEN_REVEALYST,
            label: "Open Revealyst",
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::CONNECTION_STATUS,
            label: "Connection status",
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::PRIVACY_SETTINGS,
            label: "Privacy settings",
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::PAUSE_COLLECTION,
            label: pause_label,
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::CHECK_UPDATES,
            label: "Check for updates",
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::SEND_DIAGNOSTICS,
            label: "Send diagnostics",
            enabled: true,
            note: None,
        },
        MenuEntry::Action {
            id: ids::QUIT,
            label: "Quit",
            enabled: true,
            note: None,
        },
    ]
}

/// Whether background collection is currently paused, read from the live
/// [`CollectionControl`] (the same authority the Privacy screen and snapshot
/// use). `false` when collection isn't wired up yet — nothing to pause.
fn live_paused<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Arc<CollectionControl>>()
        .map(|control| control.is_paused())
        .unwrap_or(false)
}

/// Build the tray menu model from the agent's live state + live pause flag, so
/// the status line and the Pause/Resume label reflect reality. The last-sync
/// line stays "—" here (formatting it is the window's job); the menu is rebuilt
/// via [`refresh_tray`] whenever the pause state changes.
fn live_menu_model<R: Runtime>(app: &AppHandle<R>) -> Vec<MenuEntry> {
    let state = crate::commands::resolve_live_state(app);
    menu_model(&state, None, live_paused(app))
}

/// Build the native tray icon + menu from the live model. The icon carries the
/// current status accent from the start, so a device that opens needing sign-in
/// (or set-up) shows the attention accent immediately, not after the first
/// refresh.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, &live_menu_model(app))?;

    let base = app
        .default_window_icon()
        .cloned()
        .expect("bundled app icon must exist");
    let status = TrayStatus::for_state(crate::commands::resolve_live_state(app));
    let icon = status_icon(&base, status);

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Revealyst")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;
    // The status accent is COLOR, so the tray icon must render in full color on
    // macOS — a template icon would be flattened to a monochrome tint and hide
    // the accent. (The base mark was already the colored app icon, never a
    // template, so this only makes that explicit.)
    let _ = tray.set_icon_as_template(false);
    Ok(())
}

/// Rebuild the tray menu AND refresh the status-accent icon in place from the
/// current live state. Called whenever the resolved state can change: the pause
/// toggle (tray OR Privacy screen), each sync cycle, and each update check — so
/// both the Pause/Resume label and the icon accent always reflect reality. The
/// icon switch reuses this one path (it never derives state on its own).
pub fn refresh_tray<R: Runtime>(app: &AppHandle<R>) {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray,
        None => {
            tracing::warn!(
                component = "tray",
                error_code = "tray_not_found",
                "tray icon not found while refreshing"
            );
            return;
        }
    };

    match build_menu(app, &live_menu_model(app)) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                tracing::warn!(
                    component = "tray",
                    error_code = "menu_set_failed",
                    error = %error,
                    "could not apply the rebuilt tray menu"
                );
            }
        }
        Err(error) => tracing::warn!(
            component = "tray",
            error_code = "menu_build_failed",
            error = %error,
            "could not rebuild the tray menu"
        ),
    }

    if let Some(icon) = live_status_icon(app) {
        if let Err(error) = tray.set_icon(Some(icon)) {
            tracing::warn!(
                component = "tray",
                error_code = "icon_set_failed",
                error = %error,
                "could not apply the status tray icon"
            );
        }
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, model: &[MenuEntry]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for entry in model {
        match entry {
            MenuEntry::Separator => {
                menu.append(&PredefinedMenuItem::separator(app)?)?;
            }
            // Info lines render as disabled items — visible, not clickable.
            MenuEntry::Info { id, .. } | MenuEntry::Action { id, .. } => {
                let enabled = matches!(entry, MenuEntry::Action { enabled: true, .. });
                let text = entry.text();
                menu.append(&MenuItem::with_id(
                    app,
                    *id,
                    text.as_str(),
                    enabled,
                    None::<&str>,
                )?)?;
            }
        }
    }
    Ok(menu)
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ids::OPEN_REVEALYST => lifecycle::open_revealyst(app),
        ids::CONNECTION_STATUS => lifecycle::show_screen(app, "status"),
        ids::PRIVACY_SETTINGS => lifecycle::show_screen(app, "privacy"),
        ids::PAUSE_COLLECTION => toggle_pause(app),
        ids::CHECK_UPDATES => trigger_check_updates(app),
        ids::SEND_DIAGNOSTICS => trigger_send_diagnostics(app),
        ids::QUIT => {
            tracing::info!(component = "tray", "quit requested from tray menu");
            app.exit(0);
        }
        // Info lines can't emit events; anything else is ignored.
        _ => {}
    }
}

/// Toggle background collection from the tray, flipping the live
/// [`CollectionControl`] the Privacy screen shares, then rebuild the menu so the
/// item flips between "Pause collection" and "Resume collection". A no-op (with
/// a log line) if collection isn't wired up yet — nothing to pause.
fn toggle_pause<R: Runtime>(app: &AppHandle<R>) {
    match app.try_state::<Arc<CollectionControl>>() {
        Some(control) => {
            let now_paused = !control.is_paused();
            control.set_paused(now_paused);
            // Persist so a paused device stays paused after a reboot (the same
            // guarantee the privacy screen's toggle gives).
            if let Some(store) = app.try_state::<Arc<Store>>() {
                crate::runtime::persist_paused(store.inner(), now_paused);
            }
            tracing::info!(
                component = "tray",
                paused = now_paused,
                "collection pause toggled from tray"
            );
            refresh_tray(app);
        }
        None => tracing::warn!(
            component = "tray",
            error_code = "collection_not_ready",
            "pause toggled before collection was ready; nothing to pause"
        ),
    }
}

/// Kick off a manual "Check for updates" from the tray: bring the window to the
/// Status screen (where the result is shown), run the SAME signed-updater check
/// the background loop runs, and emit the plain-English outcome as an
/// `update-result` event the window displays. Never blocks the tray thread.
fn trigger_check_updates<R: Runtime>(app: &AppHandle<R>) {
    // Show the Status screen first so its listener is mounted before the check's
    // network round-trip completes and the result event arrives.
    lifecycle::show_screen(app, "status");

    let store = app.try_state::<Arc<Store>>().map(|s| s.inner().clone());
    let control = app
        .try_state::<Arc<CollectionControl>>()
        .map(|c| c.inner().clone());
    let (Some(store), Some(control)) = (store, control) else {
        tracing::warn!(
            component = "update",
            error_code = "not_ready",
            "update check requested before the store/control were ready"
        );
        emit_update_result(app, update::NOT_READY_MESSAGE);
        return;
    };

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = update::check_now(&handle, &store, &control).await;
        emit_update_result(&handle, outcome.message());
        // A mandatory update sets `update_required`, which changes the resolved
        // state — refresh so the tray icon accent flips right away.
        refresh_tray(&handle);
    });
}

/// Send the plain-English update result to the window (the Status screen shows
/// it). A failed emit is logged, never fatal.
fn emit_update_result<R: Runtime>(app: &AppHandle<R>, message: &str) {
    if let Err(error) = app.emit("update-result", message) {
        tracing::warn!(
            component = "update",
            error_code = "emit_failed",
            error = %error,
            "could not report the update result to the window"
        );
    }
}

/// Kick off the user-triggered "Send diagnostics" action (T4.3): resolve the
/// on-disk store + log paths and spawn the one-shot build-and-POST. Never
/// blocks the tray thread; the outcome (and only a non-secret code) is logged by
/// [`crate::diagnostics::send_diagnostics`]. A richer in-window "sent / failed"
/// surface is the T5.4 status screen's job.
fn trigger_send_diagnostics<R: Runtime>(app: &AppHandle<R>) {
    let store_path = match app.path().app_data_dir() {
        Ok(dir) => dir.join(crate::store::DB_FILE_NAME),
        Err(_) => {
            tracing::warn!(
                component = "diagnostics",
                error_code = "no_data_dir",
                "cannot resolve the app data dir for diagnostics"
            );
            return;
        }
    };
    let log_dir = app.path().app_log_dir().ok();
    tauri::async_runtime::spawn(async move {
        crate::diagnostics::send_diagnostics(&store_path, log_dir.as_deref()).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AgentState;

    const ALL_STATES: [AgentState; 10] = [
        AgentState::Onboarding,
        AgentState::Healthy,
        AgentState::PartiallyCovered,
        AgentState::Offline,
        AgentState::Paused,
        AgentState::AuthenticationRequired,
        AgentState::PolicyBlocked,
        AgentState::UpdateRequired,
        AgentState::Degraded,
        AgentState::StorageFull,
    ];

    fn entry_by_id<'a>(model: &'a [MenuEntry], wanted: &str) -> &'a MenuEntry {
        model
            .iter()
            .find(|e| match e {
                MenuEntry::Info { id, .. } | MenuEntry::Action { id, .. } => *id == wanted,
                MenuEntry::Separator => false,
            })
            .unwrap_or_else(|| panic!("menu entry `{wanted}` missing"))
    }

    fn enabled_of(entry: &MenuEntry) -> bool {
        match entry {
            MenuEntry::Action { enabled, .. } => *enabled,
            _ => panic!("expected an Action entry"),
        }
    }

    #[test]
    fn every_state_yields_its_status_label_on_the_status_line() {
        for state in ALL_STATES {
            let model = menu_model(&state, None, false);
            let status = entry_by_id(&model, ids::STATUS);
            assert_eq!(
                status.text(),
                format!("● {}", state.status_label()),
                "status line for {state:?}"
            );
        }
    }

    #[test]
    fn menu_order_matches_spec_19_1() {
        let model = menu_model(&AgentState::Healthy, Some("2 minutes ago"), false);
        let ids_in_order: Vec<&str> = model
            .iter()
            .map(|e| match e {
                MenuEntry::Info { id, .. } | MenuEntry::Action { id, .. } => *id,
                MenuEntry::Separator => "separator",
            })
            .collect();
        assert_eq!(
            ids_in_order,
            vec![
                ids::STATUS,
                ids::LAST_SYNC,
                "separator",
                ids::OPEN_REVEALYST,
                ids::CONNECTION_STATUS,
                ids::PRIVACY_SETTINGS,
                ids::PAUSE_COLLECTION,
                ids::CHECK_UPDATES,
                ids::SEND_DIAGNOSTICS,
                ids::QUIT,
            ]
        );
    }

    #[test]
    fn last_sync_placeholder_and_value_render() {
        for state in ALL_STATES {
            let model = menu_model(&state, None, false);
            assert_eq!(entry_by_id(&model, ids::LAST_SYNC).text(), "Last sync: —");
        }
        let model = menu_model(&AgentState::Healthy, Some("2 minutes ago"), false);
        assert_eq!(
            entry_by_id(&model, ids::LAST_SYNC).text(),
            "Last sync: 2 minutes ago"
        );
    }

    /// The pause item is now a LIVE toggle (enabled, no placeholder note) in
    /// every state, and its label reflects the current pause flag: "Pause
    /// collection" when collecting, "Resume collection" when paused.
    #[test]
    fn pause_item_is_a_live_toggle_with_a_state_aware_label() {
        for state in ALL_STATES {
            let collecting = menu_model(&state, None, false);
            let pause = entry_by_id(&collecting, ids::PAUSE_COLLECTION);
            assert!(enabled_of(pause), "pause must be enabled ({state:?})");
            assert_eq!(pause.text(), "Pause collection");

            let paused = menu_model(&state, None, true);
            let resume = entry_by_id(&paused, ids::PAUSE_COLLECTION);
            assert!(enabled_of(resume), "resume must be enabled ({state:?})");
            assert_eq!(resume.text(), "Resume collection");
        }
    }

    /// "Check for updates" is now live (enabled, no placeholder note) in every
    /// state — it runs the same signed updater the background loop runs.
    #[test]
    fn check_for_updates_is_live_in_every_state() {
        for state in ALL_STATES {
            for paused in [false, true] {
                let model = menu_model(&state, None, paused);
                let updates = entry_by_id(&model, ids::CHECK_UPDATES);
                assert!(
                    enabled_of(updates),
                    "check-updates must be enabled ({state:?}, paused={paused})"
                );
                assert_eq!(updates.text(), "Check for updates");
            }
        }
    }

    /// "Send diagnostics" is live (enabled, no placeholder note) in every state —
    /// it builds a counts-only bundle and POSTs it.
    #[test]
    fn send_diagnostics_is_live_in_every_state() {
        for state in ALL_STATES {
            let model = menu_model(&state, None, false);
            let diagnostics = entry_by_id(&model, ids::SEND_DIAGNOSTICS);
            assert!(
                enabled_of(diagnostics),
                "send-diagnostics must be enabled ({state:?})"
            );
            assert_eq!(diagnostics.text(), "Send diagnostics");
        }
    }

    /// Every one of the ten spec §20 states maps to a tray status, and all
    /// three statuses are reachable — so the icon accent is defined for any
    /// resolved state and genuinely distinguishes the three meanings.
    #[test]
    fn every_state_maps_to_a_tray_status_and_all_three_are_reachable() {
        use std::collections::BTreeSet;
        let mut kinds: BTreeSet<&str> = BTreeSet::new();
        for state in ALL_STATES {
            let kind = match TrayStatus::for_state(state) {
                TrayStatus::Normal => "normal",
                TrayStatus::Attention => "attention",
                TrayStatus::Idle => "idle",
            };
            kinds.insert(kind);
        }
        assert_eq!(
            kinds.len(),
            3,
            "all three tray statuses must be reachable: {kinds:?}"
        );
    }

    /// The specific meaning of each state's accent, pinned so a state can't
    /// silently drift into the wrong bucket (e.g. a real problem showing green).
    #[test]
    fn tray_status_buckets_match_state_meaning() {
        use TrayStatus::*;
        for (state, expected) in [
            (AgentState::Healthy, Normal),
            (AgentState::PartiallyCovered, Normal),
            (AgentState::Onboarding, Attention),
            (AgentState::AuthenticationRequired, Attention),
            (AgentState::PolicyBlocked, Attention),
            (AgentState::UpdateRequired, Attention),
            (AgentState::Degraded, Attention),
            (AgentState::StorageFull, Attention),
            (AgentState::Paused, Idle),
            (AgentState::Offline, Idle),
        ] {
            assert_eq!(
                TrayStatus::for_state(state),
                expected,
                "tray status for {state:?}"
            );
        }
    }

    /// The three accents are visually distinct colors (a user must be able to
    /// tell them apart at a glance).
    #[test]
    fn tray_status_accents_are_distinct() {
        let colors = [
            TrayStatus::Normal.accent_rgb(),
            TrayStatus::Attention.accent_rgb(),
            TrayStatus::Idle.accent_rgb(),
        ];
        for i in 0..colors.len() {
            for j in (i + 1)..colors.len() {
                assert_ne!(colors[i], colors[j], "accents {i} and {j} must differ");
            }
        }
    }

    #[test]
    fn live_actions_are_enabled_in_every_state() {
        for state in ALL_STATES {
            let model = menu_model(&state, None, false);
            for id in [
                ids::OPEN_REVEALYST,
                ids::CONNECTION_STATUS,
                ids::PRIVACY_SETTINGS,
                ids::PAUSE_COLLECTION,
                ids::CHECK_UPDATES,
                ids::SEND_DIAGNOSTICS,
                ids::QUIT,
            ] {
                assert!(
                    enabled_of(entry_by_id(&model, id)),
                    "`{id}` must be enabled ({state:?})"
                );
            }
        }
    }
}
