//! Local settings row (schema v2 `local_settings`; Desktop Agent).
//!
//! A single-row (`id = 1`) store of the user's own device preferences so they
//! survive a restart. Previously the pause control and the sticky sync status
//! lived only in memory and reset to their defaults on every launch — so a
//! paused device would silently resume collecting after a reboot (a privacy
//! surprise), and a real drop signal (`degraded`) would vanish.
//!
//! This lives in the agent's OWN local SQLite store — NOT the server database.
//! Like the sibling bookkeeping tables (`update_state`, `diagnostics_state`),
//! these preference values are plaintext columns; only the queued activity
//! payloads (`pending_events.payload`) are AES-GCM encrypted. Nothing stored
//! here is activity content, and nothing here changes what leaves the device:
//! it only records how attribution is *chosen* locally and whether collection
//! is paused.

use rusqlite::{params, OptionalExtension};

use super::{Store, StoreError};

/// The persisted local preferences. Reads default to the privacy-safe values
/// when no row has been written yet (fresh install).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LocalSettings {
    /// Whether background collection is paused. Restored on startup so a paused
    /// device stays paused after a reboot.
    pub paused: bool,
    /// The sticky sync-status "degraded" flag (a real drop signal). Restored on
    /// startup so the standing warning is not lost on relaunch.
    pub degraded: bool,
    /// The answer to "Is this computer used only by you?":
    ///   - `Some(true)`  = only you → attribute activity to the person;
    ///   - `Some(false)` = shared computer → account/device level, WITH the
    ///     honest shared-device disclosure;
    ///   - `None`        = not answered yet → the privacy-safe default:
    ///     account/device level, never a guessed person, and no shared-device
    ///     claim (matches the agent's original absent-flag behavior).
    pub identity_only_you: Option<bool>,
}

impl Store {
    /// Read the single local-settings row. Returns the privacy-safe defaults
    /// ([`LocalSettings::default`]) when no row has been written yet, so callers
    /// never have to special-case a fresh install.
    pub fn read_local_settings(&self) -> Result<LocalSettings, StoreError> {
        let guard = self.lock()?;
        let row = guard
            .query_row(
                "SELECT paused, degraded, identity_only_you
                 FROM local_settings WHERE id = 1",
                [],
                |row| {
                    Ok(LocalSettings {
                        paused: row.get::<_, i64>(0)? != 0,
                        degraded: row.get::<_, i64>(1)? != 0,
                        identity_only_you: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
                    })
                },
            )
            .optional()
            .map_err(|_| StoreError::Query)?;
        Ok(row.unwrap_or_default())
    }

    /// Persist the pause flag (upsert of the single row; other columns keep
    /// their stored values). A paused device must survive a restart.
    pub fn set_paused_setting(&self, paused: bool, now_ms: i64) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO local_settings (id, paused, updated_at)
                 VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                    paused = excluded.paused,
                    updated_at = excluded.updated_at",
                params![paused as i64, now_ms],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// Persist the sticky sync-status "degraded" flag (upsert of the single row;
    /// other columns keep their stored values).
    pub fn set_degraded_setting(&self, degraded: bool, now_ms: i64) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO local_settings (id, degraded, updated_at)
                 VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                    degraded = excluded.degraded,
                    updated_at = excluded.updated_at",
                params![degraded as i64, now_ms],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }

    /// Persist the "Is this computer used only by you?" answer (upsert of the
    /// single row; other columns keep their stored values). `Some(true)` = only
    /// you, `Some(false)` = shared, `None` = clear back to the unanswered
    /// privacy-safe default.
    pub fn set_identity_only_you(
        &self,
        only_you: Option<bool>,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO local_settings (id, identity_only_you, updated_at)
                 VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                    identity_only_you = excluded.identity_only_you,
                    updated_at = excluded.updated_at",
                params![only_you.map(|v| v as i64), now_ms],
            )
            .map_err(|_| StoreError::Query)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::Store;

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([7u8; KEY_LEN])).unwrap()
    }

    #[test]
    fn fresh_store_reads_privacy_safe_defaults() {
        let store = store();
        let settings = store.read_local_settings().unwrap();
        // The absent-row default: not paused, not degraded, and NO identity
        // answer (so attribution stays at the account/device level).
        assert!(!settings.paused);
        assert!(!settings.degraded);
        assert_eq!(settings.identity_only_you, None);
    }

    #[test]
    fn pause_persists_and_survives_a_reopen() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-settings-pause-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(crate::store::DB_FILE_NAME);
        let key_bytes = [8u8; KEY_LEN];

        {
            let store = Store::open_with_key(&path, DbKey::from_bytes(key_bytes)).unwrap();
            store.set_paused_setting(true, 100).unwrap();
            assert!(store.read_local_settings().unwrap().paused);
        }
        // Reopen the SAME file with the SAME key: the pause flag is still set —
        // a reboot must not silently resume collection.
        {
            let store = Store::open_with_key(&path, DbKey::from_bytes(key_bytes)).unwrap();
            assert!(store.read_local_settings().unwrap().paused);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identity_answer_and_degraded_survive_a_reopen() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-settings-restore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(crate::store::DB_FILE_NAME);
        let key_bytes = [9u8; KEY_LEN];

        {
            let store = Store::open_with_key(&path, DbKey::from_bytes(key_bytes)).unwrap();
            store.set_identity_only_you(Some(false), 100).unwrap();
            store.set_degraded_setting(true, 100).unwrap();
        }
        // Reopen the SAME file: the shared-computer answer and the sticky drop
        // signal are both still there — the restart-restore path this feature
        // depends on.
        {
            let store = Store::open_with_key(&path, DbKey::from_bytes(key_bytes)).unwrap();
            let settings = store.read_local_settings().unwrap();
            assert_eq!(settings.identity_only_you, Some(false));
            assert!(settings.degraded);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn setters_touch_only_their_own_column_and_stay_single_row() {
        let store = store();
        store.set_paused_setting(true, 1).unwrap();
        store.set_degraded_setting(true, 2).unwrap();
        store.set_identity_only_you(Some(false), 3).unwrap();

        let settings = store.read_local_settings().unwrap();
        assert!(settings.paused, "pause preserved across sibling writes");
        assert!(
            settings.degraded,
            "degraded preserved across sibling writes"
        );
        assert_eq!(settings.identity_only_you, Some(false));

        // Updating one column leaves the others intact.
        store.set_paused_setting(false, 4).unwrap();
        let settings = store.read_local_settings().unwrap();
        assert!(!settings.paused);
        assert!(settings.degraded);
        assert_eq!(settings.identity_only_you, Some(false));

        let count: i64 = {
            let guard = store.lock().unwrap();
            guard
                .query_row("SELECT count(*) FROM local_settings", [], |row| row.get(0))
                .unwrap()
        };
        assert_eq!(count, 1);
    }

    #[test]
    fn identity_answer_roundtrips_all_three_states() {
        let store = store();
        store.set_identity_only_you(Some(true), 1).unwrap();
        assert_eq!(
            store.read_local_settings().unwrap().identity_only_you,
            Some(true)
        );
        store.set_identity_only_you(Some(false), 2).unwrap();
        assert_eq!(
            store.read_local_settings().unwrap().identity_only_you,
            Some(false)
        );
        // Clearing back to unanswered restores the privacy-safe default.
        store.set_identity_only_you(None, 3).unwrap();
        assert_eq!(store.read_local_settings().unwrap().identity_only_you, None);
    }
}
