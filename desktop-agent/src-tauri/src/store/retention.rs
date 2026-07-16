//! Retention sweeper (spec §13.3).
//!
//! | Data                  | Retention              | Swept here |
//! |-----------------------|------------------------|------------|
//! | Pending events        | 30 days                | yes        |
//! | Upload receipts       | 30 days                | yes        |
//! | Diagnostic logs/state | 7 days                 | yes        |
//! | Connector checkpoints | until connector reset  | never      |
//! | Temporary imports     | delete after processing| T5.3       |
//!
//! [`Store::sweep`] takes the current time explicitly (injectable clock) so
//! the deletion boundaries are testable to the millisecond. It deletes rows
//! STRICTLY older than the cutoff (`age > window`, not `>=`), so a row exactly
//! at the boundary is kept for one more sweep.

use rusqlite::params;

use super::{Store, StoreError};

/// One day in milliseconds.
const DAY_MS: i64 = 86_400_000;

/// Pending events are retained 30 days (spec §13.3).
pub const PENDING_EVENT_RETENTION_MS: i64 = 30 * DAY_MS;

/// Upload receipts are retained 30 days (spec §13.3).
pub const RECEIPT_RETENTION_MS: i64 = 30 * DAY_MS;

/// Diagnostic state is retained 7 days (spec §13.3).
pub const DIAGNOSTICS_RETENTION_MS: i64 = 7 * DAY_MS;

/// How many rows each swept table lost, for diagnostics/tests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepCounts {
    pub pending_events: usize,
    pub upload_receipts: usize,
    pub diagnostics_state: usize,
}

impl SweepCounts {
    /// Total rows deleted across all swept tables.
    pub fn total(&self) -> usize {
        self.pending_events + self.upload_receipts + self.diagnostics_state
    }
}

impl Store {
    /// Delete every row older than its retention window, measured against
    /// `now_ms`. Checkpoints are deliberately untouched (retained until
    /// connector reset). Runs in a single transaction so a sweep is all-or-
    /// nothing.
    pub fn sweep(&self, now_ms: i64) -> Result<SweepCounts, StoreError> {
        let mut guard = self.lock()?;
        let tx = guard.transaction().map_err(|_| StoreError::Query)?;

        let pending_events = tx
            .execute(
                "DELETE FROM pending_events WHERE enqueued_at < ?1",
                params![now_ms - PENDING_EVENT_RETENTION_MS],
            )
            .map_err(|_| StoreError::Query)?;

        let upload_receipts = tx
            .execute(
                "DELETE FROM upload_receipts WHERE uploaded_at < ?1",
                params![now_ms - RECEIPT_RETENTION_MS],
            )
            .map_err(|_| StoreError::Query)?;

        let diagnostics_state = tx
            .execute(
                "DELETE FROM diagnostics_state WHERE created_at < ?1",
                params![now_ms - DIAGNOSTICS_RETENTION_MS],
            )
            .map_err(|_| StoreError::Query)?;

        tx.commit().map_err(|_| StoreError::Query)?;
        Ok(SweepCounts {
            pending_events,
            upload_receipts,
            diagnostics_state,
        })
    }

    /// Append a diagnostics-state row (counts/enums only — never a payload;
    /// spec §23.2). Provided here so the retention test has real rows to sweep
    /// and so T4.3 has a sink.
    pub fn record_diagnostic(
        &self,
        kind: &str,
        detail: &str,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO diagnostics_state (created_at, kind, detail) VALUES (?1, ?2, ?3)",
                params![now_ms, kind, detail],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// Count diagnostics-state rows of a given `kind`. Used by the privacy
    /// engine (T3.3) to surface the quarantine total without reaching into the
    /// store's SQL — the count is the only thing a quarantine leaves behind
    /// (spec §16.3: quarantined events are counted, never uploaded).
    pub fn diagnostic_count(&self, kind: &str) -> Result<i64, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT count(*) FROM diagnostics_state WHERE kind = ?1",
                [kind],
                |row| row.get(0),
            )
            .map_err(|_| StoreError::Query)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::queue::NewEvent;
    use crate::store::Store;
    use serde_json::json;

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([2u8; KEY_LEN])).unwrap()
    }

    fn event(id: &str) -> NewEvent {
        NewEvent::analytics_only(id, "claude_code", "usage_summary", 1, json!({ "n": 1 }))
    }

    /// Rows land at various ages; a sweep deletes exactly those strictly older
    /// than their window and keeps everything at or under it.
    #[test]
    fn sweep_respects_each_retention_boundary() {
        let store = store();
        // Fix "now" well past all windows so the arithmetic is unambiguous.
        let now = 1_000 * DAY_MS;

        // Pending events: one 31 days old (delete), one exactly 30 days (keep),
        // one fresh (keep). enqueued_at is set via the injectable clock.
        store
            .enqueue_and_checkpoint_at("claude_code", &[event("old")], "c", now - 31 * DAY_MS)
            .unwrap();
        store
            .enqueue_and_checkpoint_at(
                "claude_code",
                &[event("edge")],
                "c",
                now - PENDING_EVENT_RETENTION_MS,
            )
            .unwrap();
        store
            .enqueue_and_checkpoint_at("claude_code", &[event("fresh")], "c", now)
            .unwrap();

        // Receipts: one 31 days old (delete), one fresh (keep).
        store
            .record_receipt("r-old", 1, "accepted", now - 31 * DAY_MS)
            .unwrap();
        store.record_receipt("r-new", 1, "accepted", now).unwrap();

        // Diagnostics: one 8 days old (delete), one exactly 7 days (keep).
        store.record_diagnostic("k", "d", now - 8 * DAY_MS).unwrap();
        store
            .record_diagnostic("k", "d", now - DIAGNOSTICS_RETENTION_MS)
            .unwrap();

        let counts = store.sweep(now).unwrap();
        assert_eq!(counts.pending_events, 1, "only the 31-day event is deleted");
        assert_eq!(counts.upload_receipts, 1);
        assert_eq!(counts.diagnostics_state, 1);
        assert_eq!(counts.total(), 3);

        // Survivors: the edge + fresh event, the new receipt, the edge diag.
        assert_eq!(store.pending_count().unwrap(), 2);
        assert!(store.has_receipt("r-new").unwrap());
        assert!(!store.has_receipt("r-old").unwrap());
    }

    /// Checkpoints are retained until connector reset — a sweep never removes
    /// one, however old its `updated_at`.
    #[test]
    fn sweep_never_touches_checkpoints() {
        let store = store();
        store.set_checkpoint_at("claude_code", "cursor", 1).unwrap();
        let now = 10_000 * DAY_MS;
        store.sweep(now).unwrap();
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("cursor"),
            "checkpoints survive retention sweeps"
        );
    }

    #[test]
    fn sweep_on_empty_store_deletes_nothing() {
        let store = store();
        let counts = store.sweep(1_000 * DAY_MS).unwrap();
        assert_eq!(counts.total(), 0);
    }
}
