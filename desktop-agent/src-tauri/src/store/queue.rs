//! The pending-event queue and the queue-before-checkpoint invariant
//! (spec §13.2; Desktop Agent plan T3.2).
//!
//! ## Queue-before-checkpoint (the load-bearing invariant)
//!
//! > Events must be committed to the encrypted queue **before** connector
//! > checkpoints advance. On crash, duplicate events are acceptable; data loss
//! > is not. (spec §13.2)
//!
//! [`Store::enqueue_and_checkpoint`] is the single API that guarantees this. It
//! runs two ordered, separately-committed transactions:
//!
//! 1. **Phase 1** — insert the events and `COMMIT`. The events are now durable.
//! 2. **Phase 2** — advance the connector checkpoint and `COMMIT`.
//!
//! A crash in the window between the two commits leaves the events durable but
//! the checkpoint *stale*. On the next run the connector re-reads from the old
//! checkpoint and re-emits the same events; because `event_id` is a
//! deterministic natural key with a `UNIQUE` constraint, the re-enqueue is an
//! idempotent `INSERT OR IGNORE` locally, and server-side idempotency dedups
//! anything already uploaded (spec §14.1). The checkpoint can therefore never
//! move ahead of durable events — the failure mode is a **duplicate, never a
//! gap**.
//!
//! The one ordering that WOULD lose data — advancing the checkpoint before the
//! events are durable — is structurally impossible through this API: there is
//! no public path that writes the checkpoint first.

use rusqlite::{params, OptionalExtension};

use super::{Store, StoreError};

/// Default content mode for a queued event. Phase 1 is Analytics Only and
/// nothing else is implemented (spec §29).
pub const ANALYTICS_ONLY: &str = "analytics_only";

/// An event to enqueue. `payload` is the bounded analytics-feature JSON
/// (numbers/enums only in Analytics Only mode); it is serialized and encrypted
/// before it touches disk — there is no code path that stores it in clear.
#[derive(Debug, Clone)]
pub struct NewEvent {
    /// Deterministic natural key (server dedups on this). `UNIQUE` in the table.
    pub event_id: String,
    /// Owning connector id.
    pub connector_id: String,
    /// Spec §12.1 event type (e.g. `usage_summary`).
    pub event_type: String,
    /// Content mode; Phase 1 always [`ANALYTICS_ONLY`].
    pub content_mode: String,
    /// When the underlying activity occurred (epoch ms).
    pub occurred_at: i64,
    /// Bounded analytics-feature JSON. Encrypted at rest.
    pub payload: serde_json::Value,
}

impl NewEvent {
    /// Convenience constructor for an Analytics-Only event.
    pub fn analytics_only(
        event_id: impl Into<String>,
        connector_id: impl Into<String>,
        event_type: impl Into<String>,
        occurred_at: i64,
        payload: serde_json::Value,
    ) -> Self {
        NewEvent {
            event_id: event_id.into(),
            connector_id: connector_id.into(),
            event_type: event_type.into(),
            content_mode: ANALYTICS_ONLY.to_string(),
            occurred_at,
            payload,
        }
    }
}

/// A dequeued event with its payload decrypted back into JSON.
#[derive(Debug, Clone)]
pub struct PendingEvent {
    /// Auto-increment row id (batch/purge handle; monotonic FIFO order).
    pub id: i64,
    pub event_id: String,
    pub connector_id: String,
    pub event_type: String,
    pub content_mode: String,
    pub occurred_at: i64,
    pub enqueued_at: i64,
    /// Decrypted analytics-feature JSON.
    pub payload: serde_json::Value,
}

impl Store {
    /// Enqueue `events` and advance `connector_id`'s checkpoint to
    /// `new_checkpoint`, guaranteeing the spec §13.2 ordering (events durable
    /// before the checkpoint moves). This is the ONLY correct way to advance a
    /// checkpoint alongside collected events.
    ///
    /// Uses the current wall clock for `enqueued_at`; see
    /// [`Store::enqueue_and_checkpoint_at`] for an injectable clock.
    pub fn enqueue_and_checkpoint(
        &self,
        connector_id: &str,
        events: &[NewEvent],
        new_checkpoint: &str,
    ) -> Result<usize, StoreError> {
        self.enqueue_and_checkpoint_at(connector_id, events, new_checkpoint, now_ms())
    }

    /// Clock-injectable form of [`Store::enqueue_and_checkpoint`].
    pub fn enqueue_and_checkpoint_at(
        &self,
        connector_id: &str,
        events: &[NewEvent],
        new_checkpoint: &str,
        now_ms: i64,
    ) -> Result<usize, StoreError> {
        // Phase 1: events durable FIRST.
        let inserted = self.enqueue_events_at(events, now_ms)?;
        // Phase 2: only now advance the checkpoint. A crash between these two
        // commits yields a stale checkpoint (⇒ duplicate on retry), never a
        // checkpoint ahead of the events (⇒ gap).
        self.set_checkpoint_at(connector_id, new_checkpoint, now_ms)?;
        Ok(inserted)
    }

    /// Phase 1 of the invariant, in isolation: durably commit `events` and
    /// return how many were newly inserted (duplicates by `event_id` are
    /// ignored). Deliberately module-private — advancing a checkpoint must go
    /// through [`Store::enqueue_and_checkpoint`], so no caller can commit a
    /// checkpoint without the events landing first. The crash-recovery test
    /// calls this directly to model "crashed after enqueue, before checkpoint".
    fn enqueue_events_at(&self, events: &[NewEvent], now_ms: i64) -> Result<usize, StoreError> {
        // Encrypt every payload BEFORE opening the transaction so the write
        // txn stays short and no crypto work happens under the DB lock.
        let mut encrypted: Vec<(&NewEvent, Vec<u8>)> = Vec::with_capacity(events.len());
        for event in events {
            let bytes = serde_json::to_vec(&event.payload).map_err(|_| StoreError::Encode)?;
            // Bind the ciphertext to this row's event_id (AAD): a payload lifted
            // into a row with a different event_id will fail to decrypt.
            let blob = self.key.encrypt(&bytes, event.event_id.as_bytes())?;
            encrypted.push((event, blob));
        }

        let mut guard = self.lock()?;
        let tx = guard.transaction().map_err(|_| StoreError::Query)?;
        let mut inserted = 0usize;
        for (event, blob) in &encrypted {
            let changed = tx
                .execute(
                    "INSERT OR IGNORE INTO pending_events
                        (event_id, connector_id, event_type, content_mode, occurred_at, enqueued_at, payload)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        event.event_id,
                        event.connector_id,
                        event.event_type,
                        event.content_mode,
                        event.occurred_at,
                        now_ms,
                        blob,
                    ],
                )
                .map_err(|_| StoreError::Query)?;
            inserted += changed;
        }
        tx.commit().map_err(|_| StoreError::Query)?;
        Ok(inserted)
    }

    /// Number of events currently in the queue.
    pub fn pending_count(&self) -> Result<i64, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row("SELECT count(*) FROM pending_events", [], |row| row.get(0))
            .map_err(|_| StoreError::Query)
    }

    /// The oldest `limit` events (FIFO by row id), payloads decrypted. Used by
    /// the sync engine (T4.1) to build a batch.
    pub fn dequeue_batch(&self, limit: usize) -> Result<Vec<PendingEvent>, StoreError> {
        let guard = self.lock()?;
        let mut stmt = guard
            .prepare(
                "SELECT id, event_id, connector_id, event_type, content_mode,
                        occurred_at, enqueued_at, payload
                 FROM pending_events
                 ORDER BY id ASC
                 LIMIT ?1",
            )
            .map_err(|_| StoreError::Query)?;

        let rows = stmt
            .query_map([limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Vec<u8>>(7)?,
                ))
            })
            .map_err(|_| StoreError::Query)?;

        let mut events = Vec::new();
        for row in rows {
            let (
                id,
                event_id,
                connector_id,
                event_type,
                content_mode,
                occurred_at,
                enqueued_at,
                blob,
            ) = row.map_err(|_| StoreError::Query)?;
            // Decrypt under the same AAD used at enqueue: this row's event_id.
            let plaintext = self.key.decrypt(&blob, event_id.as_bytes())?;
            let payload = serde_json::from_slice(&plaintext).map_err(|_| StoreError::Encode)?;
            events.push(PendingEvent {
                id,
                event_id,
                connector_id,
                event_type,
                content_mode,
                occurred_at,
                enqueued_at,
                payload,
            });
        }
        Ok(events)
    }

    /// Delete EVERY event still in the queue — the "Delete pending local data"
    /// privacy control (spec §19.4). Returns how many were removed. Only the
    /// local outbox is touched; already-uploaded data is the server's, not
    /// ours to reach. A no-op returning 0 on an empty queue.
    pub fn purge_all_pending(&self) -> Result<usize, StoreError> {
        let guard = self.lock()?;
        guard
            .execute("DELETE FROM pending_events", [])
            .map_err(|_| StoreError::Query)
    }

    /// Delete events by row id (after a batch is confirmed uploaded).
    pub fn purge_events(&self, ids: &[i64]) -> Result<usize, StoreError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut guard = self.lock()?;
        let tx = guard.transaction().map_err(|_| StoreError::Query)?;
        let mut deleted = 0usize;
        for id in ids {
            deleted += tx
                .execute("DELETE FROM pending_events WHERE id = ?1", params![id])
                .map_err(|_| StoreError::Query)?;
        }
        tx.commit().map_err(|_| StoreError::Query)?;
        Ok(deleted)
    }

    /// Record an upload receipt (spec §13.1 `upload_receipts`). Idempotent on
    /// `batch_id`.
    pub fn record_receipt(
        &self,
        batch_id: &str,
        event_count: i64,
        server_status: &str,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT OR IGNORE INTO upload_receipts
                    (batch_id, uploaded_at, event_count, server_status)
                 VALUES (?1, ?2, ?3, ?4)",
                params![batch_id, now_ms, event_count, server_status],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// The newest upload-receipt timestamp (epoch ms), or `None` if nothing has
    /// ever synced. Drives the diagnostics bundle's `last_successful_sync`
    /// (T4.3). `MAX(...)` over an empty table returns SQL NULL → `None`.
    pub fn latest_upload_at(&self) -> Result<Option<i64>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row("SELECT MAX(uploaded_at) FROM upload_receipts", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .map_err(|_| StoreError::Query)
    }

    /// Whether a receipt exists for `batch_id`.
    pub fn has_receipt(&self, batch_id: &str) -> Result<bool, StoreError> {
        let guard = self.lock()?;
        let found: Option<i64> = guard
            .query_row(
                "SELECT 1 FROM upload_receipts WHERE batch_id = ?1",
                [batch_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StoreError::Query)?;
        Ok(found.is_some())
    }
}

/// Current wall clock in epoch milliseconds. Non-monotonic, which is fine for
/// retention/bookkeeping timestamps; the queue's ordering uses the row id, not
/// the clock.
pub(crate) fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::{Store, StoreError, DB_FILE_NAME};
    use serde_json::json;

    fn key() -> DbKey {
        DbKey::from_bytes([5u8; KEY_LEN])
    }

    fn sample(event_id: &str) -> NewEvent {
        NewEvent::analytics_only(
            event_id,
            "claude_code",
            "usage_summary",
            1_700_000_000_000,
            json!({ "promptWordCount": 42, "taskCategory": "coding" }),
        )
    }

    #[test]
    fn enqueue_and_checkpoint_commits_both() {
        let store = Store::open_in_memory(key()).unwrap();
        let inserted = store
            .enqueue_and_checkpoint("claude_code", &[sample("e1"), sample("e2")], "cursor-2")
            .unwrap();
        assert_eq!(inserted, 2);
        assert_eq!(store.pending_count().unwrap(), 2);
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("cursor-2")
        );
    }

    #[test]
    fn payload_round_trips_through_encryption() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[sample("e1")], "c1")
            .unwrap();
        let batch = store.dequeue_batch(10).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].payload["promptWordCount"], 42);
        assert_eq!(batch[0].payload["taskCategory"], "coding");
        assert_eq!(batch[0].content_mode, ANALYTICS_ONLY);
    }

    /// Crash recovery (spec §13.2 / §27.3): a kill in the window between the
    /// event commit and the checkpoint commit must leave the event durable and
    /// the checkpoint stale — a duplicate on retry, never a gap.
    #[test]
    fn crash_between_enqueue_and_checkpoint_keeps_event_and_stale_checkpoint() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-store-crash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, key()).unwrap();
            // Establish a starting checkpoint so we can prove it did NOT move.
            store
                .set_checkpoint_at("claude_code", "cursor-1", 1)
                .unwrap();
            // Phase 1 ONLY: commit the event, then "crash" (drop the store)
            // before the checkpoint-advance phase ever runs.
            store.enqueue_events_at(&[sample("e1")], 10).unwrap();
        }

        // Reopen the same file with the same key (a fresh process would do the
        // same via the keychain).
        let store = Store::open_with_key(&path, key()).unwrap();
        // The event SURVIVED (no data loss)...
        assert_eq!(
            store.pending_count().unwrap(),
            1,
            "the event must survive the crash"
        );
        // ...and the checkpoint did NOT advance past it, so the connector will
        // re-read and re-emit it — a duplicate, never a gap.
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("cursor-1"),
            "the checkpoint must stay at its pre-crash value"
        );

        // Re-running the collect step (same deterministic event_id) is
        // idempotent locally: INSERT OR IGNORE, so no duplicate ROW appears,
        // and the checkpoint now advances cleanly.
        let inserted = store
            .enqueue_and_checkpoint("claude_code", &[sample("e1")], "cursor-2")
            .unwrap();
        assert_eq!(inserted, 0, "the already-queued event is a no-op re-insert");
        assert_eq!(store.pending_count().unwrap(), 1, "still exactly one row");
        assert_eq!(
            store.checkpoint("claude_code").unwrap().as_deref(),
            Some("cursor-2"),
            "the checkpoint advances on the successful retry"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The queue survives a process kill + restart (spec §27.3): enqueue, drop
    /// the handle, reopen, rows still present with intact payloads.
    #[test]
    fn queue_survives_restart() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-store-restart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, key()).unwrap();
            store
                .enqueue_and_checkpoint("claude_code", &[sample("a"), sample("b")], "c1")
                .unwrap();
        }
        let store = Store::open_with_key(&path, key()).unwrap();
        assert_eq!(store.pending_count().unwrap(), 2);
        let batch = store.dequeue_batch(10).unwrap();
        assert_eq!(batch[0].payload["taskCategory"], "coding");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_event_id_is_ignored_locally() {
        let store = Store::open_in_memory(key()).unwrap();
        let first = store
            .enqueue_and_checkpoint("claude_code", &[sample("dup")], "c1")
            .unwrap();
        let second = store
            .enqueue_and_checkpoint("claude_code", &[sample("dup")], "c2")
            .unwrap();
        assert_eq!(first, 1);
        assert_eq!(second, 0, "re-enqueue of the same event_id inserts nothing");
        assert_eq!(store.pending_count().unwrap(), 1);
    }

    #[test]
    fn dequeue_is_fifo_and_purge_removes_by_id() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[sample("a"), sample("b"), sample("c")],
                "c1",
            )
            .unwrap();
        let batch = store.dequeue_batch(2).unwrap();
        assert_eq!(batch.len(), 2);
        assert_eq!(batch[0].event_id, "a");
        assert_eq!(batch[1].event_id, "b");

        let deleted = store.purge_events(&[batch[0].id, batch[1].id]).unwrap();
        assert_eq!(deleted, 2);
        assert_eq!(store.pending_count().unwrap(), 1);
        let remaining = store.dequeue_batch(10).unwrap();
        assert_eq!(remaining[0].event_id, "c");
    }

    #[test]
    fn purge_all_pending_empties_the_queue() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[sample("a"), sample("b")], "c1")
            .unwrap();
        assert_eq!(store.pending_count().unwrap(), 2);

        let removed = store.purge_all_pending().unwrap();
        assert_eq!(removed, 2);
        assert_eq!(store.pending_count().unwrap(), 0);

        // Second call on an empty queue is a no-op returning 0.
        assert_eq!(store.purge_all_pending().unwrap(), 0);
    }

    #[test]
    fn receipts_are_idempotent() {
        let store = Store::open_in_memory(key()).unwrap();
        store.record_receipt("batch-1", 3, "accepted", 100).unwrap();
        store.record_receipt("batch-1", 3, "accepted", 200).unwrap();
        assert!(store.has_receipt("batch-1").unwrap());
        assert!(!store.has_receipt("batch-2").unwrap());
    }

    /// AAD binding end-to-end (R2): swapping two rows' payload ciphertexts in
    /// the database — something the encryption key alone would otherwise let a
    /// bug or attacker do undetected — is caught on read, because each payload
    /// is bound to its row's `event_id` as associated data.
    #[test]
    fn cross_row_payload_swap_is_detected_on_dequeue() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[sample("a"), sample("b")], "c1")
            .unwrap();

        // Swap the two rows' payload blobs directly (bypassing the API) — the
        // key is unchanged, only the ciphertext↔event_id pairing is broken.
        {
            let guard = store.lock().unwrap();
            let blob_a: Vec<u8> = guard
                .query_row(
                    "SELECT payload FROM pending_events WHERE event_id='a'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let blob_b: Vec<u8> = guard
                .query_row(
                    "SELECT payload FROM pending_events WHERE event_id='b'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            guard
                .execute(
                    "UPDATE pending_events SET payload=?1 WHERE event_id='a'",
                    [&blob_b],
                )
                .unwrap();
            guard
                .execute(
                    "UPDATE pending_events SET payload=?1 WHERE event_id='b'",
                    [&blob_a],
                )
                .unwrap();
        }

        // The mismatched AAD makes decryption fail rather than silently
        // returning the other row's payload.
        assert!(matches!(store.dequeue_batch(10), Err(StoreError::Crypto)));
    }

    /// Structural Analytics-Only floor (spec §29): the queue table has NO
    /// plaintext content column. The only content-bearing column is `payload`,
    /// and it is a BLOB (ciphertext) — there is no `prompt`/`response`/
    /// `content`/`transcript`/`text` column that could hold raw text.
    #[test]
    fn pending_events_has_no_raw_text_column() {
        let store = Store::open_in_memory(key()).unwrap();
        let guard = store.lock().unwrap();
        let mut stmt = guard.prepare("PRAGMA table_info(pending_events)").unwrap();
        let cols: Vec<(String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        let names: Vec<&str> = cols.iter().map(|(n, _)| n.as_str()).collect();
        for banned in [
            "prompt",
            "response",
            "content",
            "transcript",
            "text",
            "messages",
        ] {
            assert!(
                !names.contains(&banned),
                "pending_events must not have a `{banned}` column"
            );
        }
        // The single content column is BLOB (ciphertext), never TEXT.
        let payload_type = cols
            .iter()
            .find(|(n, _)| n == "payload")
            .map(|(_, t)| t.as_str())
            .expect("payload column exists");
        assert_eq!(payload_type, "BLOB", "payload must be a ciphertext BLOB");
    }

    /// Encryption-at-rest (plan T3.2 fallback): the plaintext payload never
    /// appears as clear bytes in the database file — a byte-level scan finds
    /// only ciphertext.
    #[test]
    fn payload_is_ciphertext_on_disk() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-store-atrest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, key()).unwrap();
            let event = NewEvent::analytics_only(
                "e1",
                "claude_code",
                "usage_summary",
                1,
                json!({ "marker": "SENTINEL_PLAINTEXT_XYZ", "n": 7 }),
            );
            store
                .enqueue_and_checkpoint("claude_code", &[event], "c1")
                .unwrap();
        }

        // Read the raw file (and the WAL sidecar, where a fresh write may still
        // live) and assert the sentinel never appears in clear.
        let sentinel = b"SENTINEL_PLAINTEXT_XYZ";
        for suffix in ["", "-wal", "-shm"] {
            let p = if suffix.is_empty() {
                path.clone()
            } else {
                path.with_file_name(format!("{DB_FILE_NAME}{suffix}"))
            };
            if let Ok(bytes) = std::fs::read(&p) {
                assert!(
                    !bytes.windows(sentinel.len()).any(|w| w == sentinel),
                    "plaintext payload leaked into {p:?}"
                );
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
