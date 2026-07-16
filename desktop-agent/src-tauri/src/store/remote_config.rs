//! Signed remote-config cache row (spec §13.1 `remote_config_cache`; Desktop
//! Agent plan T4.2, agent side).
//!
//! A single-row (`id = 1`) cache of the last valid unexpired signed config so
//! that a later invalid or absent fetch can fall back to it (spec §17.2). The
//! row stores the config body JSON + its detached signature verbatim; the
//! verify + expiry + never-broaden logic lives in [`crate::config`], which owns
//! reconstructing a `SignedConfig` from these raw parts. This module is only
//! the storage seam — it stays ignorant of the config's meaning.

use rusqlite::{params, OptionalExtension};

use super::{Store, StoreError};

/// The raw cached-config parts, as stored. `expires_at`/`fetched_at` are epoch
/// milliseconds; the semantic re-parse (and re-verify) happens in
/// [`crate::config::load_cached_config`].
#[derive(Debug, Clone)]
pub struct CachedConfigRow {
    /// The config body JSON (WITHOUT the `signature` field).
    pub config_json: String,
    /// The detached base64 Ed25519 signature over the body's canonical bytes.
    pub signature: String,
    /// `expiresAt` as epoch ms (bookkeeping; the authority is the body).
    pub expires_at: i64,
    /// When this row was fetched + cached (epoch ms).
    pub fetched_at: i64,
}

impl Store {
    /// Read the single cached config row, if one has been written.
    pub fn read_remote_config_row(&self) -> Result<Option<CachedConfigRow>, StoreError> {
        let guard = self.lock()?;
        guard
            .query_row(
                "SELECT config_json, signature, expires_at, fetched_at
                 FROM remote_config_cache WHERE id = 1",
                [],
                |row| {
                    Ok(CachedConfigRow {
                        config_json: row.get(0)?,
                        signature: row.get(1)?,
                        expires_at: row.get(2)?,
                        fetched_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|_| StoreError::Query)
    }

    /// Upsert the single cached config row (id = 1). Overwrites any prior cache
    /// — only the most recent valid config is retained.
    pub fn write_remote_config_row(
        &self,
        config_json: &str,
        signature: &str,
        config_version: &str,
        issued_at: i64,
        expires_at: i64,
        fetched_at: i64,
    ) -> Result<(), StoreError> {
        let guard = self.lock()?;
        guard
            .execute(
                "INSERT INTO remote_config_cache
                    (id, config_json, signature, config_version, issued_at, expires_at, fetched_at)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    config_json = excluded.config_json,
                    signature = excluded.signature,
                    config_version = excluded.config_version,
                    issued_at = excluded.issued_at,
                    expires_at = excluded.expires_at,
                    fetched_at = excluded.fetched_at",
                params![
                    config_json,
                    signature,
                    config_version,
                    issued_at,
                    expires_at,
                    fetched_at
                ],
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
        Store::open_in_memory(DbKey::from_bytes([9u8; KEY_LEN])).unwrap()
    }

    #[test]
    fn read_is_none_before_any_write() {
        let store = store();
        assert!(store.read_remote_config_row().unwrap().is_none());
    }

    #[test]
    fn write_then_read_roundtrips_and_stays_single_row() {
        let store = store();
        store
            .write_remote_config_row("{\"a\":1}", "sig", "3", 100, 200, 150)
            .unwrap();
        let row = store.read_remote_config_row().unwrap().unwrap();
        assert_eq!(row.config_json, "{\"a\":1}");
        assert_eq!(row.signature, "sig");
        assert_eq!(row.expires_at, 200);
        assert_eq!(row.fetched_at, 150);

        // A second write overwrites the single row in place.
        store
            .write_remote_config_row("{\"a\":2}", "sig2", "4", 300, 400, 350)
            .unwrap();
        let row2 = store.read_remote_config_row().unwrap().unwrap();
        assert_eq!(row2.config_json, "{\"a\":2}");
        assert_eq!(row2.signature, "sig2");

        let count: i64 = {
            let guard = store.lock().unwrap();
            guard
                .query_row("SELECT count(*) FROM remote_config_cache", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count, 1);
    }
}
