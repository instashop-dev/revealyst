//! Signed remote-configuration verify + resolve (Desktop Agent plan T4.2,
//! agent side; spec §17).
//!
//! The backend (`src/lib/desktop-config.ts`) composes a small config object,
//! Ed25519-signs its **canonical** JSON, and serves `{...config, signature}`
//! from `GET /api/desktop/config`. This module is the agent half: it
//! reproduces that canonicalization **byte-for-byte**, verifies the signature
//! against a **baked-in** public key selected by `signingKeyVersion`, and
//! resolves the effective configuration under the spec's safety rules.
//!
//! # The three safety rules (spec §17.2 / §16.2 / §20)
//!
//! 1. **Signature failure → keep the last valid unexpired cached config; if
//!    none, use restrictive built-in defaults.** A tampered or unverifiable
//!    config is never trusted.
//! 2. **Expiry → discard.** An expired config (fetched *or* cached) is not
//!    used; resolution falls through to the next candidate, then to defaults.
//! 3. **Never-broaden (§16.2 / §29).** A validly-signed config can *disable*
//!    collection, but a config whose `defaultContentMode` is broader than the
//!    local `AnalyticsOnly` floor is **refused, never applied** — it surfaces
//!    `policy_blocked` via the same [`crate::privacy::policy`] lattice the rest
//!    of the agent uses. `emergencyShutdown` halts collection; a
//!    `minimumAgentVersion` newer than the running agent yields
//!    `update_required` (which, per the §20 precedence, outranks
//!    `policy_blocked`).
//!
//! # Byte-parity is load-bearing
//!
//! The wire JSON is insertion-order, but the signature covers the SORTED-key
//! canonical form. If this module's [`canonicalize`] disagrees with the backend
//! by a single byte, every verify fails. The golden vector
//! `fixtures/desktop-config-vector.json` (fixed test keypair; `canonicalBytes`
//! = base64 of the exact signed bytes) is the oracle: the
//! `byte_parity_and_signature_verify_against_vector` test proves this port
//! matches the merged backend signer.
//!
//! # Key rotation
//!
//! [`BAKED_PUBLIC_KEYS`] is the set of public keys this build trusts, each
//! tagged with the `signingKeyVersion` label the backend stamps into the
//! (signed) body. At release the production public key is added here; today
//! only the vector's `vtest` key is baked (Phase 1 has no production signing
//! key yet). A config signed under a version this build does not know cannot be
//! verified and falls through to the cache / defaults — the same fail-closed
//! path as a bad signature. Rotation mirrors the backend procedure documented
//! in `src/lib/desktop-config.ts`: ship the new public key here FIRST, then
//! flip the backend private key, then retire the old public key in a later
//! release.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;

use crate::privacy::policy::{
    self, ContentMode, PolicyBlockReason, PolicyInputs, PolicyResolution,
};
use crate::state::AgentState;
use crate::store::{Store, StoreError};

// ---------------------------------------------------------------------------
// Baked public keys (build-time constants)
// ---------------------------------------------------------------------------

/// The vector's test public key (raw 32-byte Ed25519). This is the `vtest`
/// key from `fixtures/desktop-config-vector.json`; a config signed by the
/// matching test private key (which lives only in the repo/test env, never in
/// production) verifies against it. Baking it is harmless: no production config
/// is ever signed under `vtest`.
const VECTOR_TEST_PUBLIC_KEY: [u8; 32] = [
    65, 19, 41, 250, 31, 173, 251, 93, 93, 213, 240, 89, 131, 58, 204, 69, 29, 178, 111, 241, 102,
    60, 78, 45, 70, 27, 78, 4, 201, 122, 102, 188,
];

/// A baked-in Ed25519 public key, selected by the config's `signingKeyVersion`.
pub struct BakedPublicKey {
    /// The `signingKeyVersion` label this key verifies (e.g. `"vtest"`, `"v1"`).
    pub version: &'static str,
    /// Raw 32-byte Ed25519 public key (`exportKey("raw", ...)` on the backend).
    pub key_raw: [u8; 32],
}

/// The public keys this build trusts. The production key is added here at
/// release; today only the vector's `vtest` key is present (Phase 1 has no
/// production signing key yet).
pub const BAKED_PUBLIC_KEYS: &[BakedPublicKey] = &[BakedPublicKey {
    version: "vtest",
    key_raw: VECTOR_TEST_PUBLIC_KEY,
}];

// ---------------------------------------------------------------------------
// Restrictive built-in defaults (used when no valid config exists)
// ---------------------------------------------------------------------------

/// Conservative poll cadence for the built-in defaults — a slow, safe interval
/// used when the agent has never seen a valid config and none is cached.
pub const RESTRICTIVE_POLL_INTERVAL_SECONDS: u64 = 300;

/// The update channel the built-in defaults follow (the general fleet default).
pub const RESTRICTIVE_UPDATE_CHANNEL: &str = "stable";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// A config-parse failure. Every variant maps to a fixed, content-free code —
/// the config is not sensitive, but we keep the log discipline of the rest of
/// the agent (spec §23.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    /// The wire text is not valid JSON.
    Parse,
    /// The JSON is valid but not the expected config object shape.
    Shape,
    /// The signed payload is missing its `signature` string field.
    MissingSignature,
}

impl ConfigError {
    /// Stable, non-sensitive log code.
    pub fn code(&self) -> &'static str {
        match self {
            ConfigError::Parse => "config_parse_failed",
            ConfigError::Shape => "config_shape_invalid",
            ConfigError::MissingSignature => "config_missing_signature",
        }
    }
}

// ---------------------------------------------------------------------------
// Typed config body (semantic view — canonicalization uses the raw Value so an
// unknown future field is still covered by the signature)
// ---------------------------------------------------------------------------

/// Per-connector enablement + cadence (spec §17.2 `connectors` map entry).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConnectorConfig {
    pub enabled: bool,
    pub minimum_version: String,
    pub poll_interval_seconds: u64,
}

/// The Phase-1 connector set. The JSON key is literally `claude_code`, so this
/// struct deliberately does NOT `rename_all` (that would ask for `claudeCode`).
#[derive(Debug, Clone, Deserialize)]
pub struct Connectors {
    pub claude_code: DesktopConnectorConfig,
}

/// The (unsigned) config body — the exact fields the Ed25519 signature covers.
/// Deserialized for its semantic fields; the signature is verified over the raw
/// canonical bytes (see [`SignedConfig`]), never over a re-serialization of
/// this struct, so an unknown field the backend adds later still verifies.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub configuration_version: i64,
    pub issued_at: String,
    pub expires_at: String,
    pub minimum_agent_version: String,
    pub default_content_mode: String,
    pub connectors: Connectors,
    pub update_channel: String,
    pub emergency_shutdown: bool,
    pub signing_key_version: String,
}

// ---------------------------------------------------------------------------
// SignedConfig — a parsed body + its detached signature + the exact bytes the
// signature covers
// ---------------------------------------------------------------------------

/// A parsed signed config: the raw body `Value` (without `signature`), its
/// canonical bytes (what the signature covers), the detached signature, and the
/// typed view. Constructed by [`SignedConfig::parse`] (from the wire form) or
/// [`SignedConfig::from_body_and_signature`] (from cache).
pub struct SignedConfig {
    body: Value,
    signature_b64: String,
    canonical: Vec<u8>,
    config: DesktopConfig,
}

impl SignedConfig {
    /// Parse the served `{...config, signature}` wire form. Strips `signature`,
    /// canonicalizes the remaining body, and extracts the typed view.
    pub fn parse(wire: &str) -> Result<Self, ConfigError> {
        let value: Value = serde_json::from_str(wire).map_err(|_| ConfigError::Parse)?;
        let obj = value.as_object().ok_or(ConfigError::Shape)?;
        let signature_b64 = obj
            .get("signature")
            .and_then(Value::as_str)
            .ok_or(ConfigError::MissingSignature)?
            .to_string();
        let mut body = obj.clone();
        body.remove("signature");
        Self::from_body_and_signature(Value::Object(body), &signature_b64)
    }

    /// Reconstruct from a stored body (`Value`, WITHOUT `signature`) plus its
    /// detached base64 signature — the cache-read path.
    pub fn from_body_and_signature(body: Value, signature_b64: &str) -> Result<Self, ConfigError> {
        if !body.is_object() {
            return Err(ConfigError::Shape);
        }
        let config: DesktopConfig =
            serde_json::from_value(body.clone()).map_err(|_| ConfigError::Shape)?;
        let canonical = canonicalize(&body).into_bytes();
        Ok(SignedConfig {
            body,
            signature_b64: signature_b64.to_string(),
            canonical,
            config,
        })
    }

    /// The exact bytes the signature covers (the canonical JSON, UTF-8).
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical
    }

    /// The detached base64 signature.
    pub fn signature_b64(&self) -> &str {
        &self.signature_b64
    }

    /// The body serialized back to JSON (for caching). Order is not significant
    /// — [`canonicalize`] re-normalizes it on the next read.
    pub fn body_json(&self) -> String {
        self.body.to_string()
    }

    /// The typed config view.
    pub fn config(&self) -> &DesktopConfig {
        &self.config
    }

    /// Verify the signature against one explicit raw 32-byte public key. Used by
    /// the byte-parity test (with the vector's own key) and by [`verify`].
    ///
    /// [`verify`]: SignedConfig::verify
    pub fn verify_with(&self, public_key_raw: &[u8; 32]) -> bool {
        let Ok(key) = VerifyingKey::from_bytes(public_key_raw) else {
            return false;
        };
        let Ok(sig_bytes) = STANDARD.decode(&self.signature_b64) else {
            return false;
        };
        let sig_arr: [u8; 64] = match sig_bytes.try_into() {
            Ok(arr) => arr,
            Err(_) => return false,
        };
        // `verify_strict` rejects non-canonical / small-order edge cases in
        // addition to a wrong signature — the recommended API for a
        // security-sensitive verify. Backend signatures (WebCrypto Ed25519,
        // RFC 8032 pure EdDSA over a normal key) are canonical and pass.
        let sig = Signature::from_bytes(&sig_arr);
        key.verify_strict(&self.canonical, &sig).is_ok()
    }

    /// Verify against the baked key whose version matches the config's
    /// `signingKeyVersion`. An unknown version cannot be verified → `false`
    /// (fail-closed, same as a bad signature).
    pub fn verify(&self, keys: &[BakedPublicKey]) -> bool {
        keys.iter()
            .filter(|k| k.version == self.config.signing_key_version)
            .any(|k| self.verify_with(&k.key_raw))
    }

    /// Whether `expiresAt` is at or before `now_ms`. An unparseable `expiresAt`
    /// is treated as expired (fail-closed — discard rather than trust).
    pub fn is_expired(&self, now_ms: i64) -> bool {
        match iso_ms(&self.config.expires_at) {
            Some(expiry) => now_ms >= expiry,
            None => true,
        }
    }
}

// ---------------------------------------------------------------------------
// Canonicalization — a byte-exact port of `canonicalize` in
// src/lib/desktop-config.ts
// ---------------------------------------------------------------------------

/// Deterministic JSON serialization matching the backend exactly:
///   - object keys sorted ascending (all keys are ASCII, so byte order equals
///     the backend's UTF-16 code-unit order),
///   - no insignificant whitespace,
///   - arrays kept in their given order,
///   - standard JSON string/number escaping,
///   - UTF-8 bytes.
///
/// The wire JSON never contains `undefined`; `null` is kept and rendered as
/// `null`, mirroring the backend's `v !== undefined` filter.
fn canonicalize(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        // Config numbers are all small non-negative integers; serde_json's
        // integer `Display` matches `JSON.stringify` for them. (There are no
        // floats in the config shape, where formatting could otherwise differ.)
        Value::Number(n) => n.to_string(),
        // Quoted + escaped exactly like `JSON.stringify` for the ASCII strings
        // in the config (timestamps, semvers, enum-like slugs).
        Value::String(_) => serde_json::to_string(value).unwrap_or_default(),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonicalize).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            // Collect through a BTreeMap so key order is deterministic (ascending
            // by byte value = the backend's UTF-16 code-unit order for ASCII
            // keys) regardless of whether serde_json was compiled with
            // `preserve_order` via feature unification.
            let sorted: std::collections::BTreeMap<&String, &Value> = map.iter().collect();
            let parts: Vec<String> = sorted
                .into_iter()
                .map(|(k, v)| {
                    let key = serde_json::to_string(k).unwrap_or_default();
                    format!("{key}:{}", canonicalize(v))
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

// ---------------------------------------------------------------------------
// Small pure helpers (no date/semver crate — keeps the dep surface minimal)
// ---------------------------------------------------------------------------

/// Parse an ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SS[.sss]Z`, the backend's
/// `Date#toISOString` shape) to epoch milliseconds. Returns `None` on any
/// malformed input or a non-`Z` (non-UTC) suffix.
fn iso_ms(s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;

    let mut d = date.split('-');
    let year: i64 = d.next()?.parse().ok()?;
    let month: i64 = d.next()?.parse().ok()?;
    let day: i64 = d.next()?.parse().ok()?;
    if d.next().is_some() {
        return None;
    }

    let (hms, millis) = match time.split_once('.') {
        Some((hms, frac)) => {
            if frac.is_empty() || !frac.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            // Take up to 3 fractional digits (ms precision), zero-padded.
            let digits = frac.as_bytes();
            let mut ms_str = String::with_capacity(3);
            for i in 0..3 {
                let c = if i < digits.len() {
                    digits[i] as char
                } else {
                    '0'
                };
                ms_str.push(c);
            }
            (hms, ms_str.parse::<i64>().ok()?)
        }
        None => (time, 0),
    };

    let mut t = hms.split(':');
    let hour: i64 = t.next()?.parse().ok()?;
    let min: i64 = t.next()?.parse().ok()?;
    let sec: i64 = t.next()?.parse().ok()?;
    if t.next().is_some() {
        return None;
    }

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || min > 59 || sec > 60 {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let secs = days * 86_400 + hour * 3_600 + min * 60 + sec;
    Some(secs * 1_000 + millis)
}

/// Days since the Unix epoch for a proleptic-Gregorian date (Howard Hinnant's
/// `days_from_civil`). Pure integer arithmetic — no date crate needed.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m + 9) % 12; // Mar = 0 .. Feb = 11
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Parse a strict `MAJOR.MINOR.PATCH` triple (the backend's `SEMVER_RE` shape).
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

/// Whether `a` is strictly older than `b`. An unparseable version on either
/// side is treated as "not older" — a validly-signed config never carries a
/// malformed floor, and we never force an update on a version we cannot read.
fn version_lt(a: &str, b: &str) -> bool {
    match (parse_semver(a), parse_semver(b)) {
        (Some(x), Some(y)) => x < y,
        _ => false,
    }
}

/// Map a `defaultContentMode` string to the privacy lattice's [`ContentMode`].
fn parse_content_mode(s: &str) -> Option<ContentMode> {
    match s {
        "analytics_only" => Some(ContentMode::AnalyticsOnly),
        "redacted_summary" => Some(ContentMode::RedactedSummary),
        "full_content" => Some(ContentMode::FullContent),
        _ => None,
    }
}

/// Run the config's `defaultContentMode` through the never-broaden lattice
/// (spec §16.2) as an org-policy proposal. Returns the block reason if the mode
/// is broader than the local `AnalyticsOnly` floor (or unrecognized → fail
/// closed as a broaden attempt), or `None` when it is safe to apply.
fn never_broaden_check(mode: &str) -> Option<PolicyBlockReason> {
    match parse_content_mode(mode) {
        Some(m) => match policy::resolve(&PolicyInputs {
            org_policy: m,
            ..PolicyInputs::default()
        }) {
            PolicyResolution::Blocked(reason) => Some(reason),
            PolicyResolution::Allow(_) => None,
        },
        None => Some(PolicyBlockReason::BroadenAttempt),
    }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// Where the effective config came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigSource {
    /// A freshly fetched, verified, unexpired config.
    Fetched,
    /// The last valid unexpired config from the local cache.
    Cached,
    /// Restrictive built-ins (no valid config anywhere).
    BuiltInDefaults,
}

/// The applied configuration. The content mode is ALWAYS `AnalyticsOnly` here —
/// a broader config never reaches this type ([`ConfigResolution::Blocked`]),
/// so `EffectiveConfig` cannot represent a broadened policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveConfig {
    pub configuration_version: i64,
    pub content_mode: ContentMode,
    pub emergency_shutdown: bool,
    pub claude_code_enabled: bool,
    pub poll_interval_seconds: u64,
    pub update_channel: String,
    pub minimum_agent_version: String,
    pub source: ConfigSource,
    /// `expiresAt` as epoch ms, when known.
    pub expires_at_ms: Option<i64>,
}

impl EffectiveConfig {
    /// The restrictive built-in defaults: Analytics Only, a conservative poll
    /// cadence, and the current agent version as the (self-satisfied) floor.
    fn restrictive_defaults() -> Self {
        EffectiveConfig {
            configuration_version: 0,
            content_mode: ContentMode::AnalyticsOnly,
            emergency_shutdown: false,
            claude_code_enabled: true,
            poll_interval_seconds: RESTRICTIVE_POLL_INTERVAL_SECONDS,
            update_channel: RESTRICTIVE_UPDATE_CHANNEL.to_string(),
            minimum_agent_version: crate::agent_version().to_string(),
            source: ConfigSource::BuiltInDefaults,
            expires_at_ms: None,
        }
    }

    /// Build the applied view from a chosen signed config. The mode is pinned to
    /// `AnalyticsOnly` (never-broaden already passed).
    fn from_signed(signed: &SignedConfig, source: ConfigSource) -> Self {
        let c = &signed.config;
        EffectiveConfig {
            configuration_version: c.configuration_version,
            content_mode: ContentMode::AnalyticsOnly,
            emergency_shutdown: c.emergency_shutdown,
            claude_code_enabled: c.connectors.claude_code.enabled,
            poll_interval_seconds: c.connectors.claude_code.poll_interval_seconds,
            update_channel: c.update_channel.clone(),
            minimum_agent_version: c.minimum_agent_version.clone(),
            source,
            expires_at_ms: iso_ms(&c.expires_at),
        }
    }

    /// Whether collection is halted — the emergency kill switch (spec §17.1).
    /// The connector loop must not collect while this is true.
    pub fn collection_halted(&self) -> bool {
        self.emergency_shutdown
    }
}

/// The outcome of resolving the effective config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigResolution {
    /// A config (or the built-in defaults) applies.
    Effective(EffectiveConfig),
    /// A validly-signed config tried to broaden collection — refused, never
    /// applied (spec §16.2). Maps to `policy_blocked`.
    Blocked(PolicyBlockReason),
    /// The applicable config requires a newer agent (spec §20). Maps to
    /// `update_required`.
    UpdateRequired,
}

impl ConfigResolution {
    /// The spec §20 agent-state string this resolution forces, if any.
    /// `Effective` forces none (the wider connection-state model decides).
    pub fn agent_state(&self) -> Option<&'static str> {
        match self {
            ConfigResolution::UpdateRequired => Some(AgentState::UpdateRequired.as_str()),
            ConfigResolution::Blocked(_) => Some(AgentState::PolicyBlocked.as_str()),
            ConfigResolution::Effective(_) => None,
        }
    }
}

/// Resolve the effective config from a freshly fetched config, the cached
/// config, the current time, the running agent version, and the trusted baked
/// keys. **Pure** — no network, no store, no clock.
///
/// Decision table (first matching row wins):
///
/// | fetched            | cached             | then                                   |
/// |--------------------|--------------------|----------------------------------------|
/// | valid + unexpired  | —                  | consider fetched (rows below)          |
/// | invalid/expired    | valid + unexpired  | consider cached (rows below)           |
/// | invalid/expired    | invalid/expired/—  | `Effective(restrictive_defaults)`      |
///
/// Once a config is chosen, in order:
/// 1. agent older than its `minimumAgentVersion` → `UpdateRequired`
///    (outranks broaden, per the §20 precedence);
/// 2. `defaultContentMode` broader than the floor → `Blocked(BroadenAttempt)`;
/// 3. otherwise → `Effective` (honoring `emergencyShutdown`).
pub fn resolve_effective_config(
    fetched: Option<&SignedConfig>,
    cached: Option<&SignedConfig>,
    now_ms: i64,
    agent_version: &str,
    keys: &[BakedPublicKey],
) -> ConfigResolution {
    let chosen = fetched
        .filter(|c| c.verify(keys) && !c.is_expired(now_ms))
        .map(|c| (c, ConfigSource::Fetched))
        .or_else(|| {
            cached
                .filter(|c| c.verify(keys) && !c.is_expired(now_ms))
                .map(|c| (c, ConfigSource::Cached))
        });

    let (config, source) = match chosen {
        Some(pair) => pair,
        None => return ConfigResolution::Effective(EffectiveConfig::restrictive_defaults()),
    };

    if version_lt(agent_version, &config.config.minimum_agent_version) {
        return ConfigResolution::UpdateRequired;
    }
    if let Some(reason) = never_broaden_check(&config.config.default_content_mode) {
        return ConfigResolution::Blocked(reason);
    }
    ConfigResolution::Effective(EffectiveConfig::from_signed(config, source))
}

/// Convenience over [`resolve_effective_config`] using the [`BAKED_PUBLIC_KEYS`]
/// this build trusts.
pub fn resolve_effective_config_baked(
    fetched: Option<&SignedConfig>,
    cached: Option<&SignedConfig>,
    now_ms: i64,
    agent_version: &str,
) -> ConfigResolution {
    resolve_effective_config(fetched, cached, now_ms, agent_version, BAKED_PUBLIC_KEYS)
}

// ---------------------------------------------------------------------------
// Store-backed wrapper (thin — the pure resolver above holds all the logic)
// ---------------------------------------------------------------------------

/// Read the last cached signed config from the store, if any.
pub fn load_cached_config(store: &Store) -> Result<Option<SignedConfig>, StoreError> {
    let Some(row) = store.read_remote_config_row()? else {
        return Ok(None);
    };
    let body: Value = serde_json::from_str(&row.config_json).map_err(|_| StoreError::Encode)?;
    let signed = SignedConfig::from_body_and_signature(body, &row.signature)
        .map_err(|_| StoreError::Encode)?;
    Ok(Some(signed))
}

/// Whether a fetched config is safe to cache for later fallback: it verifies,
/// is unexpired, and does not broaden. (An `update_required` config is still
/// cached — it becomes applicable once the agent updates.)
fn is_cacheable(signed: &SignedConfig, now_ms: i64, keys: &[BakedPublicKey]) -> bool {
    signed.verify(keys)
        && !signed.is_expired(now_ms)
        && never_broaden_check(&signed.config.default_content_mode).is_none()
}

/// Persist a signed config to the cache (single-row upsert).
fn persist_config(store: &Store, signed: &SignedConfig, now_ms: i64) -> Result<(), StoreError> {
    let issued = iso_ms(&signed.config.issued_at).unwrap_or(now_ms);
    let expires = iso_ms(&signed.config.expires_at).unwrap_or(now_ms);
    store.write_remote_config_row(
        &signed.body_json(),
        signed.signature_b64(),
        &signed.config.configuration_version.to_string(),
        issued,
        expires,
        now_ms,
    )
}

/// Store-backed resolution: read the cached config, cache the fetched config
/// when it is safe to fall back to later, and resolve against the baked keys.
/// This is the thin wrapper the collection loop (T5.1's `run`) calls; all the
/// decision logic lives in [`resolve_effective_config`].
pub fn resolve_with_store(
    store: &Store,
    fetched: Option<&SignedConfig>,
    now_ms: i64,
    agent_version: &str,
) -> Result<ConfigResolution, StoreError> {
    let cached = load_cached_config(store)?;
    if let Some(f) = fetched {
        if is_cacheable(f, now_ms, BAKED_PUBLIC_KEYS) {
            persist_config(store, f, now_ms)?;
        }
    }
    Ok(resolve_effective_config(
        fetched,
        cached.as_ref(),
        now_ms,
        agent_version,
        BAKED_PUBLIC_KEYS,
    ))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::crypto::{DbKey, KEY_LEN};
    use ed25519_dalek::{Signer, SigningKey};

    const VECTOR_JSON: &str = include_str!("../fixtures/desktop-config-vector.json");

    #[derive(Deserialize)]
    struct Vector {
        config: Value,
        #[serde(rename = "canonicalBytes")]
        canonical_bytes: String,
        #[serde(rename = "publicKeyRaw")]
        public_key_raw: String,
        signature: String,
    }

    fn vector() -> Vector {
        serde_json::from_str(VECTOR_JSON).unwrap()
    }

    fn vector_signed() -> SignedConfig {
        let v = vector();
        SignedConfig::from_body_and_signature(v.config, &v.signature).unwrap()
    }

    // A local test keypair (deterministic, no RNG) + its baked-key table, for
    // signing arbitrary test bodies (the vector's `vtest` PRIVATE key is not in
    // the repo, so variant configs must be self-signed).
    fn test_keys() -> (SigningKey, Vec<BakedPublicKey>) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let keys = vec![BakedPublicKey {
            version: "vtestlocal",
            key_raw: sk.verifying_key().to_bytes(),
        }];
        (sk, keys)
    }

    fn sign_body(sk: &SigningKey, body: Value) -> SignedConfig {
        let canonical = canonicalize(&body);
        let sig = sk.sign(canonical.as_bytes());
        let sig_b64 = STANDARD.encode(sig.to_bytes());
        SignedConfig::from_body_and_signature(body, &sig_b64).unwrap()
    }

    fn base_body() -> Value {
        serde_json::from_str(
            r#"{
              "configurationVersion": 3,
              "issuedAt": "2026-01-01T00:00:00.000Z",
              "expiresAt": "2026-01-08T00:00:00.000Z",
              "minimumAgentVersion": "0.1.0",
              "defaultContentMode": "analytics_only",
              "connectors": {
                "claude_code": {
                  "enabled": true,
                  "minimumVersion": "1.0.0",
                  "pollIntervalSeconds": 60
                }
              },
              "updateChannel": "beta",
              "emergencyShutdown": false,
              "signingKeyVersion": "vtestlocal"
            }"#,
        )
        .unwrap()
    }

    /// Set one top-level field on a base body clone.
    fn body_with(key: &str, value: Value) -> Value {
        let mut obj = base_body().as_object().unwrap().clone();
        obj.insert(key.to_string(), value);
        Value::Object(obj)
    }

    fn now_in_window() -> i64 {
        iso_ms("2026-01-05T00:00:00.000Z").unwrap()
    }

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([5u8; KEY_LEN])).unwrap()
    }

    // ---- the load-bearing oracle -----------------------------------------

    /// Byte-parity: this port's canonicalization equals the backend's
    /// `canonicalBytes`, AND the vector signature verifies against the vector's
    /// public key. Proves the Rust verify matches the merged backend signer.
    #[test]
    fn byte_parity_and_signature_verify_against_vector() {
        let v = vector();
        let expected = STANDARD.decode(&v.canonical_bytes).unwrap();
        let pk_bytes = STANDARD.decode(&v.public_key_raw).unwrap();
        let pk: [u8; 32] = pk_bytes.try_into().unwrap();

        // Via from_body_and_signature.
        let signed = SignedConfig::from_body_and_signature(v.config.clone(), &v.signature).unwrap();
        assert_eq!(
            signed.canonical_bytes(),
            expected.as_slice(),
            "canonicalization must match the backend byte-for-byte"
        );
        assert!(signed.verify_with(&pk), "vector signature must verify");

        // Via parse() from the full {...config, signature} wire form.
        let mut wire = v.config.as_object().unwrap().clone();
        wire.insert("signature".into(), Value::String(v.signature.clone()));
        let wire_str = Value::Object(wire).to_string();
        let parsed = SignedConfig::parse(&wire_str).unwrap();
        assert_eq!(parsed.canonical_bytes(), expected.as_slice());
        assert!(parsed.verify_with(&pk));
    }

    /// The baked `vtest` key IS the vector's public key, so the baked-key path
    /// verifies the vector config end-to-end.
    #[test]
    fn baked_vtest_key_verifies_vector() {
        let signed = vector_signed();
        assert!(signed.verify(BAKED_PUBLIC_KEYS));
        // A new-enough agent (vector floor is 1.2.3) applies it, source Fetched.
        let r = resolve_effective_config_baked(Some(&signed), None, now_in_window(), "9.9.9");
        match r {
            ConfigResolution::Effective(e) => assert_eq!(e.source, ConfigSource::Fetched),
            other => panic!("expected Effective(Fetched), got {other:?}"),
        }
    }

    // ---- canonicalization + helpers --------------------------------------

    #[test]
    fn iso_ms_epoch_window_and_rejections() {
        assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        let a = iso_ms("2026-01-01T00:00:00.000Z").unwrap();
        let b = iso_ms("2026-01-08T00:00:00.000Z").unwrap();
        assert_eq!(b - a, 7 * 24 * 60 * 60 * 1000);
        // The no-milliseconds form parses identically.
        assert_eq!(iso_ms("2026-01-01T00:00:00Z"), Some(a));
        // Non-UTC / malformed inputs are rejected.
        assert_eq!(iso_ms("2026-01-01T00:00:00"), None);
        assert_eq!(iso_ms("not-a-date"), None);
        assert_eq!(iso_ms("2026-13-01T00:00:00.000Z"), None);
    }

    #[test]
    fn version_ordering() {
        assert!(version_lt("0.1.0", "1.2.3"));
        assert!(version_lt("1.2.2", "1.2.3"));
        assert!(!version_lt("1.2.3", "1.2.3"));
        assert!(!version_lt("2.0.0", "1.9.9"));
        // Unparseable → not older (never force an update on a garbage floor).
        assert!(!version_lt("x", "1.0.0"));
        assert!(!version_lt("1.0.0", "y"));
    }

    // ---- resolve semantics (spec §17.2 / §26.1) --------------------------

    #[test]
    fn tampered_signature_falls_back_to_cached() {
        let (sk, keys) = test_keys();
        let cached = sign_body(&sk, base_body());
        // A fetched config with a different version but a WRONG signature.
        let mut fetched = sign_body(&sk, body_with("configurationVersion", Value::from(99)));
        fetched.signature_b64 = STANDARD.encode([0u8; 64]); // valid length, wrong sig

        let r = resolve_effective_config(
            Some(&fetched),
            Some(&cached),
            now_in_window(),
            "9.9.9",
            &keys,
        );
        match r {
            ConfigResolution::Effective(e) => {
                assert_eq!(e.source, ConfigSource::Cached);
                assert_eq!(e.configuration_version, 3);
            }
            other => panic!("expected cached fallback, got {other:?}"),
        }
    }

    #[test]
    fn no_valid_and_no_cache_uses_restrictive_builtins() {
        let (_, keys) = test_keys();
        let r = resolve_effective_config(None, None, now_in_window(), "0.1.0", &keys);
        match r {
            ConfigResolution::Effective(e) => {
                assert_eq!(e.source, ConfigSource::BuiltInDefaults);
                assert_eq!(e.content_mode, ContentMode::AnalyticsOnly);
                assert_eq!(e.poll_interval_seconds, RESTRICTIVE_POLL_INTERVAL_SECONDS);
                assert!(!e.collection_halted());
            }
            other => panic!("expected restrictive defaults, got {other:?}"),
        }
    }

    #[test]
    fn expired_config_is_discarded() {
        let (sk, keys) = test_keys();
        let fetched = sign_body(&sk, base_body()); // expiresAt 2026-01-08
        let after_expiry = iso_ms("2026-02-01T00:00:00.000Z").unwrap();

        // Expired fetched, no cache → restrictive defaults.
        let r = resolve_effective_config(Some(&fetched), None, after_expiry, "9.9.9", &keys);
        assert!(matches!(
            r,
            ConfigResolution::Effective(EffectiveConfig {
                source: ConfigSource::BuiltInDefaults,
                ..
            })
        ));

        // Expired fetched, unexpired cached → cached.
        let cached = sign_body(
            &sk,
            body_with("expiresAt", Value::from("2026-12-31T00:00:00.000Z")),
        );
        let r2 =
            resolve_effective_config(Some(&fetched), Some(&cached), after_expiry, "9.9.9", &keys);
        assert!(matches!(
            r2,
            ConfigResolution::Effective(EffectiveConfig {
                source: ConfigSource::Cached,
                ..
            })
        ));
    }

    /// Spec §26.1: remote config cannot silently broaden policy. A validly
    /// signed `full_content` config → `policy_blocked`, never applied — even
    /// with a valid analytics-only config cached.
    #[test]
    fn broaden_attempt_is_blocked_and_never_applied() {
        let (sk, keys) = test_keys();
        let cached = sign_body(&sk, base_body());
        let fetched = sign_body(
            &sk,
            body_with("defaultContentMode", Value::from("full_content")),
        );

        let r = resolve_effective_config(
            Some(&fetched),
            Some(&cached),
            now_in_window(),
            "9.9.9",
            &keys,
        );
        assert_eq!(
            r,
            ConfigResolution::Blocked(PolicyBlockReason::BroadenAttempt)
        );
        assert_eq!(r.agent_state(), Some("policy_blocked"));
        // It never resolves to an applied config in that mode.
        assert!(!matches!(r, ConfigResolution::Effective(_)));

        // An unrecognized mode is also fail-closed as a broaden attempt.
        let weird = sign_body(
            &sk,
            body_with("defaultContentMode", Value::from("surveil_everything")),
        );
        assert_eq!(
            resolve_effective_config(Some(&weird), None, now_in_window(), "9.9.9", &keys),
            ConfigResolution::Blocked(PolicyBlockReason::BroadenAttempt)
        );
    }

    #[test]
    fn minimum_agent_version_forces_update_required() {
        let (sk, keys) = test_keys();
        let fetched = sign_body(&sk, body_with("minimumAgentVersion", Value::from("2.0.0")));

        let old = resolve_effective_config(Some(&fetched), None, now_in_window(), "1.5.0", &keys);
        assert_eq!(old, ConfigResolution::UpdateRequired);
        assert_eq!(old.agent_state(), Some("update_required"));

        // A new-enough agent applies it.
        let ok = resolve_effective_config(Some(&fetched), None, now_in_window(), "2.0.0", &keys);
        assert!(matches!(ok, ConfigResolution::Effective(_)));
    }

    /// Spec §20 precedence: `update_required` outranks `policy_blocked`. A
    /// config that both broadens AND needs a newer agent resolves to
    /// `UpdateRequired` (collection is halted either way; the mode is never
    /// applied).
    #[test]
    fn update_required_outranks_broaden() {
        let (sk, keys) = test_keys();
        let mut obj = base_body().as_object().unwrap().clone();
        obj.insert("defaultContentMode".into(), Value::from("full_content"));
        obj.insert("minimumAgentVersion".into(), Value::from("2.0.0"));
        let fetched = sign_body(&sk, Value::Object(obj));

        let r = resolve_effective_config(Some(&fetched), None, now_in_window(), "1.0.0", &keys);
        assert_eq!(r, ConfigResolution::UpdateRequired);
    }

    #[test]
    fn emergency_shutdown_is_honored() {
        let (sk, keys) = test_keys();
        let fetched = sign_body(&sk, body_with("emergencyShutdown", Value::from(true)));

        let r = resolve_effective_config(Some(&fetched), None, now_in_window(), "9.9.9", &keys);
        match r {
            ConfigResolution::Effective(e) => {
                assert!(e.emergency_shutdown);
                assert!(e.collection_halted());
                // Still Analytics Only — halting is orthogonal to the mode.
                assert_eq!(e.content_mode, ContentMode::AnalyticsOnly);
            }
            other => panic!("expected Effective with shutdown, got {other:?}"),
        }
    }

    // ---- store-backed wrapper --------------------------------------------

    #[test]
    fn resolve_with_store_caches_fetched_and_falls_back() {
        let store = store();
        let signed = vector_signed();
        let now = now_in_window();

        // First pass: fetched applies AND is cached.
        let r1 = resolve_with_store(&store, Some(&signed), now, "9.9.9").unwrap();
        assert!(matches!(
            r1,
            ConfigResolution::Effective(EffectiveConfig {
                source: ConfigSource::Fetched,
                ..
            })
        ));

        // Second pass with NO fetch: falls back to the cached vector.
        let r2 = resolve_with_store(&store, None, now, "9.9.9").unwrap();
        assert!(matches!(
            r2,
            ConfigResolution::Effective(EffectiveConfig {
                source: ConfigSource::Cached,
                ..
            })
        ));
    }

    #[test]
    fn resolve_with_store_does_not_cache_a_broadening_config() {
        let store = store();
        let (sk, _) = test_keys();
        // A broadening config signed by a NON-baked key: it won't verify under
        // BAKED_PUBLIC_KEYS, so it must not be cached and must not apply.
        let broad = sign_body(
            &sk,
            body_with("defaultContentMode", Value::from("full_content")),
        );
        let now = now_in_window();

        let r = resolve_with_store(&store, Some(&broad), now, "9.9.9").unwrap();
        // Not baked-verifiable → treated as no valid config → defaults.
        assert!(matches!(
            r,
            ConfigResolution::Effective(EffectiveConfig {
                source: ConfigSource::BuiltInDefaults,
                ..
            })
        ));
        // Nothing was cached.
        assert!(load_cached_config(&store).unwrap().is_none());
    }

    #[test]
    fn load_cached_config_roundtrips_a_signed_config() {
        let store = store();
        let signed = vector_signed();
        persist_config(&store, &signed, now_in_window()).unwrap();

        let loaded = load_cached_config(&store).unwrap().unwrap();
        assert_eq!(loaded.canonical_bytes(), signed.canonical_bytes());
        assert!(loaded.verify(BAKED_PUBLIC_KEYS));
    }

    #[test]
    fn config_error_codes_are_present_and_distinct() {
        assert_ne!(ConfigError::Parse.code(), ConfigError::Shape.code());
        assert!(!ConfigError::MissingSignature.code().is_empty());
        assert!(SignedConfig::parse("not json").is_err());
        assert_eq!(
            SignedConfig::parse("{\"configurationVersion\":1}").unwrap_err(),
            ConfigError::MissingSignature
        );
    }
}
