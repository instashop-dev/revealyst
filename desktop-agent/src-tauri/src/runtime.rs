//! The live collection runtime (Wave M5; Desktop Agent plan T5.1).
//!
//! This is where the merged pipeline becomes live end-to-end: a background task
//! runs `detect → collect → validate → enqueue → sync drains → server`
//! periodically for an enrolled Personal-org device, and the tray/UI can trigger
//! it on demand ([`run_cycle`]).
//!
//! ## Gates (all three required before anything is collected)
//!
//! 1. **Enrolled.** A device token must exist in the OS keychain
//!    ([`crate::secrets::has_token`]). No token ⇒ the cycle is a no-op — nothing
//!    is read from the logs and nothing is queued.
//! 2. **Personal org only (D-DA-2).** A device token is issued ONLY for a
//!    Personal org — the pairing backend refuses Team enrollment — so gating on
//!    token presence *is* the Personal-only gate. There is no code path that
//!    collects for a Team org because a Team device never has a token.
//! 3. **Not paused.** The loop skips collection while
//!    [`CollectionControl::paused`] is set (the tray/privacy "Pause" control).
//!
//! The policy is resolved from [`PolicyInputs::default`] (Phase 1 = Analytics
//! Only); a blocked policy makes [`collect_and_enqueue`] halt without touching
//! the checkpoint.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::connectors::claude_code::ClaudeCodeConnector;
use crate::connectors::{collect_and_enqueue, ConnectorContext, DEFAULT_POLL_INTERVAL_SECS};
use crate::privacy::{resolve, PolicyInputs};
use crate::store::queue::now_ms;
use crate::store::Store;
use crate::sync::{ReqwestTransport, SyncEngine};

/// Live-collection control shared between the loop and the command surface. Phase
/// 1 exposes a single pause switch; the loop reads it every tick.
#[derive(Debug, Default)]
pub struct CollectionControl {
    paused: AtomicBool,
}

impl CollectionControl {
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
    }
}

/// Inputs that shape a collection pass but come from the OS environment / user
/// settings rather than the on-disk logs.
#[derive(Debug, Clone)]
pub struct CollectConfig {
    pub home_dir: PathBuf,
    pub device_seed: String,
    pub window_days: u32,
    pub shared_device: bool,
    pub consent_identity: bool,
    pub config_dir_override: Option<String>,
}

impl CollectConfig {
    /// Resolve from the OS environment. The shared-device + identity-consent
    /// toggles are wired to the privacy/onboarding screen in T5.4; for dogfood
    /// they are sourced from env so a shared machine (or identity consent) can be
    /// declared without a rebuild:
    ///   - `REVEALYST_SHARED_DEVICE=1` → account attribution + honesty gap (§10.3)
    ///   - `REVEALYST_IDENTITY_CONSENT=1` → attach the Claude account email as a
    ///     `person` subject (otherwise the device account is used — invariant-b).
    pub fn from_env() -> Self {
        CollectConfig {
            home_dir: home_dir(),
            device_seed: device_seed(),
            window_days: 30,
            shared_device: env_flag("REVEALYST_SHARED_DEVICE"),
            consent_identity: env_flag("REVEALYST_IDENTITY_CONSENT"),
            config_dir_override: std::env::var("CLAUDE_CONFIG_DIR").ok(),
        }
    }
}

fn env_flag(key: &str) -> bool {
    matches!(std::env::var(key).as_deref(), Ok("1") | Ok("true"))
}

fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// A stable machine-scoped seed for the device-account fallback subject. Only its
/// SHA-256 hash ever leaves the machine (see `resolve_local_identity`).
fn device_seed() -> String {
    let host = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_default();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    format!("{host}|{user}")
}

/// Build the connector context for a pass at wall-clock `now`.
pub fn build_context(now: i64, cfg: &CollectConfig) -> ConnectorContext {
    ConnectorContext {
        policy: resolve(&PolicyInputs::default()),
        now_ms: now,
        window_days: cfg.window_days,
        consent_identity: cfg.consent_identity,
        shared_device: cfg.shared_device,
        home_dir: cfg.home_dir.clone(),
        config_dir_override: cfg.config_dir_override.clone(),
        device_seed: cfg.device_seed.clone(),
    }
}

/// Whether a collection pass is permitted right now: enrolled AND not paused.
/// Enrollment (a keychain device token) also enforces Personal-only (D-DA-2).
pub fn collection_allowed(control: &CollectionControl) -> bool {
    crate::secrets::has_token() && !control.is_paused()
}

/// One full collect→sync cycle. No-op unless [`collection_allowed`]. Collects the
/// Claude Code source into the queue (crash-safe, privacy-gated) then drains the
/// queue to the server. Errors are logged with content-free codes, never
/// propagated to a panic.
pub async fn run_cycle(
    store: &Store,
    engine: &SyncEngine<ReqwestTransport>,
    control: &CollectionControl,
    cfg: &CollectConfig,
) {
    if !collection_allowed(control) {
        return;
    }

    let ctx = build_context(now_ms(), cfg);
    let connector = ClaudeCodeConnector::new();
    if let Err(err) = collect_and_enqueue(&connector, &ctx, store).await {
        tracing::warn!(
            component = "runtime",
            error_code = err.code(),
            "collect cycle failed"
        );
    }

    // Drain the queue. `sync` reads the device token from the keychain and
    // returns AuthenticationRequired if it has since been revoked.
    match engine.sync(store).await {
        Ok(outcome) => tracing::info!(
            component = "runtime",
            outcome = ?outcome,
            "sync cycle complete"
        ),
        Err(err) => tracing::warn!(
            component = "runtime",
            error_code = err.code(),
            "sync cycle failed"
        ),
    }
}

/// Spawn the periodic collect→sync loop on the Tauri async runtime. Conservative:
/// a fixed poll interval, single connector, and the three gates enforced every
/// tick. The manual "Sync now" trigger ([`crate::commands::sync_now`]) shares the
/// same [`run_cycle`].
pub fn spawn_loop(store: Arc<Store>, control: Arc<CollectionControl>) {
    tauri::async_runtime::spawn(async move {
        let cfg = CollectConfig::from_env();
        let engine = SyncEngine::new();
        let interval = Duration::from_secs(DEFAULT_POLL_INTERVAL_SECS);
        tracing::info!(
            component = "runtime",
            interval_secs = DEFAULT_POLL_INTERVAL_SECS,
            "collection loop started (idle until enrolled)"
        );
        loop {
            run_cycle(&store, &engine, &control, &cfg).await;
            tokio::time::sleep(interval).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_gate_blocks_collection() {
        let control = CollectionControl::default();
        assert!(!control.is_paused());
        control.set_paused(true);
        assert!(control.is_paused());
        // Even if a token existed, a paused control forbids collection.
        assert!(!collection_allowed(&control));
    }

    #[test]
    fn env_flag_parsing() {
        std::env::set_var("REVEALYST_TEST_FLAG_A", "1");
        std::env::set_var("REVEALYST_TEST_FLAG_B", "true");
        std::env::set_var("REVEALYST_TEST_FLAG_C", "no");
        assert!(env_flag("REVEALYST_TEST_FLAG_A"));
        assert!(env_flag("REVEALYST_TEST_FLAG_B"));
        assert!(!env_flag("REVEALYST_TEST_FLAG_C"));
        assert!(!env_flag("REVEALYST_TEST_FLAG_UNSET"));
    }

    #[test]
    fn context_carries_analytics_only_policy_and_window() {
        let cfg = CollectConfig {
            home_dir: PathBuf::from("/tmp/home"),
            device_seed: "seed".to_string(),
            window_days: 30,
            shared_device: true,
            consent_identity: false,
            config_dir_override: None,
        };
        let ctx = build_context(1_767_000_000_000, &cfg);
        assert!(matches!(
            ctx.policy,
            crate::privacy::PolicyResolution::Allow(crate::privacy::ContentMode::AnalyticsOnly)
        ));
        assert_eq!(ctx.window_days, 30);
        assert!(ctx.shared_device);
    }
}
