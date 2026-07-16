//! The "Send diagnostics" bundle builder + sender (spec §23.2; Desktop Agent
//! plan T4.3, agent side).
//!
//! A user-triggered (tray "Send diagnostics") explicit action that assembles a
//! COUNTS / VERSIONS / STATES / SANITIZED-LOG bundle from the local store and
//! POSTs it to the merged backend at `POST /api/desktop/diagnostics`
//! (`src/lib/desktop-diagnostics.ts`). It is NOT a background loop — a single
//! click, one POST, no blind retry.
//!
//! # Structural Analytics-Only guarantee (invariant b, spec §23.2 / §29)
//!
//! [`DiagnosticBundle`] has **no field that can carry an activity payload**. The
//! guarantee is STRUCTURAL, not a filter: every field is a count, a version, a
//! closed enum, a timestamp, or an already-scrubbed log line. There is no
//! `events` / `payload` / `prompt` / `response` / `content` field for content to
//! ride in, and `#[serde(deny_unknown_fields)]` at every level rejects one on
//! deserialize. This mirrors the backend's strict zod `diagnosticBundleSchema`
//! (which `.strict()`s and constrains every string to a closed enum or a
//! version/slug regex) field-for-field: `platform`/`architecture`/`update_state`
//! AND `connector_states[].state` are all real Rust enums whose `#[serde(rename)]`
//! literals equal the backend's, so the round-trip contract test
//! (`diagnostic_bundle_round_trips_the_backend_schema_fixture`) proves the shapes
//! agree AND an out-of-enum value is unrepresentable (it can't reach the wire).
//!
//! # Defensive normalization (F1 — an unexpected value must never 400 the bundle)
//!
//! The backend `.strict()` schema 400s the WHOLE bundle on any single invalid
//! field, and the agent can't tell why. So [`build_bundle`] normalizes every
//! open-charset value into the backend's accepted set BEFORE sending:
//!   - a stored connector status outside the §11.2 set maps to `degraded` (a
//!     representable "something's off" bucket), never a raw string;
//!   - a connector `id` that isn't a slug (`^[a-z0-9_-]{1,64}$`) is DROPPED (it
//!     can't be sanitized without inventing an identity);
//!   - the list is capped to [`MAX_CONNECTOR_STATES`] (50) — truncated, not 400'd;
//!   - a `policy_version` that isn't version-shaped falls back to `"0"`.
//!
//! # Log-tail scrub is belt-and-braces, NOT a complete secret filter
//!
//! The one multi-line field, [`DiagnosticBundle::log_tail`], is scrubbed HERE
//! (agent-side, spec §23.1) and re-scrubbed server-side. The scrub drops
//! LABELLED secrets (`key: value`), `rva1.` tokens, bearer/PEM headers, and 40+
//! char encoded runs — it is a best-effort filter in the SAFE direction, not a
//! proof that a surviving line carries no secret (it can miss a short unlabelled
//! secret or a letter-spaced marker). The real guarantee is the structural one:
//! there is no payload field at all, and the agent's own logs wrap secrets in
//! `Redact` at the source ([`crate::logging`]); the scrub + the server re-scrub
//! are defense-in-depth on top of that floor.
//!
//! # What comes from where (counts, never content)
//!
//! - `connector_states` ← [`crate::store::Store::connector_states`] (enum-shaped
//!   status strings the connector writes, normalized as above; never a payload).
//! - `queue_counts.pending` ← [`crate::store::Store::pending_count`];
//!   `queue_counts.quarantined` ← [`crate::store::Store::diagnostic_count`] under
//!   [`crate::privacy::QUARANTINE_KIND`] (spec §16.3: quarantines are COUNTED,
//!   the content is never stored).
//! - `last_successful_sync` ← MAX(`upload_receipts.uploaded_at`)
//!   ([`crate::store::Store::latest_upload_at`]).
//! - `config_version` / `policy_version` ← the signed-config / policy cache rows.
//! - `update_state` ← the `update_state` cache row (T6 updater).
//!
//! The device token is read from the OS keychain ([`crate::secrets`]) only to set
//! the `Authorization: Bearer` header — it never enters the bundle, a log line,
//! or the frontend.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::store::{Store, StoreError};

/// Max sanitized log lines carried, mirroring the backend `MAX_LOG_LINES`. Over
/// this, the server rejects the bundle — so bound it here.
pub const MAX_LOG_LINES: usize = 500;
/// Max characters per log line, mirroring the backend `MAX_LOG_LINE_LENGTH`. A
/// longer line is DROPPED (never truncated — a cut could split a secret across
/// the boundary and defeat the scrub), not sent.
pub const MAX_LOG_LINE_LENGTH: usize = 1000;
/// Max connector states carried, mirroring the backend `MAX_CONNECTOR_STATES`.
/// Over this, the server rejects the whole bundle — so the builder truncates.
pub const MAX_CONNECTOR_STATES: usize = 50;
/// Per-request timeout for the diagnostics POST (spec §23.2; matches the sync
/// engine's 10s ceiling).
pub const REQUEST_TIMEOUT_SECS: u64 = 10;

// ---------------------------------------------------------------------------
// Closed vocabularies (mirror the backend zod enums exactly)
// ---------------------------------------------------------------------------

/// Host platform. The desktop agent ships for macOS + Windows only, so these are
/// the only two the backend accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    #[serde(rename = "macos")]
    Macos,
    #[serde(rename = "windows")]
    Windows,
}

/// Host CPU architecture (the two the backend accepts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Architecture {
    #[serde(rename = "arm64")]
    Arm64,
    #[serde(rename = "x64")]
    X64,
}

/// A connector's operational state (spec §11.2), mirroring the backend
/// `connectorStateSchema` — the closed set the strict schema accepts. A stored
/// status outside this set is normalized (never emitted raw); see
/// [`ConnectorState::from_status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectorState {
    #[serde(rename = "not_detected")]
    NotDetected,
    #[serde(rename = "detected")]
    Detected,
    #[serde(rename = "permission_required")]
    PermissionRequired,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "collecting")]
    Collecting,
    #[serde(rename = "partially_supported")]
    PartiallySupported,
    #[serde(rename = "paused")]
    Paused,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "blocked")]
    Blocked,
    #[serde(rename = "disabled_remotely")]
    DisabledRemotely,
    #[serde(rename = "unsupported_version")]
    UnsupportedVersion,
}

impl ConnectorState {
    /// Map a stored `connector_state.status` string to a backend-accepted
    /// variant. A KNOWN §11.2 literal passes through; an UNKNOWN/unexpected
    /// status (e.g. an agent-level `healthy`/`idle`, or anything a future
    /// connector writes) maps to [`ConnectorState::Degraded`] — a representable
    /// "something's off" bucket — so it can never 400 the whole bundle with a
    /// raw out-of-enum string. Pure + tested.
    pub fn from_status(status: &str) -> Self {
        match status {
            "not_detected" => ConnectorState::NotDetected,
            "detected" => ConnectorState::Detected,
            "permission_required" => ConnectorState::PermissionRequired,
            "ready" => ConnectorState::Ready,
            "collecting" => ConnectorState::Collecting,
            "partially_supported" => ConnectorState::PartiallySupported,
            "paused" => ConnectorState::Paused,
            "degraded" => ConnectorState::Degraded,
            "blocked" => ConnectorState::Blocked,
            "disabled_remotely" => ConnectorState::DisabledRemotely,
            "unsupported_version" => ConnectorState::UnsupportedVersion,
            _ => ConnectorState::Degraded,
        }
    }
}

/// Agent self-update state (spec §13.1 `update_state`), mirroring the backend
/// `updateStateSchema`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateState {
    #[serde(rename = "up_to_date")]
    UpToDate,
    #[serde(rename = "checking")]
    Checking,
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "downloaded")]
    Downloaded,
    #[serde(rename = "pending_restart")]
    PendingRestart,
    #[serde(rename = "error")]
    Error,
}

// ---------------------------------------------------------------------------
// The bundle (mirrors the backend strict `diagnosticBundleSchema`)
// ---------------------------------------------------------------------------

/// One connector's reported state. `id` is a connector SLUG (validated against
/// [`is_valid_connector_slug`] before send) and `state` is the closed
/// [`ConnectorState`] enum — both enum/slug-shaped, never content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectorStateEntry {
    pub id: String,
    pub state: ConnectorState,
}

/// Queue depth counts — non-negative integers only. `uploaded`/`failed` are
/// optional lifetime counters the agent does not track in Phase 1, so they are
/// omitted (never a fabricated 0).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueCounts {
    pub pending: u64,
    pub quarantined: u64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub uploaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub failed: Option<u64>,
}

/// The diagnostic bundle (spec §23.2). Every field is a count, a version, a
/// closed enum, a timestamp, or a sanitized log line — there is deliberately NO
/// field that can carry an activity payload. `#[serde(deny_unknown_fields)]`
/// mirrors the backend `.strict()`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticBundle {
    /// Agent version, from Cargo (`crate::agent_version`).
    pub agent_version: String,
    pub platform: Platform,
    pub architecture: Architecture,
    pub connector_states: Vec<ConnectorStateEntry>,
    pub queue_counts: QueueCounts,
    /// ISO-8601 UTC timestamp of the last successful sync, or `null` if never
    /// synced.
    pub last_successful_sync: Option<String>,
    /// Signed remote-config version (numeric, spec §21).
    pub config_version: u64,
    /// Policy version identifier (spec §17); `"0"` when no policy is cached.
    pub policy_version: String,
    pub update_state: UpdateState,
    /// Already agent-scrubbed log lines (spec §23.1); re-scrubbed server-side.
    pub log_tail: Vec<String>,
}

// ---------------------------------------------------------------------------
// Platform / architecture detection (compile-time OS/ARCH constants)
// ---------------------------------------------------------------------------

/// Map `std::env::consts::OS` to the bundle's [`Platform`]. Only `macos` /
/// `windows` are shipped targets; anything else (never a shipped build) falls to
/// `Windows`. Pure + tested.
pub fn platform_for(os: &str) -> Platform {
    match os {
        "macos" => Platform::Macos,
        _ => Platform::Windows,
    }
}

/// Map `std::env::consts::ARCH` to the bundle's [`Architecture`]. Apple Silicon
/// reports `aarch64`; everything else shipped is 64-bit x86. Pure + tested.
pub fn arch_for(arch: &str) -> Architecture {
    match arch {
        "aarch64" => Architecture::Arm64,
        _ => Architecture::X64,
    }
}

/// `true` if `id` is a connector SLUG the backend accepts (`^[a-z0-9_-]{1,64}$`):
/// 1–64 chars of lowercase letters, digits, `_` or `-`. An id that fails this is
/// dropped from the bundle rather than 400 it. Pure + tested (no regex crate).
pub fn is_valid_connector_slug(id: &str) -> bool {
    let len = id.chars().count();
    (1..=64).contains(&len)
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-'))
}

/// `true` if `version` is version-shaped the backend accepts
/// (`^[A-Za-z0-9.+-]{1,64}$`): 1–64 chars of alphanumerics plus `.`/`+`/`-`. A
/// value that fails this falls back to a safe default rather than 400 the
/// bundle. Pure + tested (no regex crate).
pub fn is_valid_version(version: &str) -> bool {
    let len = version.chars().count();
    (1..=64).contains(&len)
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
}

/// Map a stored `update_state.rollout_state` string to the closed
/// [`UpdateState`] enum. Absent (no updater row yet) or unknown → `UpToDate`
/// ("no pending update recorded"). Pure + tested.
pub fn update_state_for(rollout: Option<&str>) -> UpdateState {
    match rollout {
        Some("checking") => UpdateState::Checking,
        Some("downloading") => UpdateState::Downloading,
        Some("downloaded") => UpdateState::Downloaded,
        Some("pending_restart") => UpdateState::PendingRestart,
        Some("error") => UpdateState::Error,
        // "up_to_date", "none", "", any unknown, or absent → up to date.
        _ => UpdateState::UpToDate,
    }
}

// ---------------------------------------------------------------------------
// Timestamp formatting (epoch ms → RFC-3339 UTC; no chrono dependency)
// ---------------------------------------------------------------------------

/// Civil (year, month, day) from days since the Unix epoch — the inverse of
/// Howard Hinnant's `days_from_civil`. Proleptic Gregorian, no date crate.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Format an epoch-millisecond instant as an ISO-8601 / RFC-3339 UTC string
/// (`YYYY-MM-DDTHH:MM:SS.sssZ`) — the shape zod's `.datetime()` accepts. Pure +
/// tested; used for `last_successful_sync`.
pub fn epoch_ms_to_rfc3339(ms: i64) -> String {
    let day_ms = 86_400_000i64;
    let days = ms.div_euclid(day_ms);
    let ms_of_day = ms.rem_euclid(day_ms);
    let secs = ms_of_day / 1000;
    let millis = ms_of_day % 1000;
    let (y, m, d) = civil_from_days(days);
    let hh = secs / 3600;
    let mm = (secs % 3600) / 60;
    let ss = secs % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{millis:03}Z")
}

// ---------------------------------------------------------------------------
// Log-tail scrub (spec §23.1 agent-side scrub)
// ---------------------------------------------------------------------------

/// Case-insensitive key/value markers whose presence means the line carries a
/// secret or content. A line matching any is DROPPED whole (never partially
/// redacted). Matched as `<keyword>` immediately followed (ignoring spaces) by
/// `:` or `=`, mirroring the backend's `\bkeyword\b\s*[:=]` intent without a
/// regex dependency.
const SECRET_KEY_MARKERS: &[&str] = &[
    "authorization",
    "api key",
    "api_key",
    "api-key",
    "apikey",
    "secret",
    "password",
    "passwd",
    "token",
    "access_token",
    "access-token",
    "refresh_token",
    "refresh-token",
    "client_secret",
    "client-secret",
    "private_key",
    "private-key",
    "session_cookie",
    "session-cookie",
    // Activity-content markers (spec §23.1): even a LABEL for prompt/response
    // content drops the line rather than risk carrying it.
    "prompt",
    "response",
    "completion",
    "message_content",
    "message-content",
    "file_content",
    "file-content",
    "clipboard",
];

/// `true` if `line` carries a secret- or content-shaped token and must be
/// dropped from the log tail (spec §23.1). Conservative: it drops on ANY marker,
/// on an `rva1.`/bearer/PEM signal, or on a long unbroken base64/hex run — the
/// safe direction (a dropped line beats a leaked one). The server re-scrubs on
/// top of this.
fn line_carries_secret(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();

    // Revealyst device token (rva1.<...>) — must never appear.
    if lower.contains("rva1.") {
        return true;
    }
    // Bearer / PEM private-key headers.
    if lower.contains("bearer ") || lower.contains("-----begin") {
        return true;
    }
    // key: / key= markers.
    for marker in SECRET_KEY_MARKERS {
        if let Some(pos) = lower.find(marker) {
            let rest = lower[pos + marker.len()..].trim_start();
            if rest.starts_with(':') || rest.starts_with('=') {
                return true;
            }
        }
    }
    // A long unbroken base64/hex-looking run (>= 40 chars) — the shape of an
    // encoded secret or payload that slipped past the labelled markers.
    if has_long_encoded_run(line, 40) {
        return true;
    }
    false
}

/// `true` if `line` contains an unbroken run of at least `min` base64/hex-url
/// characters (`A-Za-z0-9+/_-`).
fn has_long_encoded_run(line: &str, min: usize) -> bool {
    let mut run = 0usize;
    for ch in line.chars() {
        let is_enc = ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '_' | '-');
        if is_enc {
            run += 1;
            if run >= min {
                return true;
            }
        } else {
            run = 0;
        }
    }
    false
}

/// Scrub a slice of raw log lines for the bundle (spec §23.1): drop any line
/// carrying a secret/content signal, drop any line over [`MAX_LOG_LINE_LENGTH`]
/// (never truncate — a cut could split a secret), and keep at most the LAST
/// [`MAX_LOG_LINES`] survivors (the most recent tail). Pure + tested.
pub fn scrub_log_tail(lines: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = lines
        .iter()
        .filter(|l| l.len() <= MAX_LOG_LINE_LENGTH && !line_carries_secret(l.as_str()))
        .cloned()
        .collect();
    if kept.len() > MAX_LOG_LINES {
        kept = kept.split_off(kept.len() - MAX_LOG_LINES);
    }
    kept
}

/// Read the most recent daily log file in `log_dir` and return its
/// bundle-ready, scrubbed tail (spec §23.1). Absent/unreadable dir → empty tail
/// (diagnostics still send; the operator sees no logs, never a crash).
pub fn read_log_tail(log_dir: &Path) -> Vec<String> {
    let Some(latest) = latest_log_file(log_dir) else {
        return Vec::new();
    };
    let Ok(contents) = std::fs::read_to_string(&latest) else {
        return Vec::new();
    };
    let lines: Vec<String> = contents.lines().map(|l| l.to_string()).collect();
    scrub_log_tail(&lines)
}

/// The path of the most recent `revealyst-agent.log.YYYY-MM-DD` file in
/// `log_dir` (date-sorted names sort lexically), or `None` if there is none.
fn latest_log_file(log_dir: &Path) -> Option<std::path::PathBuf> {
    let prefix = crate::logging::LOG_FILE_PREFIX;
    let mut newest: Option<(String, std::path::PathBuf)> = None;
    for entry in std::fs::read_dir(log_dir).ok()?.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if !name.starts_with(prefix) {
            continue;
        }
        let is_newer = match &newest {
            Some((best, _)) => name > best.as_str(),
            None => true,
        };
        if is_newer {
            newest = Some((name.to_string(), entry.path()));
        }
    }
    newest.map(|(_, path)| path)
}

// ---------------------------------------------------------------------------
// Bundle builder
// ---------------------------------------------------------------------------

/// Assemble a [`DiagnosticBundle`] from the local store's COUNTS / STATES /
/// VERSIONS plus the scrubbed log tail (spec §23.2). PURE-ish: the only inputs
/// are the store (read-only) and the optional log directory; no network, no
/// keychain. The result carries no activity content — structurally (the type has
/// no payload field) and by construction (every value is a count/version/enum/
/// timestamp/scrubbed-line).
pub fn build_bundle(store: &Store, log_dir: Option<&Path>) -> Result<DiagnosticBundle, StoreError> {
    // Normalize every connector state into the backend's accepted set so no
    // single unexpected value 400s the whole bundle (F1): drop ids that aren't
    // slugs, map statuses to the closed enum (unknown → degraded), cap to 50.
    let mut connector_states: Vec<ConnectorStateEntry> = store
        .connector_states()?
        .into_iter()
        .filter(|(id, _)| is_valid_connector_slug(id))
        .map(|(id, status)| ConnectorStateEntry {
            id,
            state: ConnectorState::from_status(&status),
        })
        .collect();
    if connector_states.len() > MAX_CONNECTOR_STATES {
        tracing::warn!(
            component = "diagnostics",
            error_code = "connector_states_capped",
            "more connector states than the bundle cap; truncating"
        );
        connector_states.truncate(MAX_CONNECTOR_STATES);
    }

    let pending = store.pending_count()?.max(0) as u64;
    let quarantined = store
        .diagnostic_count(crate::privacy::QUARANTINE_KIND)?
        .max(0) as u64;

    let last_successful_sync = store.latest_upload_at()?.map(epoch_ms_to_rfc3339);

    // The signed-config version is stored as text (spec §21 numeric); a missing
    // or non-numeric value reads as 0 ("no config cached").
    let config_version = store
        .remote_config_version()?
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);

    // No policy cached (or a stored value that isn't version-shaped) → "0" (a
    // version-shaped placeholder the backend regex accepts), never a fabricated
    // or invalid identifier that would 400 the bundle.
    let policy_version = store
        .policy_version()?
        .filter(|v| is_valid_version(v))
        .unwrap_or_else(|| "0".to_string());

    let update_state = update_state_for(store.update_rollout_state()?.as_deref());

    let log_tail = log_dir.map(read_log_tail).unwrap_or_default();

    Ok(DiagnosticBundle {
        agent_version: crate::agent_version().to_string(),
        platform: platform_for(std::env::consts::OS),
        architecture: arch_for(std::env::consts::ARCH),
        connector_states,
        queue_counts: QueueCounts {
            pending,
            quarantined,
            uploaded: None,
            failed: None,
        },
        last_successful_sync,
        config_version,
        policy_version,
        update_state,
        log_tail,
    })
}

// ---------------------------------------------------------------------------
// Sender (tray "Send diagnostics" — user action, one POST, no blind retry)
// ---------------------------------------------------------------------------

/// The outcome of a diagnostics send, for logging + surfacing in the UI. Never
/// carries a body or a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    /// The server accepted the bundle (200).
    Sent,
    /// The server rejected it (e.g. 400 strict-schema, 413 too large) — do NOT
    /// blindly retry; surface "diagnostics failed" in the UI.
    Rejected(u16),
    /// The server was unreachable (network/timeout).
    Unreachable,
    /// No device token is stored — the user must sign in first.
    NotSignedIn,
    /// A local error building the bundle (store/keychain) — nothing was sent.
    LocalError,
}

impl SendOutcome {
    /// Stable, non-secret log code.
    pub fn code(self) -> String {
        match self {
            SendOutcome::Sent => "sent".to_string(),
            SendOutcome::Rejected(status) => format!("rejected_{status}"),
            SendOutcome::Unreachable => "unreachable".to_string(),
            SendOutcome::NotSignedIn => "not_signed_in".to_string(),
            SendOutcome::LocalError => "local_error".to_string(),
        }
    }
}

/// POST a already-built bundle to `url` with the device token. Kept separate
/// from [`build_bundle`] so the build path stays pure + unit-tested and the
/// network path (compiled, not unit-tested — no network on the dev machine) is
/// this thin function. Sends uncompressed JSON: the diagnostics route reads
/// `req.json()` and does not decode `Content-Encoding` (unlike the ingest pipe),
/// so gzip is deliberately NOT used here.
async fn post_bundle(url: &str, bearer: &str, bundle: &DiagnosticBundle) -> SendOutcome {
    let body = match serde_json::to_vec(bundle) {
        Ok(body) => body,
        Err(_) => return SendOutcome::LocalError,
    };
    let client = reqwest::Client::new();
    let result = client
        .post(url)
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .body(body)
        .send()
        .await;

    match result {
        Ok(response) => {
            let status = response.status().as_u16();
            if (200..300).contains(&status) {
                SendOutcome::Sent
            } else {
                SendOutcome::Rejected(status)
            }
        }
        Err(_) => SendOutcome::Unreachable,
    }
}

/// Build the bundle from the on-disk store + logs and POST it — the end-to-end
/// path the tray "Send diagnostics" item runs. Opens the store on demand (it may
/// not be managed yet in Wave M1/M2), reads the device token from the keychain,
/// and never logs the token or the body. Returns a [`SendOutcome`] the caller
/// surfaces; the response is handled without a blind retry (400/413 → the UI
/// says "diagnostics failed").
pub async fn send_diagnostics(store_path: &Path, log_dir: Option<&Path>) -> SendOutcome {
    // Not signed in → nothing to authorize the POST with.
    let bearer = match crate::secrets::get_token() {
        Ok(Some(token)) => token,
        _ => return SendOutcome::NotSignedIn,
    };

    // Build the bundle in a scope so the SQLite connection is dropped BEFORE
    // the network POST — never hold a DB connection open across a 10s upload.
    let bundle = {
        let store = match Store::open(store_path) {
            Ok(store) => store,
            Err(_) => return SendOutcome::LocalError,
        };
        match build_bundle(&store, log_dir) {
            Ok(bundle) => bundle,
            Err(_) => return SendOutcome::LocalError,
        }
    };

    let url = format!("{}/api/desktop/diagnostics", crate::auth::app_origin());
    let outcome = post_bundle(&url, &bearer, &bundle).await;
    tracing::info!(
        component = "diagnostics",
        result = %outcome.code(),
        "send diagnostics completed"
    );
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::queue::NewEvent;
    use crate::store::Store;
    use serde_json::{json, Value};

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([11u8; KEY_LEN])).unwrap()
    }

    fn event(id: &str) -> NewEvent {
        NewEvent::analytics_only(id, "claude_code", "usage_summary", 1, json!({ "n": 1 }))
    }

    // --- The frozen-schema round-trip (drift guard vs. the backend zod) -----

    /// The checked-in fixture, produced by parsing an example bundle through the
    /// backend's strict `diagnosticBundleSchema` (see
    /// `scripts/generate-desktop-diagnostics-fixture.mjs`) — so it is, by
    /// construction, exactly what the backend accepts and emits.
    const FIXTURE: &str = include_str!("../fixtures/desktop-diagnostics-bundle.json");

    /// Recursively coerce every JSON number to f64 so equality ignores the
    /// int-vs-float distinction serde_json draws (the wire type is a single JS
    /// number).
    fn normalize_numbers(value: Value) -> Value {
        match value {
            Value::Number(n) => Value::from(n.as_f64().expect("finite number")),
            Value::Array(items) => Value::Array(items.into_iter().map(normalize_numbers).collect()),
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .map(|(k, v)| (k, normalize_numbers(v)))
                    .collect(),
            ),
            other => other,
        }
    }

    /// CONTRACT TEST: the hand-mirrored Rust `DiagnosticBundle` round-trips the
    /// backend-schema fixture byte-equivalently. Deserializing (with
    /// `deny_unknown_fields`) proves every field name/shape matches the strict
    /// zod schema; re-serializing and comparing as `serde_json::Value` proves
    /// nothing is dropped, renamed, or added.
    #[test]
    fn diagnostic_bundle_round_trips_the_backend_schema_fixture() {
        let fixture_value: Value = serde_json::from_str(FIXTURE).unwrap();
        let bundle: DiagnosticBundle = serde_json::from_str(FIXTURE).unwrap();
        let reserialized = serde_json::to_value(&bundle).unwrap();
        assert_eq!(
            normalize_numbers(reserialized),
            normalize_numbers(fixture_value),
            "the Rust bundle must serialize to exactly the backend-schema shape"
        );
    }

    // --- Structural no-payload guarantee (invariant b, spec §23.2) ----------

    /// The bundle has EXACTLY the backend's ten top-level keys and NONE of them
    /// is a content-bearing field. The type has no payload field at all — this
    /// test documents the structural floor and guards against a future field
    /// that could carry an event payload.
    #[test]
    fn bundle_has_no_field_that_can_carry_a_payload() {
        let store = store();
        let bundle = build_bundle(&store, None).unwrap();
        let value = serde_json::to_value(&bundle).unwrap();
        let obj = value.as_object().unwrap();

        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "agentVersion",
                "architecture",
                "configVersion",
                "connectorStates",
                "lastSuccessfulSync",
                "logTail",
                "platform",
                "policyVersion",
                "queueCounts",
                "updateState",
            ],
        );

        // No content-bearing key exists anywhere in the serialized bundle.
        for banned in [
            "payload",
            "events",
            "prompt",
            "response",
            "completion",
            "content",
            "transcript",
            "messages",
            "text",
        ] {
            assert!(
                !value_contains_key(&value, banned),
                "the bundle must have no `{banned}` field"
            );
        }
    }

    fn value_contains_key(value: &Value, wanted: &str) -> bool {
        match value {
            Value::Object(map) => {
                map.keys().any(|k| k == wanted)
                    || map.values().any(|v| value_contains_key(v, wanted))
            }
            Value::Array(items) => items.iter().any(|v| value_contains_key(v, wanted)),
            _ => false,
        }
    }

    // --- Store-sourced counts / states / versions ---------------------------

    /// Queue counts are pulled from the store: `pending` from the queue,
    /// `quarantined` from the diagnostics-state count under `QUARANTINE_KIND`.
    #[test]
    fn queue_counts_come_from_the_store() {
        let store = store();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[event("e1"), event("e2"), event("e3")],
                "cp",
            )
            .unwrap();
        // Two quarantine metadata rows (content-free counts, spec §16.3).
        store
            .record_diagnostic(crate::privacy::QUARANTINE_KIND, "prohibited_field", 10)
            .unwrap();
        store
            .record_diagnostic(crate::privacy::QUARANTINE_KIND, "free_text_value", 20)
            .unwrap();
        // A non-quarantine diagnostics row must NOT be counted.
        store.record_diagnostic("other_kind", "x", 30).unwrap();

        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(bundle.queue_counts.pending, 3);
        assert_eq!(bundle.queue_counts.quarantined, 2);
        assert_eq!(bundle.queue_counts.uploaded, None);
        assert_eq!(bundle.queue_counts.failed, None);
    }

    /// Connector states are pulled from `connector_state`, in id order.
    #[test]
    fn connector_states_come_from_the_store() {
        let store = store();
        store
            .set_connector_state("claude_code", "ready", Some(1), None, 1)
            .unwrap();
        store
            .set_connector_state("cursor", "collecting", Some(2), None, 2)
            .unwrap();

        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(
            bundle.connector_states,
            vec![
                ConnectorStateEntry {
                    id: "claude_code".to_string(),
                    state: ConnectorState::Ready,
                },
                ConnectorStateEntry {
                    id: "cursor".to_string(),
                    state: ConnectorState::Collecting,
                },
            ],
        );
    }

    /// F1: a stored connector status OUTSIDE the §11.2 set (here an agent-level
    /// `healthy`) maps to `degraded` — a representable enum value — never a raw
    /// out-of-enum string that would 400 the whole bundle.
    #[test]
    fn unknown_connector_status_maps_to_a_safe_enum_value() {
        let store = store();
        store
            .set_connector_state("claude_code", "healthy", Some(1), None, 1)
            .unwrap();
        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(
            bundle.connector_states,
            vec![ConnectorStateEntry {
                id: "claude_code".to_string(),
                state: ConnectorState::Degraded,
            }],
            "an unexpected status normalizes to degraded, not a raw string"
        );

        // ConnectorState only ever serializes to a backend-accepted literal.
        assert_eq!(
            serde_json::to_value(&bundle.connector_states[0]).unwrap()["state"],
            "degraded"
        );
    }

    /// F1: a connector id that isn't a slug (`^[a-z0-9_-]{1,64}$`) is DROPPED —
    /// it can't be sanitized without inventing an identity, and a raw one would
    /// 400 the bundle.
    #[test]
    fn non_slug_connector_id_is_dropped() {
        let store = store();
        store
            .set_connector_state("Claude Code!", "ready", Some(1), None, 1)
            .unwrap();
        store
            .set_connector_state("cursor", "ready", Some(2), None, 2)
            .unwrap();
        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(
            bundle.connector_states,
            vec![ConnectorStateEntry {
                id: "cursor".to_string(),
                state: ConnectorState::Ready,
            }],
            "only the valid-slug connector survives"
        );
    }

    /// F1: more than the backend cap (50) connector states is TRUNCATED, not
    /// left to 400 the bundle on the 51st entry.
    #[test]
    fn connector_states_are_capped_to_the_backend_max() {
        let store = store();
        for i in 0..(MAX_CONNECTOR_STATES + 10) {
            store
                .set_connector_state(&format!("c-{i:03}"), "ready", Some(1), None, 1)
                .unwrap();
        }
        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(bundle.connector_states.len(), MAX_CONNECTOR_STATES);
    }

    #[test]
    fn slug_and_version_validators_match_the_backend_charsets() {
        assert!(is_valid_connector_slug("claude_code"));
        assert!(is_valid_connector_slug("cursor-2"));
        assert!(!is_valid_connector_slug("")); // empty
        assert!(!is_valid_connector_slug("Cursor")); // uppercase
        assert!(!is_valid_connector_slug("a b")); // space
        assert!(!is_valid_connector_slug("has.dot")); // '.' not allowed in a slug
        assert!(!is_valid_connector_slug(&"x".repeat(65))); // too long

        assert!(is_valid_version("1.4.2"));
        assert!(is_valid_version("1.4.2-beta.1+build7"));
        assert!(is_valid_version("0"));
        assert!(!is_valid_version("")); // empty
        assert!(!is_valid_version("has space"));
        assert!(!is_valid_version("under_score")); // '_' not in the version set
        assert!(!is_valid_version(&"1".repeat(65))); // too long
    }

    /// `last_successful_sync` is the RFC-3339 form of the newest upload receipt;
    /// `None` (→ JSON null) when nothing has ever synced.
    #[test]
    fn last_successful_sync_is_the_newest_receipt_or_null() {
        let store = store();
        let empty = build_bundle(&store, None).unwrap();
        assert_eq!(empty.last_successful_sync, None);

        // 2026-07-16T12:34:56.000Z == 1_784_205_296_000 ms.
        let ms = 1_784_205_296_000i64;
        store
            .record_receipt("b-old", 1, "accepted", ms - 5_000)
            .unwrap();
        store.record_receipt("b-new", 1, "accepted", ms).unwrap();

        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(
            bundle.last_successful_sync.as_deref(),
            Some("2026-07-16T12:34:56.000Z"),
            "the newest receipt time, ISO-8601 UTC"
        );
    }

    /// The signed-config version is read from the cache and parsed to a number;
    /// policy version defaults to "0" and update state to up_to_date when their
    /// cache rows are absent (no writers in Phase 1).
    #[test]
    fn version_and_state_defaults_are_honest() {
        let store = store();
        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(bundle.config_version, 0);
        assert_eq!(bundle.policy_version, "0");
        assert_eq!(bundle.update_state, UpdateState::UpToDate);

        // A cached signed config surfaces its numeric version.
        store
            .write_remote_config_row("{\"a\":1}", "sig", "7", 1, 2, 3)
            .unwrap();
        let bundle = build_bundle(&store, None).unwrap();
        assert_eq!(bundle.config_version, 7);
    }

    // --- Log-tail scrub (spec §23.1) ---------------------------------------

    #[test]
    fn scrub_drops_secret_and_content_lines_keeps_benign() {
        let lines = vec![
            "{\"level\":\"INFO\",\"component\":\"sync\",\"error_code\":\"none\"}".to_string(),
            "Authorization: Bearer rva1.org.conn.super-secret".to_string(),
            "password = hunter2".to_string(),
            "token: abc".to_string(),
            "prompt: write me a poem".to_string(),
            "-----BEGIN PRIVATE KEY-----".to_string(),
            "aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IGJsb2I=".to_string(),
            "just a normal healthy status line".to_string(),
        ];
        let kept = scrub_log_tail(&lines);
        assert_eq!(
            kept,
            vec![
                "{\"level\":\"INFO\",\"component\":\"sync\",\"error_code\":\"none\"}".to_string(),
                "just a normal healthy status line".to_string(),
            ],
            "every secret/content line is dropped; benign lines survive"
        );
    }

    #[test]
    fn scrub_drops_overlong_lines_and_caps_count() {
        let long = "x".repeat(MAX_LOG_LINE_LENGTH + 1);
        let mut lines = vec![long];
        for i in 0..(MAX_LOG_LINES + 50) {
            lines.push(format!("line {i} ok"));
        }
        let kept = scrub_log_tail(&lines);
        assert_eq!(kept.len(), MAX_LOG_LINES, "count is capped to the tail");
        assert!(
            kept.iter().all(|l| l.len() <= MAX_LOG_LINE_LENGTH),
            "no over-length line survives"
        );
        // The tail is kept (the LAST survivors), so the final line is present.
        assert_eq!(
            kept.last().unwrap(),
            &format!("line {} ok", MAX_LOG_LINES + 49)
        );
    }

    /// `build_bundle` reads + scrubs the newest log file when a log dir is given.
    #[test]
    fn build_bundle_reads_and_scrubs_the_log_tail() {
        let dir = std::env::temp_dir().join(format!("revealyst-diag-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("{}.2026-07-16", crate::logging::LOG_FILE_PREFIX));
        std::fs::write(
            &file,
            "healthy line\ntoken: rva1.org.conn.leak\nanother healthy line\n",
        )
        .unwrap();

        let store = store();
        let bundle = build_bundle(&store, Some(&dir)).unwrap();
        assert_eq!(
            bundle.log_tail,
            vec![
                "healthy line".to_string(),
                "another healthy line".to_string()
            ],
            "the secret line is scrubbed out of the tail"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- Pure helpers -------------------------------------------------------

    #[test]
    fn platform_and_arch_map_the_shipped_targets() {
        assert_eq!(platform_for("macos"), Platform::Macos);
        assert_eq!(platform_for("windows"), Platform::Windows);
        assert_eq!(arch_for("aarch64"), Architecture::Arm64);
        assert_eq!(arch_for("x86_64"), Architecture::X64);
    }

    #[test]
    fn update_state_maps_rollout_strings() {
        assert_eq!(update_state_for(None), UpdateState::UpToDate);
        assert_eq!(update_state_for(Some("")), UpdateState::UpToDate);
        assert_eq!(update_state_for(Some("up_to_date")), UpdateState::UpToDate);
        assert_eq!(update_state_for(Some("checking")), UpdateState::Checking);
        assert_eq!(
            update_state_for(Some("downloading")),
            UpdateState::Downloading
        );
        assert_eq!(
            update_state_for(Some("downloaded")),
            UpdateState::Downloaded
        );
        assert_eq!(
            update_state_for(Some("pending_restart")),
            UpdateState::PendingRestart
        );
        assert_eq!(update_state_for(Some("error")), UpdateState::Error);
        assert_eq!(
            update_state_for(Some("weird_future")),
            UpdateState::UpToDate
        );
    }

    #[test]
    fn epoch_ms_formats_iso8601_utc() {
        assert_eq!(epoch_ms_to_rfc3339(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(epoch_ms_to_rfc3339(1000), "1970-01-01T00:00:01.000Z");
        assert_eq!(
            epoch_ms_to_rfc3339(1_784_205_296_000),
            "2026-07-16T12:34:56.000Z"
        );
        // Millisecond precision is preserved.
        assert_eq!(
            epoch_ms_to_rfc3339(1_784_205_296_789),
            "2026-07-16T12:34:56.789Z"
        );
    }

    #[test]
    fn send_outcome_codes_are_stable_and_non_secret() {
        assert_eq!(SendOutcome::Sent.code(), "sent");
        assert_eq!(SendOutcome::Rejected(413).code(), "rejected_413");
        assert_eq!(SendOutcome::Unreachable.code(), "unreachable");
        assert_eq!(SendOutcome::NotSignedIn.code(), "not_signed_in");
        assert_eq!(SendOutcome::LocalError.code(), "local_error");
    }
}
