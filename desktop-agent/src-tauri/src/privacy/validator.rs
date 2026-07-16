//! The payload validator (spec §16.3; Desktop Agent plan T3.3).
//!
//! Runs at ENQUEUE time, before anything is persisted. Given a candidate event
//! payload it returns either a [`CleanPayload`] (safe to enqueue) or the
//! [`QuarantineReason`] the event was rejected for. The store's
//! `enqueue_and_checkpoint` stays the low-level primitive; this is the gate
//! above it (wired in [`super`]).
//!
//! # The gate order: allowlist first, then value shape
//!
//! For each payload key, in order:
//!
//! 1. **Reserved privacy flag?** `rawPromptIncluded` / `rawResponseIncluded`
//!    (case-insensitive) are the spec §12.2 contradiction sentinels. They are a
//!    required part of the Analytics-Only contract, so they are *expected* keys —
//!    but their value MUST be `false`. Anything else (`true`, a number, a
//!    string) is a privacy contradiction → [`QuarantineReason::ContradictingFlags`]
//!    (spec §16.3 example).
//! 2. **Prohibited field name?** An exact (case-insensitive) match against the
//!    spec §12.2 `ProhibitedAnalyticsOnlyFields` list → a loud
//!    [`QuarantineReason::ProhibitedField`]. (Exact match, not substring:
//!    `responseWordCount` must NOT be flagged by `response`.)
//! 3. **On the allowlist?** The positive gate. If `allowlist::is_allowed` is
//!    `false` the key is unknown → [`QuarantineReason::UnknownField`]. This is
//!    allowlist-first (law 3): the single source of truth is
//!    `agent-collection-schema.ts`; a field must be registered there FIRST to
//!    survive here. A new extractor output field that forgot to register
//!    under-collects (safe), never leaks.
//! 4. **Scalar analytics value?** The remaining (allowlisted) keys must carry a
//!    number, a boolean, or a bounded enum-ish string — the Analytics-Only
//!    payload is numbers + bounded enums only (spec §12.2). A non-scalar, an
//!    over-long string, or a string with newlines/control chars is free-text-
//!    shaped → [`QuarantineReason::FreeTextValue`].
//!
//! Any single failing key quarantines the WHOLE event (rather than silently
//! dropping the offending key) — an unexpected key signals an extractor bug or
//! tampering, and the safe response is to reject-and-count so it surfaces, never
//! to ship a partially-scrubbed event. The store's `project` (allowlist drop)
//! remains the structural backstop beneath this catch-and-count gate.

use serde_json::{Map, Value};

use crate::allowlist;

use super::policy::{ContentMode, PolicyResolution};
use super::quarantine::QuarantineReason;

/// Max length (in Unicode scalar values) of an allowlisted string value. Model
/// ids and bounded enums are short; anything longer is treated as free text.
pub const MAX_ENUM_LEN: usize = 64;

/// The spec §12.2 privacy-flag sentinels. Present in an Analytics-Only payload
/// as required `false` fields; any non-`false` value is a contradiction. Stored
/// lowercased for case-insensitive comparison. These two names are the ONLY
/// hand-written keys here (they are part of the §12.2 payload contract, not a
/// second field allowlist) and are exempt from the unknown-field gate.
const RESERVED_FLAG_KEYS: [&str; 2] = ["rawpromptincluded", "rawresponseincluded"];

/// The spec §12.2 `ProhibitedAnalyticsOnlyFields`, lowercased for
/// case-insensitive exact-name matching.
const PROHIBITED_FIELDS: [&str; 12] = [
    "prompt",
    "response",
    "messages",
    "conversationtext",
    "transcript",
    "filecontent",
    "screenshot",
    "clipboard",
    "cookie",
    "accesstoken",
    "refreshtoken",
    "password",
];

/// A payload that passed every gate — safe to enqueue. Wraps the validated
/// object so a caller cannot enqueue an unvalidated map by mistake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CleanPayload(Map<String, Value>);

impl CleanPayload {
    /// Borrow the validated map.
    pub fn as_map(&self) -> &Map<String, Value> {
        &self.0
    }

    /// Consume into the validated map.
    pub fn into_map(self) -> Map<String, Value> {
        self.0
    }

    /// Consume into a JSON value.
    pub fn into_value(self) -> Value {
        Value::Object(self.0)
    }
}

fn is_reserved_flag(key: &str) -> bool {
    RESERVED_FLAG_KEYS.contains(&key.to_ascii_lowercase().as_str())
}

fn is_prohibited_field(key: &str) -> bool {
    PROHIBITED_FIELDS.contains(&key.to_ascii_lowercase().as_str())
}

/// Whether `value` is a permitted Analytics-Only scalar: a number, a boolean, or
/// a bounded string with no control characters (newlines, tabs, NUL, …).
/// Non-scalars (object/array) and JSON `null` are rejected.
pub fn is_scalar_analytics_value(value: &Value) -> bool {
    match value {
        Value::Number(_) | Value::Bool(_) => true,
        Value::String(s) => s.chars().count() <= MAX_ENUM_LEN && !s.chars().any(|c| c.is_control()),
        Value::Null | Value::Array(_) | Value::Object(_) => false,
    }
}

/// Validate a candidate payload against the resolved policy. `Ok` is safe to
/// enqueue; `Err` is the reason to quarantine + count.
pub fn validate(
    payload: &Value,
    policy: &PolicyResolution,
) -> Result<CleanPayload, QuarantineReason> {
    // The policy must actively permit Analytics-Only collection. A blocked
    // policy (or, defensively, any non-AnalyticsOnly allow the engine can never
    // actually produce) quarantines everything.
    match policy {
        PolicyResolution::Allow(ContentMode::AnalyticsOnly) => {}
        _ => return Err(QuarantineReason::PolicyBlocked),
    }

    // A payload must be a JSON object of feature fields.
    let map = payload.as_object().ok_or(QuarantineReason::FreeTextValue)?;

    for (key, value) in map {
        if is_reserved_flag(key) {
            // Contradiction sentinel: must be exactly `false`.
            if value.as_bool() != Some(false) {
                return Err(QuarantineReason::ContradictingFlags);
            }
            continue;
        }
        if is_prohibited_field(key) {
            return Err(QuarantineReason::ProhibitedField);
        }
        if !allowlist::is_allowed(key) {
            return Err(QuarantineReason::UnknownField);
        }
        if !is_scalar_analytics_value(value) {
            return Err(QuarantineReason::FreeTextValue);
        }
    }

    Ok(CleanPayload(map.clone()))
}

/// Validate a store [`NewEvent`](crate::store::queue::NewEvent): its
/// `content_mode` must be Analytics Only (the only Phase-1 mode) and its payload
/// must pass [`validate`]. This is what the enqueue gate ([`super`]) calls.
pub fn validate_event(
    event: &crate::store::queue::NewEvent,
    policy: &PolicyResolution,
) -> Result<CleanPayload, QuarantineReason> {
    if event.content_mode != crate::store::queue::ANALYTICS_ONLY {
        return Err(QuarantineReason::UnsupportedMode);
    }
    validate(&event.payload, policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allow() -> PolicyResolution {
        PolicyResolution::Allow(ContentMode::AnalyticsOnly)
    }

    /// A payload built only from allowlisted keys with scalar values passes.
    /// (`model` + token counts are the Phase-1 `sent: true` allowlist fields.)
    #[test]
    fn valid_analytics_payload_passes() {
        let payload = json!({
            "model": "claude-opus-4",
            "usage.input_tokens": 1482,
            "usage.output_tokens": 233,
            "isSidechain": false,
            "rawPromptIncluded": false,
            "rawResponseIncluded": false,
        });
        let clean = validate(&payload, &allow()).expect("valid payload passes");
        assert!(clean.as_map().contains_key("model"));
    }

    /// Spec §26.1: Analytics Only rejects a raw prompt field. Every §12.2
    /// prohibited name is quarantined.
    #[test]
    fn prohibited_fields_are_rejected() {
        for name in [
            "prompt",
            "response",
            "messages",
            "conversationText",
            "transcript",
            "fileContent",
            "screenshot",
            "clipboard",
            "cookie",
            "accessToken",
            "refreshToken",
            "password",
        ] {
            let payload = json!({ name: "anything" });
            assert_eq!(
                validate(&payload, &allow()),
                Err(QuarantineReason::ProhibitedField),
                "`{name}` must be quarantined as a prohibited field"
            );
        }
    }

    /// Prohibited-name matching is case-insensitive but EXACT — a legitimate
    /// `responseWordCount`-style key is not a prohibited field (it fails, if at
    /// all, only as an unregistered key, never as `response`).
    #[test]
    fn prohibited_matching_is_case_insensitive_and_exact() {
        assert_eq!(
            validate(&json!({ "PROMPT": "x" }), &allow()),
            Err(QuarantineReason::ProhibitedField)
        );
        // Not the prohibited `response` — it's an unregistered key instead.
        assert_eq!(
            validate(&json!({ "responseWordCount": 10 }), &allow()),
            Err(QuarantineReason::UnknownField)
        );
    }

    /// Spec §26.1: a contradicting-flags event (`rawPromptIncluded = true`) is
    /// quarantined; `rawResponseIncluded = true` likewise.
    #[test]
    fn contradicting_privacy_flags_are_rejected() {
        assert_eq!(
            validate(
                &json!({ "model": "m", "rawPromptIncluded": true }),
                &allow()
            ),
            Err(QuarantineReason::ContradictingFlags)
        );
        assert_eq!(
            validate(
                &json!({ "model": "m", "rawResponseIncluded": true }),
                &allow()
            ),
            Err(QuarantineReason::ContradictingFlags)
        );
        // A non-boolean flag value is also a contradiction.
        assert_eq!(
            validate(&json!({ "rawPromptIncluded": "false" }), &allow()),
            Err(QuarantineReason::ContradictingFlags)
        );
    }

    #[test]
    fn unregistered_key_is_rejected() {
        assert_eq!(
            validate(&json!({ "cwd": "/home/dev/secret" }), &allow()),
            Err(QuarantineReason::UnknownField)
        );
    }

    #[test]
    fn free_text_shaped_values_are_rejected() {
        // Over the length bound.
        let long = "a".repeat(MAX_ENUM_LEN + 1);
        assert_eq!(
            validate(&json!({ "model": long }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        // Newline / control chars.
        assert_eq!(
            validate(&json!({ "model": "line1\nline2" }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        // Non-scalar values.
        assert_eq!(
            validate(&json!({ "model": ["a", "b"] }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        assert_eq!(
            validate(&json!({ "model": { "nested": 1 } }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        assert_eq!(
            validate(&json!({ "model": null }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
    }

    #[test]
    fn a_non_object_payload_is_rejected() {
        assert_eq!(
            validate(&json!("just a string"), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
    }

    /// Spec §26.1: modes other than Analytics Only never activate — a blocked
    /// policy quarantines every event regardless of payload.
    #[test]
    fn blocked_policy_quarantines_everything() {
        use super::super::policy::PolicyBlockReason;
        let blocked = PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);
        assert_eq!(
            validate(&json!({ "model": "m" }), &blocked),
            Err(QuarantineReason::PolicyBlocked)
        );
    }

    #[test]
    fn non_analytics_content_mode_is_rejected() {
        use crate::store::queue::NewEvent;
        let mut event = NewEvent::analytics_only(
            "e1",
            "claude_code",
            "usage_summary",
            1,
            json!({ "model": "m" }),
        );
        event.content_mode = "full_content".to_string();
        assert_eq!(
            validate_event(&event, &allow()),
            Err(QuarantineReason::UnsupportedMode)
        );
    }

    /// Property-style boundary sweep (no proptest dep): a bounded, control-char-
    /// free string on an allowlisted key passes at every length up to the bound;
    /// one char over, or any injected control char, is quarantined.
    #[test]
    fn string_length_and_control_char_boundary() {
        for len in 0..=MAX_ENUM_LEN {
            let payload = json!({ "model": "a".repeat(len) });
            assert!(
                validate(&payload, &allow()).is_ok(),
                "length {len} within bound must pass"
            );
        }
        // One past the bound.
        assert_eq!(
            validate(&json!({ "model": "a".repeat(MAX_ENUM_LEN + 1) }), &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        // A control char anywhere (well under the bound) fails.
        for ctrl in ['\n', '\r', '\t', '\u{0}', '\u{7}'] {
            let payload = json!({ "model": format!("ab{ctrl}cd") });
            assert_eq!(
                validate(&payload, &allow()),
                Err(QuarantineReason::FreeTextValue),
                "a {ctrl:?} control char must be rejected"
            );
        }
    }

    /// Numbers (int + float) and booleans always pass on allowlisted keys.
    #[test]
    fn numeric_and_boolean_values_pass() {
        let payload = json!({
            "usage.input_tokens": 0,
            "usage.output_tokens": 9_999_999,
            "isSidechain": true,
        });
        assert!(validate(&payload, &allow()).is_ok());
    }
}
