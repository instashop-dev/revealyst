//! Tray menu (spec §19.1).
//!
//! The menu is derived by `menu_model`, a pure function over
//! (`AgentState`, last sync) — the tray plumbing below is a thin renderer of
//! that model, and the table-driven tests pin the model, not the plumbing.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};

use crate::lifecycle;
use crate::state::AgentState;

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

/// Derive the spec §19.1 tray menu from the agent state and last-sync time.
///
/// Wave M1 placeholders (all honest — spec hard rules: never fake a pause,
/// never fake data):
/// - "Pause collection" is present but disabled: collection does not exist
///   until M3/M5, and a pause that pauses nothing would be a fake control.
/// - "Check for updates" is disabled until the signed updater ships (M6).
/// - "Send diagnostics" is disabled until the diagnostics bundle ships (M4).
pub fn menu_model(state: &AgentState, last_sync: Option<&str>) -> Vec<MenuEntry> {
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
            label: "Pause collection",
            enabled: false,
            note: Some("nothing is collected yet"),
        },
        MenuEntry::Action {
            id: ids::CHECK_UPDATES,
            label: "Check for updates",
            enabled: false,
            note: Some("not available yet"),
        },
        MenuEntry::Action {
            id: ids::SEND_DIAGNOSTICS,
            label: "Send diagnostics",
            enabled: false,
            note: Some("not available yet"),
        },
        MenuEntry::Action {
            id: ids::QUIT,
            label: "Quit",
            enabled: true,
            note: None,
        },
    ]
}

/// Build the native tray icon + menu from the pure model.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let model = menu_model(&crate::commands::current_state(), None);
    let menu = build_menu(app, &model)?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundled app icon must exist");

    TrayIconBuilder::with_id("revealyst-tray")
        .icon(icon)
        .tooltip("Revealyst")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;
    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, model: &[MenuEntry]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for entry in model {
        match entry {
            MenuEntry::Separator => {
                menu.append(&PredefinedMenuItem::separator(app)?)?;
            }
            MenuEntry::Info { id, .. } => {
                // Info lines render as disabled items — visible, not clickable.
                menu.append(&MenuItem::with_id(
                    app,
                    *id,
                    entry.text(),
                    false,
                    None::<&str>,
                )?)?;
            }
            MenuEntry::Action { id, enabled, .. } => {
                menu.append(&MenuItem::with_id(
                    app,
                    *id,
                    entry.text(),
                    *enabled,
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
        ids::QUIT => {
            tracing::info!(component = "tray", "quit requested from tray menu");
            app.exit(0);
        }
        // Disabled placeholders (pause/updates/diagnostics) and info lines
        // can't emit events; anything else is ignored.
        _ => {}
    }
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
            let model = menu_model(&state, None);
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
        let model = menu_model(&AgentState::Healthy, Some("2 minutes ago"));
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
            let model = menu_model(&state, None);
            assert_eq!(entry_by_id(&model, ids::LAST_SYNC).text(), "Last sync: —");
        }
        let model = menu_model(&AgentState::Healthy, Some("2 minutes ago"));
        assert_eq!(
            entry_by_id(&model, ids::LAST_SYNC).text(),
            "Last sync: 2 minutes ago"
        );
    }

    #[test]
    fn wave_m1_placeholders_are_disabled_in_every_state_with_plain_notes() {
        for state in ALL_STATES {
            let model = menu_model(&state, None);

            let pause = entry_by_id(&model, ids::PAUSE_COLLECTION);
            assert!(!enabled_of(pause), "pause must be disabled ({state:?})");
            assert_eq!(pause.text(), "Pause collection (nothing is collected yet)");

            let updates = entry_by_id(&model, ids::CHECK_UPDATES);
            assert!(
                !enabled_of(updates),
                "check-updates must be disabled ({state:?})"
            );
            assert_eq!(updates.text(), "Check for updates (not available yet)");

            let diagnostics = entry_by_id(&model, ids::SEND_DIAGNOSTICS);
            assert!(
                !enabled_of(diagnostics),
                "send-diagnostics must be disabled ({state:?})"
            );
            assert_eq!(diagnostics.text(), "Send diagnostics (not available yet)");
        }
    }

    #[test]
    fn live_actions_are_enabled_in_every_state() {
        for state in ALL_STATES {
            let model = menu_model(&state, None);
            for id in [
                ids::OPEN_REVEALYST,
                ids::CONNECTION_STATUS,
                ids::PRIVACY_SETTINGS,
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
