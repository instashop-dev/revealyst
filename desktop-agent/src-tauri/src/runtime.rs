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
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::connectors::claude_code::ClaudeCodeConnector;
use crate::connectors::{collect_and_enqueue, ConnectorContext, DEFAULT_POLL_INTERVAL_SECS};
use crate::privacy::{resolve, PolicyInputs};
use crate::state::StateInputs;
use crate::store::queue::now_ms;
use crate::store::Store;
use crate::sync::{ReqwestTransport, SyncEngine, SyncOutcome};

/// Live-collection control shared between the loop and the command surface.
/// Phase 1 exposes a pause switch and a mandatory-update block; the loop reads
/// both every tick.
#[derive(Debug, Default)]
pub struct CollectionControl {
    paused: AtomicBool,
    /// Set by the update loop when a MANDATORY (security/privacy/protocol)
    /// update is available (spec §18.3/§20 `update_required`): sync is blocked
    /// until the update installs. Cleared when the update is gone (installed or
    /// the release was halted/pulled).
    update_required: AtomicBool,
    /// Set while an update check (`check → download → install`) is running, so
    /// the background loop, the tray "Check for updates", and the Status-screen
    /// button never run two overlapping checks — which would download+install
    /// the SAME release twice (e.g. two installer/UAC prompts). Claim it with
    /// [`CollectionControl::try_begin_update_check`], release with
    /// [`CollectionControl::end_update_check`].
    update_check_in_flight: AtomicBool,
}

impl CollectionControl {
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
    }

    /// Whether a mandatory update is blocking collection (spec §20
    /// `update_required`).
    pub fn is_update_required(&self) -> bool {
        self.update_required.load(Ordering::Acquire)
    }

    /// Set/clear the mandatory-update block (the update loop owns this).
    pub fn set_update_required(&self, update_required: bool) {
        self.update_required
            .store(update_required, Ordering::Release);
    }

    /// Try to claim the single update-check slot. Returns `true` if the caller
    /// now owns the check (and MUST release it with [`end_update_check`]),
    /// `false` if a check is already running. This is the single-in-flight
    /// guard that keeps the loop + the two manual triggers from racing the same
    /// download/install.
    pub fn try_begin_update_check(&self) -> bool {
        self.update_check_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// Release the update-check slot claimed by [`try_begin_update_check`].
    pub fn end_update_check(&self) {
        self.update_check_in_flight.store(false, Ordering::Release);
    }
}

/// The sync-owned condition flags from the most recent sync cycle, shared with
/// the command surface so the status UI reflects REAL sync outcomes instead of
/// the hardwired M1 default (`StateInputs::default()` → always `Onboarding`).
///
/// Only the sync-derived flags actually set by [`SyncOutcome::apply`] —
/// `offline`, `degraded` (sticky), and `authentication_required` — are
/// accumulated here. Enrollment, pause, and mandatory-update are NOT stored
/// here: they have their own live authorities (the keychain token and
/// [`CollectionControl`]) and are merged in at snapshot time, so a stale copy
/// can never contradict them.
///
/// The sticky `degraded` flag is now PERSISTED (schema v2 `local_settings`) and
/// restored on startup via [`SyncStatus::restored`], so a real drop signal is
/// no longer lost on relaunch. The fresh-per-attempt flags (`offline` /
/// `authentication_required`) are deliberately NOT restored: they re-derive on
/// the first cycle (within seconds of launch), and carrying a stale "offline"
/// across a restart would be misleading.
#[derive(Debug, Default)]
pub struct SyncStatus {
    inputs: Mutex<StateInputs>,
}

impl SyncStatus {
    /// Rebuild from the persisted sticky flag on startup. Only `degraded` is
    /// carried across a restart (the fresh-per-attempt flags re-derive on the
    /// first cycle), so a standing drop signal survives a relaunch.
    pub fn restored(degraded: bool) -> Self {
        SyncStatus {
            inputs: Mutex::new(StateInputs {
                degraded,
                ..StateInputs::default()
            }),
        }
    }

    /// Fold the latest sync outcome into the sticky flags (called once per
    /// cycle by [`run_cycle`]).
    pub fn record(&self, outcome: SyncOutcome) {
        let mut guard = self.inputs.lock().expect("sync-status mutex poisoned");
        outcome.apply(&mut guard);
    }

    /// A copy of the current sync-derived flags. The caller overwrites
    /// `enrolled`/`paused`/`update_required` from their live authorities before
    /// resolving the agent state.
    pub fn current(&self) -> StateInputs {
        *self.inputs.lock().expect("sync-status mutex poisoned")
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
    /// Resolve from the OS environment only. The shared-device + identity-consent
    /// toggles come from env here:
    ///   - `REVEALYST_SHARED_DEVICE=1` → account attribution + honesty gap (§10.3)
    ///   - `REVEALYST_IDENTITY_CONSENT=1` → attach the Claude account email as a
    ///     `person` subject (otherwise the device account is used — invariant-b).
    ///
    /// Used where the persisted answer is not needed (e.g. local source
    /// detection, which never resolves identity) and by tests. The live
    /// collection path uses [`CollectConfig::resolve`] instead, so the user's
    /// saved onboarding/privacy answer is the source of truth.
    pub fn from_env() -> Self {
        let (shared_device, consent_identity) = env_identity_flags();
        CollectConfig {
            home_dir: home_dir(),
            device_seed: device_seed(),
            window_days: 30,
            shared_device,
            consent_identity,
            config_dir_override: std::env::var("CLAUDE_CONFIG_DIR").ok(),
        }
    }

    /// Resolve for a live collection pass, with the user's SAVED answer to "Is
    /// this computer used only by you?" as the source of truth for attribution:
    ///   - saved "only you"  → attribute activity to the person;
    ///   - saved "shared"    → account/device level + the honesty gap (§10.3);
    ///   - not answered yet  → the privacy-safe default (account/device level,
    ///     never a guessed person, no shared-device claim). Before an answer
    ///     exists the dev env flags still apply as an override, so dogfood can
    ///     declare a shared machine or identity consent without a rebuild.
    ///
    /// A store-read failure falls back to the same privacy-safe default (env
    /// flags still honored) — never to attributing activity to a named person.
    pub fn resolve(store: &Store) -> Self {
        let saved = store
            .read_local_settings()
            .ok()
            .and_then(|s| s.identity_only_you);
        let (shared_device, consent_identity) = match saved {
            // The saved answer is authoritative once given.
            Some(true) => (false, true),
            Some(false) => (true, false),
            // Unanswered: privacy-safe default, honoring the dev env override.
            None => env_identity_flags(),
        };
        CollectConfig {
            home_dir: home_dir(),
            device_seed: device_seed(),
            window_days: 30,
            shared_device,
            consent_identity,
            config_dir_override: std::env::var("CLAUDE_CONFIG_DIR").ok(),
        }
    }
}

/// The dev/dogfood env override for attribution: `(shared_device,
/// consent_identity)`. Absent flags yield the privacy-safe default `(false,
/// false)` — account/device level, never a guessed person.
fn env_identity_flags() -> (bool, bool) {
    (
        env_flag("REVEALYST_SHARED_DEVICE"),
        env_flag("REVEALYST_IDENTITY_CONSENT"),
    )
}

/// Persist the pause flag so a paused device stays paused after a reboot — a
/// paused device silently resuming collection would be a privacy surprise. A
/// store-write failure is logged, never fatal: the in-memory pause still holds
/// for this session.
pub fn persist_paused(store: &Store, paused: bool) {
    if let Err(err) = store.set_paused_setting(paused, now_ms()) {
        tracing::warn!(
            component = "runtime",
            error_code = err.code(),
            "could not persist pause state"
        );
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

/// Whether a collection pass is permitted right now: enrolled, not paused, AND
/// not blocked by a mandatory update. Enrollment (a keychain device token) also
/// enforces Personal-only (D-DA-2). A pending mandatory update (spec §20
/// `update_required`) blocks sync until the agent updates — already-queued
/// events stay durable and upload once the new version is running.
pub fn collection_allowed(control: &CollectionControl) -> bool {
    crate::secrets::has_token() && !control.is_paused() && !control.is_update_required()
}

/// One full collect→sync cycle. No-op unless [`collection_allowed`]. Collects the
/// Claude Code source into the queue (crash-safe, privacy-gated) then drains the
/// queue to the server. Errors are logged with content-free codes, never
/// propagated to a panic.
/// Returns the sync outcome so a caller (the "Sync now" command) can report an
/// honest result. `None` means no sync was attempted (collection not allowed)
/// or the drain hit a local store error — never conflate either with success.
pub async fn run_cycle(
    store: &Store,
    engine: &SyncEngine<ReqwestTransport>,
    control: &CollectionControl,
    cfg: &CollectConfig,
    status: &SyncStatus,
) -> Option<SyncOutcome> {
    if !collection_allowed(control) {
        return None;
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
    // returns AuthenticationRequired if it has since been revoked. The outcome
    // is folded into the shared status so the tray/window reflect it (a real
    // 2xx clears the sticky `degraded`; a failure sets the matching flag).
    match engine.sync(store).await {
        Ok(outcome) => {
            status.record(outcome);
            // Persist the sticky `degraded` flag so a real drop signal survives
            // a restart (the other status flags are fresh-per-attempt and
            // re-derive on the next cycle).
            if let Err(err) = store.set_degraded_setting(status.current().degraded, now_ms()) {
                tracing::warn!(
                    component = "runtime",
                    error_code = err.code(),
                    "could not persist sync status"
                );
            }
            tracing::info!(
                component = "runtime",
                outcome = ?outcome,
                "sync cycle complete"
            );
            Some(outcome)
        }
        Err(err) => {
            tracing::warn!(
                component = "runtime",
                error_code = err.code(),
                "sync cycle failed"
            );
            None
        }
    }
}

/// A short, honest plain-English result for a manual "Sync now" click, from the
/// cycle's outcome. Never claims success for a `Busy`/`Idle`/failure outcome.
pub fn sync_now_message(outcome: Option<SyncOutcome>) -> &'static str {
    match outcome {
        Some(SyncOutcome::Healthy) => "Sync finished.",
        Some(SyncOutcome::Idle) => "Nothing new to send.",
        Some(SyncOutcome::Busy) => "A sync is already running.",
        Some(SyncOutcome::Offline) => "Can't reach Revealyst right now — will retry.",
        Some(SyncOutcome::AuthenticationRequired) => "Please sign in again.",
        Some(SyncOutcome::Degraded) => "Synced, but some items had problems.",
        None => "Couldn't complete the sync. Please try again.",
    }
}

/// Spawn the periodic collect→sync loop on the Tauri async runtime. Conservative:
/// a fixed poll interval, single connector, and the three gates enforced every
/// tick. The manual "Sync now" trigger ([`crate::commands::sync_now`]) shares the
/// same [`run_cycle`].
pub fn spawn_loop(
    store: Arc<Store>,
    control: Arc<CollectionControl>,
    status: Arc<SyncStatus>,
    engine: Arc<SyncEngine<ReqwestTransport>>,
) {
    tauri::async_runtime::spawn(async move {
        let interval = Duration::from_secs(DEFAULT_POLL_INTERVAL_SECS);
        tracing::info!(
            component = "runtime",
            interval_secs = DEFAULT_POLL_INTERVAL_SECS,
            "collection loop started (idle until enrolled)"
        );
        loop {
            // Re-resolve each cycle so a change to the saved "used only by you"
            // answer takes effect without a restart (cheap: one local read).
            let cfg = CollectConfig::resolve(&store);
            // The engine is SHARED with the "Sync now" command so its
            // single-in-flight guard actually serializes the two paths (a
            // per-call engine would let a manual sync race the loop and
            // double-upload the same events).
            run_cycle(&store, &engine, &control, &cfg, &status).await;
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
    fn update_check_slot_admits_only_one_at_a_time() {
        let control = CollectionControl::default();
        // First claimant wins…
        assert!(control.try_begin_update_check());
        // …a second concurrent claim is refused while the first holds the slot.
        assert!(!control.try_begin_update_check());
        // Releasing lets the next caller claim it again.
        control.end_update_check();
        assert!(control.try_begin_update_check());
        control.end_update_check();
    }

    #[test]
    fn mandatory_update_blocks_collection() {
        let control = CollectionControl::default();
        assert!(!control.is_update_required());
        control.set_update_required(true);
        assert!(control.is_update_required());
        // A pending mandatory update forbids collection regardless of the
        // pause/enrollment state (spec §20 update_required blocks sync).
        assert!(!collection_allowed(&control));
        // Clearing it (update installed / release pulled) flips the flag back
        // off. (We can't assert collection_allowed becomes true here — this test
        // has no keychain token, so the enrollment gate keeps it false; the
        // point proven is that update_required no longer contributes a block.)
        control.set_update_required(false);
        assert!(!control.is_update_required());
    }

    #[test]
    fn sync_status_records_and_clears_sticky_flags() {
        let status = SyncStatus::default();
        assert!(!status.current().degraded, "fresh status has no problems");

        // A degraded cycle sets the sticky flag the UI reads.
        status.record(SyncOutcome::Degraded);
        assert!(status.current().degraded);
        assert!(!status.current().offline);

        // An Idle cycle (empty queue) must NOT clear the sticky degraded flag.
        status.record(SyncOutcome::Idle);
        assert!(status.current().degraded, "Idle keeps the standing signal");

        // Only a genuine Healthy sync clears it.
        status.record(SyncOutcome::Healthy);
        assert!(!status.current().degraded, "a real 2xx clears the signal");
    }

    #[test]
    fn sync_now_message_never_fakes_success() {
        // Only a genuine Healthy sync says "finished"; every other outcome is
        // honest about what happened (invariant b).
        assert_eq!(
            sync_now_message(Some(SyncOutcome::Healthy)),
            "Sync finished."
        );
        assert_eq!(
            sync_now_message(Some(SyncOutcome::Idle)),
            "Nothing new to send."
        );
        assert_eq!(
            sync_now_message(Some(SyncOutcome::Busy)),
            "A sync is already running."
        );
        for other in [
            SyncOutcome::Offline,
            SyncOutcome::AuthenticationRequired,
            SyncOutcome::Degraded,
        ] {
            assert_ne!(
                sync_now_message(Some(other)),
                "Sync finished.",
                "{other:?} must not claim success"
            );
        }
        assert_ne!(sync_now_message(None), "Sync finished.");
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

    fn settings_store() -> Store {
        use crate::store::crypto::{DbKey, KEY_LEN};
        Store::open_in_memory(DbKey::from_bytes([4u8; KEY_LEN])).unwrap()
    }

    // All manipulation of the REVEALYST_SHARED_DEVICE/IDENTITY_CONSENT env vars
    // lives in THIS one test so it never races another (cargo runs tests in one
    // process; the Some(..) tests below short-circuit before reading env, so
    // they are safe even if this test has a var set mid-run).
    #[test]
    fn resolve_env_override_applies_only_before_an_answer() {
        // With no saved answer AND no dev env override, attribution stays at the
        // account/device level: never a guessed person, and NOT marked shared.
        std::env::remove_var("REVEALYST_SHARED_DEVICE");
        std::env::remove_var("REVEALYST_IDENTITY_CONSENT");
        let store = settings_store();
        let cfg = CollectConfig::resolve(&store);
        assert!(
            !cfg.consent_identity,
            "no person attribution before an answer"
        );
        assert!(
            !cfg.shared_device,
            "no shared-device claim before an answer"
        );

        // A saved answer is authoritative: a stray dev env flag must not silently
        // flip a person-attributed device to shared.
        std::env::set_var("REVEALYST_SHARED_DEVICE", "1");
        store.set_identity_only_you(Some(true), 1).unwrap();
        let cfg = CollectConfig::resolve(&store);
        assert!(cfg.consent_identity);
        assert!(!cfg.shared_device);
        std::env::remove_var("REVEALYST_SHARED_DEVICE");
    }

    #[test]
    fn resolve_saved_only_you_enables_person_attribution() {
        let store = settings_store();
        store.set_identity_only_you(Some(true), 1).unwrap();
        let cfg = CollectConfig::resolve(&store);
        assert!(cfg.consent_identity);
        assert!(!cfg.shared_device);
    }

    #[test]
    fn resolve_saved_shared_stays_account_level_with_gap() {
        let store = settings_store();
        store.set_identity_only_you(Some(false), 1).unwrap();
        let cfg = CollectConfig::resolve(&store);
        // Shared → account/device level; the shared-device honesty gap fires in
        // the connector because `shared_device` is set.
        assert!(!cfg.consent_identity);
        assert!(cfg.shared_device);
    }

    #[test]
    fn sync_status_restored_carries_only_the_sticky_flag() {
        // A restored SyncStatus keeps the sticky `degraded` signal but leaves the
        // fresh-per-attempt flags clear (they re-derive on the first cycle).
        let restored = SyncStatus::restored(true);
        let inputs = restored.current();
        assert!(inputs.degraded);
        assert!(!inputs.offline);
        assert!(!inputs.authentication_required);
    }
}
