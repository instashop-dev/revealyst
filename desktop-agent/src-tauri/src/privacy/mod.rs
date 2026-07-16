//! Privacy engine: policy resolution + payload validation + quarantine
//! (spec §16; Desktop Agent plan T3.3).
//!
//! This module is the enforcement layer that sits ABOVE the encrypted store
//! (T3.2). The store's [`enqueue_and_checkpoint`](crate::store::Store) stays the
//! low-level durability primitive; nothing here changes it. Instead
//! [`validate_and_enqueue`] wraps it: every candidate event is run through the
//! [`validator`] against the resolved [`policy`] FIRST (spec §16.3 "enforcement
//! before queue persistence"), and only clean events reach the queue. A rejected
//! event's content is dropped on the spot — it never touches `pending_events` —
//! and the drop is counted as content-free [`quarantine`] metadata.
//!
//! T3.4's extractor plugs in here: it produces candidate [`NewEvent`]s and calls
//! [`validate_and_enqueue`] instead of the store directly, so its output passes
//! the validator by construction. T4.1's sync engine reads only what the queue
//! holds — quarantined events are structurally excluded from every batch because
//! they were never enqueued.

pub mod policy;
pub mod quarantine;
pub mod validator;

pub use policy::{
    most_restrictive, resolve, ContentMode, PolicyBlockReason, PolicyInputs, PolicyResolution,
};
pub use quarantine::{QuarantineReason, QUARANTINE_KIND};
pub use validator::{validate, validate_event, CleanPayload};

use serde_json::Value;

use crate::store::queue::NewEvent;
use crate::store::{Store, StoreError};

/// The result of a [`validate_and_enqueue`] call: how many events were enqueued
/// vs quarantined, and whether the call halted on a blocked policy. Counts
/// only — never any content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EnqueueOutcome {
    /// Events that passed validation and were newly inserted into the queue
    /// (duplicates by `event_id` are already-present, counted by the store as 0).
    pub enqueued: usize,
    /// Events quarantined by the validator this call — dropped, never queued,
    /// but counted in `diagnostics_state`.
    pub quarantined: usize,
    /// `true` iff the policy was blocked and the call HALTED: nothing enqueued,
    /// nothing quarantined, and the checkpoint deliberately NOT advanced so the
    /// range is re-evaluated once the policy clears (spec §13.2/§20).
    pub halted: bool,
}

/// Validate `candidates` against `policy`, enqueue the clean ones, and advance
/// `connector_id`'s checkpoint — the privacy-gated form of
/// [`Store::enqueue_and_checkpoint_at`](crate::store::Store).
///
/// Enforcement happens BEFORE persistence (spec §16.3). Two distinct failure
/// modes are handled differently:
///
/// - **Policy blocked** (`resolve()` → [`PolicyResolution::Blocked`], agent
///   state `policy_blocked`): a *transient* condition (e.g. a broaden attempt in
///   remote config that may clear). The call HALTS — nothing is enqueued and the
///   checkpoint is NOT advanced, so the range survives for re-evaluation once
///   the policy clears. Dropping it for a policy reason would be data loss
///   (spec §13.2 "data loss is not acceptable" / §20).
/// - **Per-event bad content** (prohibited/unknown/non-sendable field, free
///   text, contradicting flags): a permanent defect in that one event. It is
///   quarantined (content dropped, counted as content-free metadata) and the
///   checkpoint DOES advance over it — a single malformed event must never
///   freeze the connector forever.
///
/// Clean events are additionally passed through [`validator::project_sendable`]
/// just before enqueue — a structural backstop that strips any non-sendable key
/// even if the validator let one through.
///
/// This is the layer T3.4 (extractor) and T4.1 (sync) build on: extractor output
/// flows through `validate → enqueue`, and the sync engine only ever sees clean,
/// already-enqueued events.
pub fn validate_and_enqueue(
    store: &Store,
    policy: &PolicyResolution,
    connector_id: &str,
    candidates: &[NewEvent],
    new_checkpoint: &str,
    now_ms: i64,
) -> Result<EnqueueOutcome, StoreError> {
    // Policy-level HALT (spec §13.2/§20): a blocked policy is transient — hold
    // the checkpoint and enqueue nothing so no range is lost. This is NOT a
    // per-event quarantine (that would drop + advance); it is a deferral.
    if let PolicyResolution::Blocked(reason) = policy {
        tracing::warn!(
            component = "privacy",
            result = "policy_blocked",
            reason = reason.code(),
            "collection halted; checkpoint held for re-evaluation"
        );
        return Ok(EnqueueOutcome {
            enqueued: 0,
            quarantined: 0,
            halted: true,
        });
    }

    let mut clean: Vec<NewEvent> = Vec::with_capacity(candidates.len());
    let mut quarantined = 0usize;

    for candidate in candidates {
        match validator::validate_event(candidate, policy) {
            Ok(clean_payload) => {
                // Structural backstop: enqueue only sendable keys, even if the
                // validator (or a future refactor) let a non-sendable key by.
                let mut event = candidate.clone();
                event.payload = Value::Object(validator::project_sendable(clean_payload.as_map()));
                clean.push(event);
            }
            Err(reason) => {
                // Content is dropped here — only the fixed reason code is
                // persisted (metadata, never payload). The `event_id` is a
                // deterministic non-content key and is deliberately NOT recorded
                // to keep the row shape a pure count+reason (spec §23.2).
                store.record_diagnostic(QUARANTINE_KIND, reason.code(), now_ms)?;
                quarantined += 1;
                tracing::warn!(
                    component = "privacy",
                    result = "quarantined",
                    reason = reason.code(),
                    "event quarantined before persistence"
                );
            }
        }
    }

    let enqueued = store.enqueue_and_checkpoint_at(connector_id, &clean, new_checkpoint, now_ms)?;
    Ok(EnqueueOutcome {
        enqueued,
        quarantined,
        halted: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::{Store, DB_FILE_NAME};
    use serde_json::json;

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([9u8; KEY_LEN])).unwrap()
    }

    fn allow() -> PolicyResolution {
        PolicyResolution::Allow(ContentMode::AnalyticsOnly)
    }

    fn good(event_id: &str) -> NewEvent {
        NewEvent::analytics_only(
            event_id,
            "claude_code",
            "usage_summary",
            1,
            json!({ "model": "claude-opus-4", "usage.input_tokens": 42, "rawPromptIncluded": false }),
        )
    }

    fn with_prompt(event_id: &str) -> NewEvent {
        NewEvent::analytics_only(
            event_id,
            "claude_code",
            "prompt_submitted",
            1,
            json!({ "prompt": "SENTINEL_RAW_PROMPT_TEXT", "model": "m" }),
        )
    }

    /// Spec §26.1: a prohibited field is quarantined and its content NEVER
    /// reaches the queue — persistence contains no raw text.
    #[test]
    fn prohibited_field_event_is_quarantined_and_never_persisted() {
        let store = store();
        let outcome = validate_and_enqueue(
            &store,
            &allow(),
            "claude_code",
            &[with_prompt("e1")],
            "c1",
            100,
        )
        .unwrap();

        assert_eq!(outcome.enqueued, 0);
        assert_eq!(outcome.quarantined, 1);
        // Nothing landed in the queue.
        assert_eq!(store.pending_count().unwrap(), 0);
        // The drop was counted, and the recorded detail is the reason CODE, not
        // any part of the payload.
        assert_eq!(store.diagnostic_count(QUARANTINE_KIND).unwrap(), 1);
        // The checkpoint still advanced over the processed range.
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("c1")
        );
    }

    /// Spec §26.1: a contradicting-flags event is quarantined.
    #[test]
    fn contradicting_flags_event_is_quarantined() {
        let store = store();
        let event = NewEvent::analytics_only(
            "e1",
            "claude_code",
            "usage_summary",
            1,
            json!({ "model": "m", "rawPromptIncluded": true }),
        );
        let outcome =
            validate_and_enqueue(&store, &allow(), "claude_code", &[event], "c1", 100).unwrap();
        assert_eq!(outcome.quarantined, 1);
        assert_eq!(store.pending_count().unwrap(), 0);
        assert_eq!(store.diagnostic_count(QUARANTINE_KIND).unwrap(), 1);
    }

    /// A clean event enqueues normally through the gate.
    #[test]
    fn clean_event_enqueues() {
        let store = store();
        let outcome =
            validate_and_enqueue(&store, &allow(), "claude_code", &[good("e1")], "c1", 100)
                .unwrap();
        assert_eq!(outcome.enqueued, 1);
        assert_eq!(outcome.quarantined, 0);
        assert_eq!(store.pending_count().unwrap(), 1);
        assert_eq!(store.diagnostic_count(QUARANTINE_KIND).unwrap(), 0);
    }

    /// Spec §26.1: quarantined events are excluded from any batch, and the count
    /// increments per rejected event while clean events flow through.
    #[test]
    fn quarantined_events_excluded_from_batch_and_count_increments() {
        let store = store();
        let batch = [
            good("ok1"),
            with_prompt("bad1"),
            good("ok2"),
            with_prompt("bad2"),
        ];
        let outcome =
            validate_and_enqueue(&store, &allow(), "claude_code", &batch, "c1", 100).unwrap();

        assert_eq!(outcome.enqueued, 2);
        assert_eq!(outcome.quarantined, 2);
        assert_eq!(store.diagnostic_count(QUARANTINE_KIND).unwrap(), 2);

        // The sync batch (T4.1's view) sees ONLY the clean events.
        let dequeued = store.dequeue_batch(10).unwrap();
        let ids: Vec<&str> = dequeued.iter().map(|e| e.event_id.as_str()).collect();
        assert_eq!(ids, vec!["ok1", "ok2"]);
    }

    /// Data-loss footgun fix (spec §13.2/§20): a BLOCKED policy HALTS — nothing
    /// is enqueued, nothing is quarantined, and the checkpoint is NOT advanced,
    /// so the range survives for re-evaluation once the (transient) policy block
    /// clears. This is the key distinction from per-event quarantine.
    #[test]
    fn blocked_policy_halts_without_advancing_checkpoint() {
        let store = store();
        // A pre-existing checkpoint we can prove did NOT move.
        store
            .set_checkpoint_at("claude_code", "cursor-0", 1)
            .unwrap();

        let blocked = PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);
        let outcome = validate_and_enqueue(
            &store,
            &blocked,
            "claude_code",
            &[good("e1")],
            "cursor-99",
            100,
        )
        .unwrap();

        assert!(outcome.halted, "a blocked policy must halt");
        assert_eq!(outcome.enqueued, 0);
        // NOT quarantined — a policy block is a deferral, not a content drop.
        assert_eq!(outcome.quarantined, 0);
        assert_eq!(store.pending_count().unwrap(), 0);
        assert_eq!(
            store.diagnostic_count(QUARANTINE_KIND).unwrap(),
            0,
            "no quarantine row for a policy block"
        );
        // The checkpoint is UNCHANGED — the events are not lost.
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("cursor-0"),
            "the checkpoint must be held so the range is re-evaluated"
        );
    }

    /// An allowlisted-but-`sent:false` field (an on-device-only extraction input)
    /// is quarantined by the enqueue gate — it never reaches the queue.
    #[test]
    fn sent_false_field_is_quarantined_by_the_gate() {
        let store = store();
        let event = NewEvent::analytics_only(
            "e1",
            "claude_code",
            "usage_summary",
            1,
            json!({ "model": "m", "sessionId": "on-device-only" }),
        );
        let outcome =
            validate_and_enqueue(&store, &allow(), "claude_code", &[event], "c1", 100).unwrap();
        assert_eq!(outcome.enqueued, 0);
        assert_eq!(outcome.quarantined, 1);
        assert_eq!(store.pending_count().unwrap(), 0);
    }

    /// Fix #4 (make the guarantee real): the quarantine METADATA row carries
    /// ONLY the reason code — no field name, no value, no length, no event_id.
    /// `diagnostics_state` is an UNENCRYPTED table (counts/enums only, §23.2), so
    /// we read it back directly and assert the row leaks nothing about the
    /// rejected content (a meaningful, content-free guarantee per §29).
    #[test]
    fn quarantine_metadata_row_is_content_free() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-privacy-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, DbKey::from_bytes([9u8; KEY_LEN])).unwrap();
            let outcome = validate_and_enqueue(
                &store,
                &allow(),
                "claude_code",
                &[with_prompt("bad-event-id")],
                "c1",
                100,
            )
            .unwrap();
            assert_eq!(outcome.quarantined, 1);
            assert_eq!(store.pending_count().unwrap(), 0);
        }

        // Read the diagnostics table directly — it is not encrypted.
        let conn = rusqlite::Connection::open(&path).unwrap();
        let mut stmt = conn
            .prepare("SELECT kind, detail FROM diagnostics_state")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        drop(stmt);
        drop(conn);

        assert_eq!(rows.len(), 1, "exactly one quarantine row");
        let (kind, detail) = &rows[0];
        assert_eq!(kind, QUARANTINE_KIND);
        // The detail is EXACTLY the reason code — nothing about the payload.
        assert_eq!(detail, "prohibited_field");
        // Belt: the row leaks no content, field name, value, or event_id.
        for forbidden in [
            "SENTINEL_RAW_PROMPT_TEXT", // the value
            "prompt",                   // the offending field name
            "bad-event-id",             // the event id
        ] {
            assert!(
                !kind.contains(forbidden) && !detail.contains(forbidden),
                "metadata row leaked `{forbidden}`"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
