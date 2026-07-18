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
//! 3. **Enqueue-able?** The positive gate is `allowlist::is_allowed(k) &&
//!    allowlist::is_sent(k)`. A non-allowlisted key is unknown →
//!    [`QuarantineReason::UnknownField`]; an allowlisted-but-`sent:false` key
//!    (an on-device-only extraction input like `timestamp`/`sessionId`) →
//!    [`QuarantineReason::NonSendableField`]. Allowlist membership alone is NOT
//!    enough — only fields the schema marks `sent: true` may leave the device
//!    (invariant-(b): the schema's "never leaves the device" promise is
//!    enforced, not just documented). Allowlist-first (law 3): the single source
//!    of truth is `agent-collection-schema.ts`; a field must be registered
//!    there (and marked sent) FIRST to survive here. A forgotten field
//!    under-collects (safe), never leaks.
//! 4. **Safe scalar value?** The remaining (sent) keys must carry a number, a
//!    boolean, or a bounded, ASCII-printable string — the Analytics-Only payload
//!    is numbers + bounded enums only (spec §12.2). A non-scalar, an over-long
//!    string, a string with control chars, OR a non-ASCII string (zero-width,
//!    bidi overrides, emoji — which `model` could otherwise smuggle from vendor
//!    JSONL) is free-text-shaped → [`QuarantineReason::FreeTextValue`].
//!
//! Any single failing key quarantines the WHOLE event (rather than silently
//! dropping the offending key) — an unexpected key signals an extractor bug or
//! tampering, and the safe response is to reject-and-count so it surfaces, never
//! to ship a partially-scrubbed event. [`project_sendable`] is the structural
//! backstop applied to the validated payload just before enqueue: even a
//! validator bug cannot place a non-sendable key on the wire.

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
/// a safe bounded string ([`is_safe_sent_string`]). Non-scalars (object/array)
/// and JSON `null` are rejected.
pub fn is_scalar_analytics_value(value: &Value) -> bool {
    match value {
        Value::Number(_) | Value::Bool(_) => true,
        Value::String(s) => is_safe_sent_string(s),
        Value::Null | Value::Array(_) | Value::Object(_) => false,
    }
}

/// A bounded, ASCII-printable string safe to send as a metric label. Rejects
/// over-length, ASCII control chars (newlines/tabs/NUL/…), AND all non-ASCII
/// content. The non-ASCII rejection is deliberate: the one attacker-influenceable
/// sent string is `model` (read from vendor JSONL), and `is_control` alone would
/// pass zero-width joiners, bidi overrides, and emoji. Requiring ASCII-printable
/// keeps model ids (`claude-opus-4-…`, `gpt-4o`) while blocking those categories.
fn is_safe_sent_string(s: &str) -> bool {
    s.chars().count() <= MAX_ENUM_LEN && s.is_ascii() && !s.chars().any(|c| c.is_ascii_control())
}

/// Structural backstop (defense-in-depth): keep ONLY keys that may legitimately
/// leave the device — the reserved privacy flags (§12.2 contract) and
/// allowlisted `sent: true` fields. Every other key is dropped. Applied to the
/// already-validated payload just before enqueue, so even a validator bug (or a
/// future refactor that weakens a gate) cannot place a forbidden key on the
/// wire. In the happy path it is the identity (validation already guaranteed
/// every key is sendable); its job is to hold when validation does not.
pub fn project_sendable(map: &Map<String, Value>) -> Map<String, Value> {
    map.iter()
        .filter(|(key, _)| {
            is_reserved_flag(key) || (allowlist::is_allowed(key) && allowlist::is_sent(key))
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
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
        // Membership is not enough: only `sent: true` fields may leave the
        // device. An allowlisted-but-`sent:false` key is an on-device-only
        // extraction input that must never be enqueued (spec §29).
        if !allowlist::is_sent(key) {
            return Err(QuarantineReason::NonSendableField);
        }
        if !is_scalar_analytics_value(value) {
            return Err(QuarantineReason::FreeTextValue);
        }
        // Closed-enum backstop (ADR 0057). A field that declares a closed value
        // set (today only `ai_tool_used`, whose enum is AI_TOOL_IDS, crossed via
        // the generated allowlist artifact) must carry a value IN that set. An
        // in-length-range, control-char-free, ASCII label still quarantines if it
        // is not a known enum member — that shape is exactly how a snippet would
        // try to smuggle through the free-text bound. Non-enum fields are
        // unaffected (`is_allowed_enum_value` returns true for them).
        if allowlist::is_closed_enum_field(key) {
            let in_enum = value
                .as_str()
                .is_some_and(|s| allowlist::is_allowed_enum_value(key, s));
            if !in_enum {
                return Err(QuarantineReason::OutOfEnumValue);
            }
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

    /// A payload built only from `sent: true` fields + the reserved flags
    /// passes. (`model` + token counts are the Phase-1 `sent: true` fields;
    /// on-device-only fields like `isSidechain` are deliberately absent.)
    #[test]
    fn valid_analytics_payload_passes() {
        let payload = json!({
            "model": "claude-opus-4",
            "usage.input_tokens": 1482,
            "usage.output_tokens": 233,
            "rawPromptIncluded": false,
            "rawResponseIncluded": false,
        });
        let clean = validate(&payload, &allow()).expect("valid payload passes");
        assert!(clean.as_map().contains_key("model"));
    }

    /// Invariant-(b): an allowlisted-but-`sent:false` field (an on-device-only
    /// extraction input the schema says "never leaves the device") is rejected —
    /// membership on the allowlist is NOT permission to enqueue for upload.
    #[test]
    fn sent_false_fields_are_rejected() {
        for on_device_only in ["timestamp", "sessionId", "uuid", "isSidechain", "type"] {
            let payload = json!({ on_device_only: 0 });
            assert_eq!(
                validate(&payload, &allow()),
                Err(QuarantineReason::NonSendableField),
                "`{on_device_only}` is sent:false and must not be enqueue-able"
            );
        }
    }

    /// Fix #3: `model` (the one attacker-influenceable sent string, from vendor
    /// JSONL) may not smuggle zero-width, bidi-override, or emoji characters —
    /// `is_control` alone would pass them, so the charset is ASCII-printable.
    #[test]
    fn sent_string_rejects_non_ascii_smuggling() {
        for sneaky in [
            "claude\u{200b}opus", // zero-width space
            "claude\u{202e}opus", // right-to-left override (bidi)
            "claude\u{200d}opus", // zero-width joiner
            "claude\u{1f600}",    // emoji
            "cl\u{feff}aude",     // BOM / zero-width no-break space
        ] {
            assert_eq!(
                validate(&json!({ "model": sneaky }), &allow()),
                Err(QuarantineReason::FreeTextValue),
                "a non-ASCII model string ({sneaky:?}) must be rejected"
            );
        }
        // A normal ASCII model id still passes.
        assert!(validate(&json!({ "model": "claude-opus-4-20250514" }), &allow()).is_ok());
    }

    /// The structural backstop keeps only sendable keys: reserved flags +
    /// allowlisted `sent:true`. On a (hypothetically leaky) map it drops the
    /// rest — defense-in-depth independent of `validate`.
    #[test]
    fn project_sendable_drops_non_sendable_keys() {
        let leaky = json!({
            "model": "m",                 // sent:true → kept
            "usage.input_tokens": 1,      // sent:true → kept
            "rawPromptIncluded": false,   // reserved flag → kept
            "sessionId": "s",             // sent:false → dropped
            "timestamp": 123,             // sent:false → dropped
            "cwd": "/secret",             // not allowlisted → dropped
        });
        let projected = project_sendable(leaky.as_object().unwrap());
        let mut kept: Vec<&str> = projected.keys().map(|k| k.as_str()).collect();
        kept.sort_unstable();
        assert_eq!(
            kept,
            vec!["model", "rawPromptIncluded", "usage.input_tokens"]
        );
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

    /// ADR 0057: a closed-enum field (`ai_tool_used`) accepts ONLY a value in
    /// the closed AI-app enum. A known app id passes; an out-of-set label —
    /// even one that is short, ASCII, and control-char-free (so it clears the
    /// free-text bound) — quarantines as `out_of_enum_value`, never enqueued.
    #[test]
    fn closed_enum_field_accepts_only_known_values() {
        // A valid app id passes (it is allowlisted + sent + in-enum).
        let ok = json!({
            "ai_tool_used": "claude-desktop",
            "rawPromptIncluded": false,
            "rawResponseIncluded": false,
        });
        assert!(
            validate(&ok, &allow()).is_ok(),
            "a known AI app id must pass the closed-enum gate"
        );

        // An out-of-enum label — short, clean ASCII, so the free-text bound does
        // NOT catch it — must quarantine on the closed-enum backstop. This is
        // the smuggled-snippet vector ADR 0057 §closed-enum enforcement names.
        for smuggled in ["some-secret-note", "unknown-app", "claude", "", "hello world!"] {
            let payload = json!({ "ai_tool_used": smuggled });
            assert_eq!(
                validate(&payload, &allow()),
                Err(QuarantineReason::OutOfEnumValue),
                "out-of-enum `ai_tool_used` value ({smuggled:?}) must quarantine"
            );
        }

        // A non-string value on the closed-enum field is likewise rejected (a
        // number can never be a valid app id).
        assert_eq!(
            validate(&json!({ "ai_tool_used": 1 }), &allow()),
            Err(QuarantineReason::OutOfEnumValue)
        );
    }

    /// Belt-and-braces: even a long, content-rich value on the closed-enum field
    /// never survives — the free-text bound catches the length, and the
    /// closed-enum gate catches anything shorter. Nothing content-shaped leaves.
    #[test]
    fn closed_enum_field_never_leaks_rich_content() {
        let rich = "the user asked me to summarize a confidential document about ";
        let payload = json!({ "ai_tool_used": format!("{rich}{}", "x".repeat(200)) });
        // Over the length bound → FreeTextValue (caught before the enum gate).
        assert_eq!(
            validate(&payload, &allow()),
            Err(QuarantineReason::FreeTextValue)
        );
        // A short rich phrase → OutOfEnumValue. Either way it is quarantined and
        // never becomes a CleanPayload key.
        let short = json!({ "ai_tool_used": "summarize this note" });
        assert_eq!(
            validate(&short, &allow()),
            Err(QuarantineReason::OutOfEnumValue)
        );
    }

    /// Numbers (int + float) pass on `sent:true` keys; the reserved flags carry
    /// the only booleans in a valid payload (and must be `false`).
    #[test]
    fn numeric_and_flag_values_pass() {
        let payload = json!({
            "usage.input_tokens": 0,
            "usage.output_tokens": 9_999_999,
            "usage.cache_read_input_tokens": 12.0,
            "rawPromptIncluded": false,
        });
        assert!(validate(&payload, &allow()).is_ok());
    }
}
