//! Signed auto-update (Desktop Agent plan T6.1, spec §18).
//!
//! The agent uses the official `tauri-plugin-updater`: on startup and every six
//! hours it asks our dynamic endpoint
//! (`GET /api/desktop/updates/{{target}}/{{arch}}/<channel>/{{current_version}}`)
//! for a newer release, downloads it in the background, and — crucially —
//! VERIFIES the downloaded artifact's minisign signature against the public key
//! baked in at build time (`tauri.conf.json` `plugins.updater.pubkey`) before
//! installing. Spec §29: signed updates only, no remote script loading; the
//! pubkey is baked, the artifact is signature-verified, nothing executable is
//! fetched unverified.
//!
//! # What is pure (and unit-tested here) vs. what the plugin owns
//!
//! The plugin owns the network fetch, the minisign verification, and the OS
//! install step — none of which is unit-testable without a signing key and a
//! real installer (that is the T6.2 release-pipeline + hardening job). This
//! module keeps the DECISION logic pure and tested:
//!   - [`update_cohort`] / [`is_in_rollout`] mirror the backend's staged-rollout
//!     bucketing BYTE-FOR-BYTE (same FNV-1a as `src/lib/experiments.ts` →
//!     `src/lib/desktop-releases.ts`), so the agent can reason about its own
//!     cohort offline and a cross-language test vector pins the two together;
//!   - [`build_update_endpoint`] composes the channel-specific endpoint URL
//!     (leaving Tauri's `{{target}}`/`{{arch}}`/`{{current_version}}`
//!     placeholders for the plugin to fill);
//!   - [`mandatory_from_raw_json`] + [`update_required`] turn a discovered
//!     update into the §20 `update_required` decision that BLOCKS sync — but
//!     only for a mandatory (security/privacy/protocol-critical) release.
//!
//! # Queue + checkpoints survive an update
//!
//! The encrypted queue and connector checkpoints live in the OS app-DATA dir
//! (`store::DB_FILE_NAME` under `app_data_dir`), which the installer never
//! touches — the updater replaces the app BINARY (in the app install dir), not
//! the per-user data dir. So an update preserves every unsynced event and every
//! checkpoint by construction; the sync loop resumes against the same queue on
//! the next launch. The only update-time invariant we add is that a MANDATORY
//! update halts NEW collection until the update installs (via
//! [`crate::runtime::CollectionControl`]), so we never keep collecting on a
//! version flagged unsafe — the already-queued events stay put and upload after.

use serde_json::Value;

/// The six-hour re-check cadence (spec §18.3). Startup fires one immediate
/// check; the loop then re-checks on this interval.
pub const UPDATE_CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

/// Header the agent sends so the backend can bucket it into a staged-rollout
/// cohort. Must match the backend route's `INSTALLATION_ID_HEADER`.
pub const INSTALLATION_ID_HEADER: &str = "x-revealyst-installation-id";

/// The default update channel when no signed config has resolved one — the
/// general fleet default (matches the backend + `config::RESTRICTIVE_UPDATE_CHANNEL`).
pub const DEFAULT_UPDATE_CHANNEL: &str = "stable";

// ---------------------------------------------------------------------------
// Deterministic cohort — a byte-for-byte mirror of the backend FNV-1a
// (`hash32` in src/lib/experiments.ts, used by src/lib/desktop-releases.ts).
// ---------------------------------------------------------------------------

/// 32-bit FNV-1a over the UTF-8 bytes of `s`. Identical to the backend's
/// `hash32` for ASCII inputs (installation ids are UUIDs, release ids are ASCII
/// slugs), where a JS `charCodeAt` UTF-16 unit equals the UTF-8 byte. NOT a
/// general-purpose hash for non-ASCII text — the cross-language contract only
/// holds for the ASCII id space it is used on.
pub fn fnv1a_32(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// The deterministic cohort bucket `[0, 99]` for a caller against a release —
/// `fnv1a_32(installation_id + ":" + release_id) % 100`. Mirrors the backend's
/// `updateCohort`.
pub fn update_cohort(installation_id: &str, release_id: &str) -> u32 {
    fnv1a_32(&format!("{installation_id}:{release_id}")) % 100
}

/// Whether this installation is inside a release's staged rollout — the same
/// fail-closed rule as the backend `isInRollout`: 0% none, 100% everyone,
/// otherwise the cohort must be strictly below the percentage. The backend is
/// authoritative (it runs this gate before serving a manifest); the agent
/// mirror lets it reason about its own cohort offline and is what the
/// cross-language vector test pins.
pub fn is_in_rollout(installation_id: &str, release_id: &str, rollout_pct: u32) -> bool {
    if rollout_pct == 0 {
        return false;
    }
    if rollout_pct >= 100 {
        return true;
    }
    update_cohort(installation_id, release_id) < rollout_pct
}

// ---------------------------------------------------------------------------
// Endpoint URL + channel resolution (pure)
// ---------------------------------------------------------------------------

/// Compose the channel-specific updater endpoint. Tauri substitutes
/// `{{target}}`, `{{arch}}`, and `{{current_version}}` at check time, so those
/// placeholders are left literal; only the channel segment is filled here.
/// `origin` is the app origin (e.g. `https://app.revealyst.com`).
pub fn build_update_endpoint(origin: &str, channel: &str) -> String {
    let origin = origin.trim_end_matches('/');
    format!("{origin}/api/desktop/updates/{{{{target}}}}/{{{{arch}}}}/{channel}/{{{{current_version}}}}")
}

// ---------------------------------------------------------------------------
// Mandatory-update → update_required decision (pure, spec §18.3 + §20)
// ---------------------------------------------------------------------------

/// Read the backend's extra `mandatory` flag off a discovered update's raw JSON
/// (`Update::raw_json`). Absent or non-boolean → `false` (a release is only
/// mandatory when the backend explicitly says so — fail SAFE toward
/// non-mandatory, never accidentally block sync).
pub fn mandatory_from_raw_json(raw: &Value) -> bool {
    raw.get("mandatory")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Parse a strict `MAJOR.MINOR.PATCH` triple.
fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// Whether `a` is strictly newer than `b`. An unparseable version on either
/// side is treated as "not newer" (never force an update on a version we can't
/// read).
fn version_gt(a: &str, b: &str) -> bool {
    match (parse_semver(a), parse_semver(b)) {
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

/// A discovered update, reduced to what the `update_required` decision needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableUpdate {
    /// The announced version (`Update::version`).
    pub version: String,
    /// The backend's mandatory flag (see [`mandatory_from_raw_json`]).
    pub mandatory: bool,
}

impl AvailableUpdate {
    /// Build from a plugin `Update`'s announced version + raw JSON.
    pub fn from_parts(version: &str, raw_json: &Value) -> Self {
        AvailableUpdate {
            version: version.to_string(),
            mandatory: mandatory_from_raw_json(raw_json),
        }
    }
}

/// Whether the agent must enter `update_required` (spec §20) and BLOCK sync:
/// true only when a mandatory update is available AND strictly newer than the
/// running version. A non-mandatory update downloads/installs in the background
/// without ever blocking collection.
pub fn update_required(current_version: &str, available: Option<&AvailableUpdate>) -> bool {
    match available {
        Some(u) => u.mandatory && version_gt(&u.version, current_version),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Plugin wiring (network + install — owned by the plugin, gated off tests)
// ---------------------------------------------------------------------------

// The functions below drive the real `tauri-plugin-updater`. They compile in
// every build but are only CALLED from `crate::run` (never in tests), so no
// test opens a network connection or touches the installer. Signature
// verification of the downloaded artifact is the plugin's job (baked pubkey);
// we only decide the endpoint, carry the installation id, and react to
// `mandatory`.

mod wiring {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    use tauri::{AppHandle, Manager, Runtime};
    use tauri_plugin_updater::UpdaterExt;

    use crate::runtime::CollectionControl;
    use crate::store::Store;

    /// Resolve the effective update channel from the cached signed config
    /// (no network — a fetch is the sync loop's job), falling back to the fleet
    /// default. Reuses the config resolver so the channel can never disagree
    /// with the signed config the rest of the agent honors.
    fn current_channel(store: &Store) -> String {
        let cached = crate::config::load_cached_config(store).ok().flatten();
        match crate::config::resolve_effective_config_baked(
            None,
            cached.as_ref(),
            crate::store::queue::now_ms(),
            crate::agent_version(),
        ) {
            crate::config::ConfigResolution::Effective(e) => e.update_channel,
            // A blocked/update-required config doesn't yield a channel — use the
            // safe default; the check is harmless (a 204 or a valid manifest).
            _ => DEFAULT_UPDATE_CHANNEL.to_string(),
        }
    }

    /// Run one update check: build the channel endpoint, attach the installation
    /// id header, ask the plugin to check, and — if an update is offered — set
    /// the mandatory-block flag and download+install in the background. All
    /// failures are logged with a fixed, content-free code and never panic.
    async fn check_once<R: Runtime>(
        app: &AppHandle<R>,
        store: &Store,
        control: &CollectionControl,
    ) {
        let channel = current_channel(store);
        let origin = crate::auth::app_origin();
        let endpoint = build_update_endpoint(&origin, &channel);

        let installation_id = app
            .path()
            .app_config_dir()
            .ok()
            .and_then(|dir| crate::auth::load_or_create_installation_id(&dir).ok())
            .unwrap_or_default();

        let url = match url::Url::parse(&endpoint) {
            Ok(u) => u,
            Err(_) => {
                tracing::warn!(
                    component = "update",
                    error_code = "endpoint_parse_failed",
                    "could not build the update endpoint"
                );
                return;
            }
        };

        let builder = app.updater_builder();
        let builder = match builder.endpoints(vec![url]) {
            Ok(b) => b,
            Err(_) => {
                tracing::warn!(
                    component = "update",
                    error_code = "endpoints_rejected",
                    "updater rejected the endpoint"
                );
                return;
            }
        };
        let builder = match builder.header(INSTALLATION_ID_HEADER, installation_id.as_str()) {
            Ok(b) => b,
            Err(_) => {
                tracing::warn!(
                    component = "update",
                    error_code = "header_rejected",
                    "updater rejected the installation-id header"
                );
                return;
            }
        };
        let updater = match builder.build() {
            Ok(u) => u,
            Err(_) => {
                tracing::warn!(
                    component = "update",
                    error_code = "updater_build_failed",
                    "could not build the updater"
                );
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let available = AvailableUpdate::from_parts(&update.version, &update.raw_json);
                // Set the block to the COMPUTED value unconditionally — a
                // superseding NON-mandatory release must CLEAR a stale block
                // left by an earlier mandatory update whose install failed (user
                // declined UAC / interrupted) and was then halted. Only a
                // still-present newer mandatory update keeps it set.
                let blocking = update_required(crate::agent_version(), Some(&available));
                control.set_update_required(blocking);
                if blocking {
                    tracing::warn!(
                        component = "update",
                        result = "mandatory",
                        "a mandatory update is available; sync is blocked until it installs"
                    );
                } else {
                    tracing::info!(
                        component = "update",
                        result = "available",
                        "an update is available; downloading in the background"
                    );
                }
                // Verify-and-install is the plugin's job (baked pubkey). The
                // callbacks are intentionally empty — progress UI is a later
                // hardening surface.
                if let Err(_error) = update
                    .download_and_install(|_chunk, _total| {}, || {})
                    .await
                {
                    tracing::warn!(
                        component = "update",
                        error_code = "download_or_install_failed",
                        "update download/verify/install failed"
                    );
                }
            }
            Ok(None) => {
                // No update / outside cohort (204) — clear any stale block so a
                // pulled (halted) mandatory release stops blocking sync.
                control.set_update_required(false);
                tracing::debug!(component = "update", result = "up_to_date", "no update");
            }
            Err(_error) => tracing::warn!(
                component = "update",
                error_code = "check_failed",
                "update check failed"
            ),
        }
    }

    /// Spawn the startup + six-hourly update loop. Fires one immediate check,
    /// then re-checks every [`UPDATE_CHECK_INTERVAL_SECS`]. Started only from
    /// [`crate::run`], so it never fires in tests.
    pub fn spawn_loop<R: Runtime>(
        app: AppHandle<R>,
        store: Arc<Store>,
        control: Arc<CollectionControl>,
    ) {
        tauri::async_runtime::spawn(async move {
            let interval = Duration::from_secs(UPDATE_CHECK_INTERVAL_SECS);
            tracing::info!(
                component = "update",
                interval_secs = UPDATE_CHECK_INTERVAL_SECS,
                "update loop started (startup check + 6-hourly)"
            );
            loop {
                check_once(&app, &store, &control).await;
                tokio::time::sleep(interval).await;
            }
        });
    }
}

pub use wiring::spawn_loop;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cohort_matches_backend_vectors() {
        // These EXACT values are asserted by the backend test
        // `updateCohort matches the shared cross-language vectors` — if either
        // side changes the hash, one suite goes red.
        assert_eq!(
            update_cohort(
                "11111111-2222-3333-4444-555555555555",
                "desktop-v0.2.0-stable"
            ),
            78
        );
        assert_eq!(update_cohort("device-a", "rel-1"), 34);
        assert_eq!(update_cohort("device-b", "rel-1"), 31);
        assert_eq!(update_cohort("", "desktop-v0.2.0-stable"), 22);
    }

    #[test]
    fn cohort_is_deterministic_and_in_range() {
        for k in 0..1000 {
            let id = format!("inst-{k}");
            let a = update_cohort(&id, "rel-x");
            let b = update_cohort(&id, "rel-x");
            assert_eq!(a, b);
            assert!(a < 100);
        }
    }

    #[test]
    fn cohort_distribution_is_roughly_uniform() {
        let mut buckets = [0u32; 100];
        let n = 100_000;
        for k in 0..n {
            let id = format!("inst-{k}");
            buckets[update_cohort(&id, "rel-x") as usize] += 1;
        }
        let min = *buckets.iter().min().unwrap();
        let max = *buckets.iter().max().unwrap();
        assert!(min > 700, "coldest bucket {min} too cold");
        assert!(max < 1300, "hottest bucket {max} too hot");
    }

    #[test]
    fn rollout_gate_matches_cohort() {
        // 0% none, 100% everyone.
        assert!(!is_in_rollout("device-a", "rel-1", 0));
        assert!(is_in_rollout("device-a", "rel-1", 100));
        // device-a/rel-1 → cohort 34: excluded AT 34, included ABOVE.
        assert!(!is_in_rollout("device-a", "rel-1", 34));
        assert!(is_in_rollout("device-a", "rel-1", 35));
        // Every decision agrees with `cohort < pct`.
        for k in 0..500 {
            let id = format!("roll-{k}");
            assert_eq!(
                is_in_rollout(&id, "rel-x", 25),
                update_cohort(&id, "rel-x") < 25
            );
        }
    }

    #[test]
    fn endpoint_leaves_tauri_placeholders_and_fills_channel() {
        let url = build_update_endpoint("https://app.revealyst.com", "beta");
        assert_eq!(
            url,
            "https://app.revealyst.com/api/desktop/updates/{{target}}/{{arch}}/beta/{{current_version}}"
        );
        // A trailing slash on the origin is normalized (no double slash).
        let url2 = build_update_endpoint("https://app.revealyst.com/", "stable");
        assert!(
            url2.contains("/api/desktop/updates/{{target}}/{{arch}}/stable/{{current_version}}")
        );
        assert!(!url2.contains("com//api"));
    }

    #[test]
    fn mandatory_flag_is_read_from_raw_json() {
        assert!(mandatory_from_raw_json(&json!({ "mandatory": true })));
        assert!(!mandatory_from_raw_json(&json!({ "mandatory": false })));
        // Absent or wrong type → false (fail safe toward non-mandatory).
        assert!(!mandatory_from_raw_json(&json!({ "version": "1.0.0" })));
        assert!(!mandatory_from_raw_json(&json!({ "mandatory": "yes" })));
    }

    #[test]
    fn update_required_only_for_a_newer_mandatory_release() {
        // Mandatory + newer → blocks.
        let mand_new = AvailableUpdate {
            version: "0.2.0".into(),
            mandatory: true,
        };
        assert!(update_required("0.1.0", Some(&mand_new)));
        // Mandatory but NOT newer → does not block (already current/ahead).
        let mand_same = AvailableUpdate {
            version: "0.1.0".into(),
            mandatory: true,
        };
        assert!(!update_required("0.1.0", Some(&mand_same)));
        // Newer but NOT mandatory → does not block (installs in background).
        let opt_new = AvailableUpdate {
            version: "0.2.0".into(),
            mandatory: false,
        };
        assert!(!update_required("0.1.0", Some(&opt_new)));
        // No update → never blocks.
        assert!(!update_required("0.1.0", None));
    }

    /// The availability fix (F1): the block flag is the COMPUTED value of the
    /// currently-offered release, so a superseding NON-mandatory release clears
    /// a stale block left by an earlier mandatory update. This is the exact
    /// value `check_once` now stores unconditionally in the `Ok(Some(_))` arm.
    #[test]
    fn a_non_mandatory_release_clears_a_prior_mandatory_block() {
        // R1: mandatory + newer → the block would be set.
        let r1 = AvailableUpdate {
            version: "0.2.0".into(),
            mandatory: true,
        };
        let blocked_after_r1 = update_required("0.1.0", Some(&r1));
        assert!(blocked_after_r1, "a newer mandatory release blocks");

        // R1's install failed and ops halted it; the next check now returns a
        // NON-mandatory R2. The computed flag for R2 is false → the block clears
        // (no more mandatory update pending), so sync is not stuck forever.
        let r2 = AvailableUpdate {
            version: "0.3.0".into(),
            mandatory: false,
        };
        let blocked_after_r2 = update_required("0.1.0", Some(&r2));
        assert!(
            !blocked_after_r2,
            "a superseding non-mandatory release clears the block"
        );

        // And an Ok(None) check (no offer at all) also computes to false.
        assert!(!update_required("0.1.0", None));
    }

    #[test]
    fn from_parts_reads_version_and_mandatory() {
        let u = AvailableUpdate::from_parts("1.2.3", &json!({ "mandatory": true }));
        assert_eq!(u.version, "1.2.3");
        assert!(u.mandatory);
    }
}
