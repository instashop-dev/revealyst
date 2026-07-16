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

use crate::store::queue::NewEvent;
use crate::store::{Store, StoreError};

/// The result of a [`validate_and_enqueue`] call: how many events were enqueued
/// vs quarantined. Counts only — never any content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EnqueueOutcome {
    /// Events that passed validation and were newly inserted into the queue
    /// (duplicates by `event_id` are already-present, counted by the store as 0).
    pub enqueued: usize,
    /// Events quarantined by the validator this call — dropped, never queued,
    /// but counted in `diagnostics_state`.
    pub quarantined: usize,
}

/// Validate `candidates` against `policy`, enqueue the clean ones, and advance
/// `connector_id`'s checkpoint — the privacy-gated form of
/// [`Store::enqueue_and_checkpoint_at`](crate::store::Store).
///
/// Enforcement happens BEFORE persistence (spec §16.3): a rejected event's
/// payload is dropped here and never reaches the encrypted queue; only a
/// content-free quarantine row (reason code) is recorded, keeping the drop
/// counted rather than silent. The checkpoint still advances over the whole
/// processed range — a quarantined event is a permanent drop, not something to
/// retry forever.
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
    let mut clean: Vec<NewEvent> = Vec::with_capacity(candidates.len());
    let mut quarantined = 0usize;

    for candidate in candidates {
        match validator::validate_event(candidate, policy) {
            Ok(_) => clean.push(candidate.clone()),
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

    /// A blocked policy quarantines every event — nothing is enqueued.
    #[test]
    fn blocked_policy_enqueues_nothing() {
        let store = store();
        let blocked = PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);
        let outcome =
            validate_and_enqueue(&store, &blocked, "claude_code", &[good("e1")], "c1", 100)
                .unwrap();
        assert_eq!(outcome.enqueued, 0);
        assert_eq!(outcome.quarantined, 1);
        assert_eq!(store.pending_count().unwrap(), 0);
    }

    /// Byte-level scan (spec §26.1 "queue persistence does not store raw text"):
    /// after a prohibited-field event is quarantined, its sentinel content
    /// appears NOWHERE in the on-disk database — it was dropped before any write.
    #[test]
    fn quarantined_content_never_reaches_disk() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-privacy-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, DbKey::from_bytes([9u8; KEY_LEN])).unwrap();
            // One clean event alongside the poisoned one, so the DB is non-empty.
            let batch = [good("ok"), with_prompt("bad")];
            let outcome =
                validate_and_enqueue(&store, &allow(), "claude_code", &batch, "c1", 100).unwrap();
            assert_eq!(outcome.enqueued, 1);
            assert_eq!(outcome.quarantined, 1);
        }

        let sentinel = b"SENTINEL_RAW_PROMPT_TEXT";
        for suffix in ["", "-wal", "-shm"] {
            let p = if suffix.is_empty() {
                path.clone()
            } else {
                path.with_file_name(format!("{DB_FILE_NAME}{suffix}"))
            };
            if let Ok(bytes) = std::fs::read(&p) {
                assert!(
                    !bytes.windows(sentinel.len()).any(|w| w == sentinel),
                    "quarantined content leaked into {p:?}"
                );
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
