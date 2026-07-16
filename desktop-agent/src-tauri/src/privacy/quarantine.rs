//! Quarantine reasons + counting metadata (spec §16.3; Desktop Agent plan T3.3).
//!
//! When the payload validator rejects a candidate event, the event's CONTENT is
//! dropped immediately — it never reaches [`pending_events`](crate::store) or any
//! other durable surface (spec §29: no raw text persisted). What we DO keep is a
//! content-free **metadata** record: the reason code + an implicit count (one
//! `diagnostics_state` row per quarantine) so the drop is *counted, never
//! silent* (§16.3). A quarantined event is therefore observable in diagnostics
//! (reason breakdown via `kind`/`detail`, total via
//! [`Store::diagnostic_count`](crate::store)) yet leaks nothing about what it
//! contained.
//!
//! ## Metadata decision (deliberate, recorded)
//!
//! We record **the reason code and a per-quarantine row**, and nothing else —
//! no field name, no value, no length, no snippet. A prohibited-field
//! quarantine stores the string `"prohibited_field"`, not which field or its
//! contents; a free-text quarantine stores `"free_text_value"`, not the text or
//! its length. This is the §23.2 diagnostics rule (counts/enums only) applied to
//! the one place raw-ish content is briefly in hand: the safest record is the
//! bare fact that a drop happened and why, at the granularity of the fixed
//! reason enum. The rows ride the existing 7-day diagnostics retention sweep.

/// The `diagnostics_state.kind` value under which every quarantine is counted.
/// A single stable string so [`Store::diagnostic_count`](crate::store) can total
/// quarantines without the validator reaching into the store's SQL.
pub const QUARANTINE_KIND: &str = "quarantine";

/// Why a candidate event was quarantined instead of enqueued. Each variant maps
/// to a fixed, content-free code — the code is the ONLY thing persisted or
/// logged, mirroring the store's [`StoreError`](crate::store::StoreError) code
/// discipline so nothing about the rejected payload can leak through the reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuarantineReason {
    /// The active policy did not resolve to `Allow(AnalyticsOnly)` — collection
    /// is blocked, so no event may be enqueued under it (spec §16.2/§20).
    PolicyBlocked,
    /// The event's `content_mode` was something other than `analytics_only` —
    /// the only mode implemented in Phase 1 (spec §6.2/§29).
    UnsupportedMode,
    /// A payload key is one of the spec §12.2 `ProhibitedAnalyticsOnlyFields`
    /// (prompt/response/messages/… — case-insensitive).
    ProhibitedField,
    /// A payload key is not on the collection allowlist (`allowlist::is_allowed`
    /// is `false`). Allowlist-first: an unregistered key is rejected, not
    /// shipped (law 3).
    UnknownField,
    /// A payload key is allowlisted but `sent: false` — an on-device-only
    /// extraction input (e.g. `timestamp`, `sessionId`) that must never be
    /// enqueued for upload (spec §29; the schema's "never leaves the device"
    /// promise). Invariant-(b): shipping it would contradict the collection
    /// contract.
    NonSendableField,
    /// A payload value is free-text-shaped: a non-scalar (object/array/null), or
    /// a string over the length bound or carrying newlines/control chars. The
    /// Analytics-Only payload is numbers + bounded enums only (spec §12.2).
    FreeTextValue,
    /// A privacy flag contradicts Analytics Only: `rawPromptIncluded` or
    /// `rawResponseIncluded` is anything other than `false` (spec §16.3 example).
    ContradictingFlags,
}

impl QuarantineReason {
    /// The stable, content-free reason code stored in `diagnostics_state.detail`
    /// and used in logs. Never carries any part of the rejected payload.
    pub fn code(&self) -> &'static str {
        match self {
            QuarantineReason::PolicyBlocked => "policy_blocked",
            QuarantineReason::UnsupportedMode => "unsupported_mode",
            QuarantineReason::ProhibitedField => "prohibited_field",
            QuarantineReason::UnknownField => "unknown_field",
            QuarantineReason::NonSendableField => "non_sendable_field",
            QuarantineReason::FreeTextValue => "free_text_value",
            QuarantineReason::ContradictingFlags => "contradicting_flags",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reason_has_a_nonempty_distinct_code() {
        let reasons = [
            QuarantineReason::PolicyBlocked,
            QuarantineReason::UnsupportedMode,
            QuarantineReason::ProhibitedField,
            QuarantineReason::UnknownField,
            QuarantineReason::NonSendableField,
            QuarantineReason::FreeTextValue,
            QuarantineReason::ContradictingFlags,
        ];
        let mut codes: Vec<&str> = reasons.iter().map(|r| r.code()).collect();
        assert!(codes.iter().all(|c| !c.is_empty()));
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), reasons.len(), "reason codes must be distinct");
    }

    /// The kind string is stable — the store's count query keys on it.
    #[test]
    fn quarantine_kind_is_stable() {
        assert_eq!(QUARANTINE_KIND, "quarantine");
    }
}
