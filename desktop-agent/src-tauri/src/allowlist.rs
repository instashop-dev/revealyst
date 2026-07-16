//! Collection allowlist bridge (Desktop Agent plan T3.1; law 3).
//!
//! The single source of truth for "what leaves the device" is
//! `src/lib/agent-collection-schema.ts` in the repo root. This crate never
//! imports TypeScript (law 5) — instead the checked-in artifact
//! `generated/allowlist.json` (emitted by
//! `scripts/generate-agent-allowlist-json.mjs`, drift-tested byte-for-byte
//! by the root suite) is embedded at compile time here.
//!
//! Everything collection-shaped in Rust must reference fields THROUGH this
//! module: `is_allowed` for membership, [`project`] to strip a record down
//! to allowlisted keys. It is an allowlist, never a blocklist — a key this
//! module has never heard of is dropped, not passed through.

use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{Map, Value};

/// The generated artifact, embedded at compile time. Regenerate with
/// `npm run generate:desktop-allowlist` at the repo root after any change
/// to `src/lib/agent-collection-schema.ts`.
const ALLOWLIST_JSON: &str = include_str!("../generated/allowlist.json");

/// One allowlisted field, mirroring the TS `CollectionField` shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistField {
    /// Stable field name (e.g. `sessionId`, `usage.input_tokens`).
    pub field: String,
    /// Human label for the "what leaves the device" screen.
    pub label: String,
    /// Plain-English purpose copy — rendered verbatim, never rewritten.
    pub purpose: String,
    /// `true` = the field's VALUE leaves the device (only the model id and
    /// token numbers). `false` = read on-device only and reduced to
    /// counts/buckets before any push.
    pub sent: bool,
    /// The CLI parser token proving the field is genuinely read
    /// (informational here; enforced by the CLI package's own tests).
    pub source_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllowlistDoc {
    fields: Vec<AllowlistField>,
    never_collected: Vec<String>,
}

fn doc() -> &'static AllowlistDoc {
    static DOC: OnceLock<AllowlistDoc> = OnceLock::new();
    DOC.get_or_init(|| {
        let doc: AllowlistDoc = serde_json::from_str(ALLOWLIST_JSON)
            .expect("generated/allowlist.json must parse — regenerate via npm run generate:desktop-allowlist");
        assert!(
            !doc.fields.is_empty(),
            "generated/allowlist.json has no fields — the artifact is corrupt"
        );
        doc
    })
}

/// Every allowlisted field, in the artifact's (sorted, deterministic) order.
pub fn fields() -> &'static [AllowlistField] {
    &doc().fields
}

/// The names of every allowlisted field.
pub fn allowed_field_names() -> impl Iterator<Item = &'static str> {
    fields().iter().map(|f| f.field.as_str())
}

/// Is `field` on the collection allowlist? Exact-name match — there is no
/// pattern or prefix logic, so a new field is invisible here until it is
/// added to `src/lib/agent-collection-schema.ts` FIRST and regenerated
/// (law 3: allowlist-first claims discipline).
pub fn is_allowed(field: &str) -> bool {
    fields().iter().any(|f| f.field == field)
}

/// Does `field`'s VALUE leave the device? Reads the schema's `sent` flag.
///
/// Membership on the allowlist (`is_allowed`) is NOT the same as being
/// enqueue-able for upload: many allowlisted fields (`timestamp`, `sessionId`,
/// `uuid`, `requestId`, `type`, `isSidechain`, …) are `sent: false` — read
/// on-device to compute features, then reduced to counts, and **never**
/// transmitted (the schema's own "never leaves the device" promise). The
/// payload validator uses this to keep those extraction INPUTS off the wire:
/// an enqueue-able key must be `is_allowed(k) && is_sent(k)`. Exact-name match,
/// same as `is_allowed`.
pub fn is_sent(field: &str) -> bool {
    fields().iter().any(|f| f.field == field && f.sent)
}

/// The plain-English "never collected" list for the trust surface.
pub fn never_collected() -> &'static [String] {
    &doc().never_collected
}

/// Project a record down to its allowlisted keys: every key not on the
/// allowlist is DROPPED. Unknown fields never survive by default — the
/// failure mode of forgetting to register a field is under-collection,
/// never leakage.
pub fn project(map: &Map<String, Value>) -> Map<String, Value> {
    map.iter()
        .filter(|(key, _)| is_allowed(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn artifact_parses_and_is_non_empty() {
        // Anti-vacuity: the embedded JSON is real — both groupings present,
        // and the trust-surface denylist is non-empty.
        assert!(!fields().is_empty());
        assert!(fields().iter().any(|f| f.sent));
        assert!(fields().iter().any(|f| !f.sent));
        assert!(!never_collected().is_empty());
        // The artifact is sorted (determinism the drift test relies on).
        let names: Vec<&str> = allowed_field_names().collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted, "fields must be sorted by name");
    }

    #[test]
    fn known_allowlisted_fields_pass() {
        assert!(is_allowed("sessionId"));
        assert!(is_allowed("model"));
        assert!(is_allowed("usage.input_tokens"));
    }

    #[test]
    fn is_sent_reflects_the_schema_sent_flag() {
        // `sent: true` fields — their VALUE leaves the device.
        assert!(is_sent("model"));
        assert!(is_sent("usage.input_tokens"));
        assert!(is_sent("usage.output_tokens"));
        // Allowlisted but `sent: false` — read on-device only, never enqueued.
        for on_device_only in [
            "timestamp",
            "sessionId",
            "uuid",
            "requestId",
            "type",
            "isSidechain",
            "content_block_type",
            "toolUseResult",
        ] {
            assert!(
                is_allowed(on_device_only),
                "{on_device_only} should be allowlisted"
            );
            assert!(
                !is_sent(on_device_only),
                "{on_device_only} is sent:false — must NOT be enqueue-able"
            );
        }
        // Unknown fields are never sent.
        assert!(!is_sent("promptText"));
        assert!(!is_sent(""));
    }

    #[test]
    fn non_allowlisted_fields_are_rejected() {
        assert!(!is_allowed("promptText"));
        assert!(!is_allowed("cwd"));
        assert!(!is_allowed("gitBranch"));
        // Near-misses never match: exact names only.
        assert!(!is_allowed("session"));
        assert!(!is_allowed("usage"));
        assert!(!is_allowed("SESSIONID"));
        assert!(!is_allowed(""));
    }

    #[test]
    fn project_drops_every_non_allowlisted_key() {
        let record = json!({
            "sessionId": "abc",
            "model": "claude-x",
            "promptText": "NEVER",
            "cwd": "/home/dev/secret",
            "usage.input_tokens": 12,
        });
        let projected = project(record.as_object().expect("object literal"));
        assert_eq!(projected.len(), 3);
        assert!(projected.contains_key("sessionId"));
        assert!(projected.contains_key("model"));
        assert!(projected.contains_key("usage.input_tokens"));
        assert!(!projected.contains_key("promptText"));
        assert!(!projected.contains_key("cwd"));
    }

    #[test]
    fn project_of_fully_unknown_record_is_empty() {
        let record = json!({ "anything": 1, "at": 2, "all": 3 });
        let projected = project(record.as_object().expect("object literal"));
        assert!(projected.is_empty());
    }
}
