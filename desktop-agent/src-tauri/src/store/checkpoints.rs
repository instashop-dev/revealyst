//! Connector checkpoints + connector/installation state (spec §13.1).
//!
//! Checkpoints are opaque per-connector cursor strings. They are retained
//! "until connector reset" (spec §13.3) — the retention sweeper never touches
//! them; [`Store::reset_connector`] is the only thing that clears one.
//!
//! The checkpoint advance ([`Store::set_checkpoint_at`]) is phase 2 of the
//! queue-before-checkpoint invariant. It is exposed publicly for connector
//! bookkeeping (e.g. reset), but the collect path MUST advance a checkpoint via
//! [`Store::enqueue_and_checkpoint`](super::queue) so the events are always
//! durable first (spec §13.2).

use rusqlite::{params, OptionalExtension};

use super::queue::now_ms;
use super::{Store, StoreError};

impl Store {
    /// The current checkpoint cursor for `connector_id`, or `None` if the
    /// connector has never checkpointed (or was reset).
    pub fn checkpoint(&self, connector_id: &str) -> Result<Option<String>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT checkpoint FROM connector_checkpoints WHERE connector_id = ?1",
                [connector_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StoreError::Query)
    }

    /// Advance (or set) `connector_id`'s checkpoint using the current clock.
    /// Prefer [`Store::enqueue_and_checkpoint`](super::queue) on the collect
    /// path — this standalone form is for connector bookkeeping such as an
    /// initial cursor or a reset-then-set.
    pub fn set_checkpoint(&self, connector_id: &str, checkpoint: &str) -> Result<(), StoreError> {
        self.set_checkpoint_at(connector_id, checkpoint, now_ms())
    }

    /// Clock-injectable form of [`Store::set_checkpoint`]. Phase 2 of the
    /// queue-before-checkpoint invariant.
    pub fn set_checkpoint_at(
        &self,
        connector_id: &str,
        checkpoint: &str,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO connector_checkpoints (connector_id, checkpoint, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(connector_id) DO UPDATE SET
                    checkpoint = excluded.checkpoint,
                    updated_at = excluded.updated_at",
                params![connector_id, checkpoint, now_ms],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// Reset a connector: clear its checkpoint so the next run re-collects from
    /// the source's beginning (spec §13.3 "until connector reset").
    pub fn reset_connector(&self, connector_id: &str) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "DELETE FROM connector_checkpoints WHERE connector_id = ?1",
                [connector_id],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// Upsert per-connector operational state (status + last run/error). Counts
    /// and enums only — never a payload.
    pub fn set_connector_state(
        &self,
        connector_id: &str,
        status: &str,
        last_run_at: Option<i64>,
        last_error_code: Option<&str>,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO connector_state
                    (connector_id, status, last_run_at, last_error_code, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(connector_id) DO UPDATE SET
                    status = excluded.status,
                    last_run_at = excluded.last_run_at,
                    last_error_code = excluded.last_error_code,
                    updated_at = excluded.updated_at",
                params![connector_id, status, last_run_at, last_error_code, now_ms],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// The stored status string for `connector_id`, if any.
    pub fn connector_status(&self, connector_id: &str) -> Result<Option<String>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT status FROM connector_state WHERE connector_id = ?1",
                [connector_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StoreError::Query)
    }

    /// Initialise (or refresh) the single `installation_state` row. Idempotent:
    /// re-running keeps the original `created_at` and only bumps `updated_at`
    /// and the policy version.
    pub fn init_installation(
        &self,
        installation_id: &str,
        privacy_policy_version: &str,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO installation_state
                    (id, installation_id, schema_version, privacy_policy_version, created_at, updated_at)
                 VALUES (1, ?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    installation_id = excluded.installation_id,
                    schema_version = excluded.schema_version,
                    privacy_policy_version = excluded.privacy_policy_version,
                    updated_at = excluded.updated_at",
                params![
                    installation_id,
                    super::SCHEMA_VERSION,
                    privacy_policy_version,
                    now_ms
                ],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// The stored installation id, if [`Store::init_installation`] has run.
    pub fn installation_id(&self) -> Result<Option<String>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT installation_id FROM installation_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StoreError::Query)
    }

    /// Every connector's `(connector_id, status)`, id-sorted. Counts/enums only
    /// (never a payload) — the diagnostics bundle (T4.3) reports these states.
    pub fn connector_states(&self) -> Result<Vec<(String, String)>, StoreError> {
        let guard = self.lock()?;
        let mut stmt = guard
            .prepare("SELECT connector_id, status FROM connector_state ORDER BY connector_id ASC")
            .map_err(|_| StoreError::Query)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| StoreError::Query)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|_| StoreError::Query)?);
        }
        Ok(out)
    }

    /// The current self-update rollout state (spec §13.1 `update_state`), or
    /// `None` before the updater (T6) has written a row. A single opaque marker,
    /// never a payload.
    pub fn update_rollout_state(&self) -> Result<Option<String>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT rollout_state FROM update_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StoreError::Query)
    }
}

#[cfg(test)]
mod tests {
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::Store;

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([1u8; KEY_LEN])).unwrap()
    }

    #[test]
    fn checkpoint_upsert_and_read() {
        let store = store();
        assert_eq!(store.checkpoint("c").unwrap(), None);
        store.set_checkpoint_at("c", "cursor-1", 1).unwrap();
        assert_eq!(store.checkpoint("c").unwrap().as_deref(), Some("cursor-1"));
        store.set_checkpoint_at("c", "cursor-2", 2).unwrap();
        assert_eq!(store.checkpoint("c").unwrap().as_deref(), Some("cursor-2"));
    }

    #[test]
    fn reset_clears_only_the_named_connector() {
        let store = store();
        store.set_checkpoint_at("a", "x", 1).unwrap();
        store.set_checkpoint_at("b", "y", 1).unwrap();
        store.reset_connector("a").unwrap();
        assert_eq!(store.checkpoint("a").unwrap(), None);
        assert_eq!(store.checkpoint("b").unwrap().as_deref(), Some("y"));
    }

    #[test]
    fn connector_state_upsert() {
        let store = store();
        store
            .set_connector_state("a", "healthy", Some(100), None, 100)
            .unwrap();
        assert_eq!(
            store.connector_status("a").unwrap().as_deref(),
            Some("healthy")
        );
        store
            .set_connector_state("a", "degraded", Some(200), Some("parse_failed"), 200)
            .unwrap();
        assert_eq!(
            store.connector_status("a").unwrap().as_deref(),
            Some("degraded")
        );
    }

    #[test]
    fn installation_state_is_single_row_and_idempotent() {
        let store = store();
        assert_eq!(store.installation_id().unwrap(), None);
        store
            .init_installation("install-1", "2026-07-16", 100)
            .unwrap();
        assert_eq!(
            store.installation_id().unwrap().as_deref(),
            Some("install-1")
        );
        // A second call updates in place — still exactly one row.
        store
            .init_installation("install-1", "2026-07-17", 200)
            .unwrap();
        let count: i64 = {
            let guard = store.lock().unwrap();
            guard
                .query_row("SELECT count(*) FROM installation_state", [], |row| {
                    row.get(0)
                })
                .unwrap()
        };
        assert_eq!(count, 1);
    }
}
