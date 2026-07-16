//! Encrypted local store + queue (spec §13; Desktop Agent plan T3.2).
//!
//! # Encryption decision (plan risk #3) — application-layer field encryption
//!
//! The plan gives two options for encryption-at-rest and asks T3.2 to pick ONE
//! and document it:
//!
//! - PRIMARY: SQLCipher via `rusqlite` + `bundled-sqlcipher-vendored-openssl`.
//! - RECORDED FALLBACK: a plain `rusqlite` `bundled` SQLite file in an
//!   OS-protected directory + application-layer AES-256-GCM encryption on the
//!   payload columns.
//!
//! **We ship the FALLBACK.** Reasons, deliberately recorded:
//!
//! 1. *We cannot compile locally* (no MSVC linker on the Windows dev machine),
//!    so the CI matrix (`macos-latest` + `windows-latest`) is the only compile
//!    gate. `bundled-sqlcipher-vendored-openssl` builds OpenSSL from source via
//!    `openssl-src`, which on Windows MSVC needs Perl **and** NASM on PATH —
//!    the classic Tauri SQLCipher pain point (plan risk #3). Committing to a
//!    from-source OpenSSL build I cannot prove locally is the highest-risk path.
//! 2. *The crate tree already, deliberately, avoids OpenSSL.* `reqwest` is
//!    configured `default-features = false` with `rustls-tls` precisely so
//!    there is "no OpenSSL system dep" (see `Cargo.toml`). Re-introducing a
//!    vendored OpenSSL build only for the DB contradicts that posture.
//! 3. *The fallback has no system dependencies.* `rusqlite` `bundled` compiles
//!    the SQLite amalgamation with the C toolchain Tauri already requires, and
//!    `aes-gcm` (RustCrypto) is pure Rust — the same pure-crypto posture as
//!    `rustls`. Both are known-good on the exact CI matrix.
//!
//! **If CI later fails to compile even the `bundled` SQLite**, that is NOT a
//! pivot back to SQLCipher — the fallback is already the low-risk option; the
//! failure would be a plain C-toolchain issue on the runner. There is no
//! further fallback below this one, so a red `rust`/`build` job here means the
//! runner's C toolchain needs fixing, not a design change.
//!
//! ## Privacy-disclosure delta (obligates T5.4)
//!
//! Because we do NOT whole-file-encrypt (SQLCipher would), the privacy screen
//! must disclose the honest boundary:
//!
//! > The activity details this app queues are individually encrypted with
//! > AES-256-GCM using a key kept only in your operating system's secure
//! > keychain. The database file itself is a standard SQLite file in a
//! > protected app folder: its table structure and bookkeeping (timestamps,
//! > counts, sync status, connector names) are readable if someone copies the
//! > file, but the encrypted activity contents are not.
//!
//! SQLCipher would additionally hide the schema and bookkeeping. The queued
//! *contents* are protected either way; the delta is only the surrounding
//! metadata. This wording is the T5.4 source of truth.
//!
//! # Structural Analytics-Only guarantee (spec §29)
//!
//! `pending_events` has **no text-blob-for-content column**. The only payload
//! column is `payload BLOB`, which stores AES-GCM ciphertext of the bounded
//! analytics-feature JSON — never a `prompt`, `response`, `content`, or
//! `transcript` column exists to hold raw text. This is enforced by the
//! `pending_events_has_no_raw_text_column` test in [`queue`]. The T3.3
//! validator adds the value-level gate at enqueue; the schema shape is the
//! structural floor beneath it.

pub mod checkpoints;
pub mod crypto;
pub mod queue;
pub mod retention;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crypto::DbKey;

/// Bumped whenever the embedded DDL changes; drives the `PRAGMA user_version`
/// migration in [`Store::open_with_key`]. Wave M3 ships v1.
pub const SCHEMA_VERSION: i64 = 1;

/// The default database file name inside the app data directory.
pub const DB_FILE_NAME: &str = "agent.db";

/// A store failure. Every variant maps to a fixed, non-sensitive log code —
/// the source error (which could echo SQL text or a keychain detail) is never
/// carried, mirroring [`crate::auth::AuthError`] so nothing secret-ish can
/// leak through an error chain or a `Debug` print.
#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    /// Opening or creating the database file failed.
    Open,
    /// Applying the embedded schema/migration failed.
    Migrate,
    /// A read/write query failed.
    Query,
    /// AES-GCM encrypt/decrypt failed (wrong key, tamper, truncation, RNG).
    Crypto,
    /// Reading or writing the key in the OS keychain failed, or the stored key
    /// is malformed.
    Keychain,
    /// Serializing/deserializing a JSON payload failed.
    Encode,
    /// The connection mutex was poisoned by a panic on another thread.
    Poisoned,
}

impl StoreError {
    /// Stable log code (spec §23.1 permits error codes, never payloads).
    pub fn code(&self) -> &'static str {
        match self {
            StoreError::Open => "store_open_failed",
            StoreError::Migrate => "store_migrate_failed",
            StoreError::Query => "store_query_failed",
            StoreError::Crypto => "store_crypto_failed",
            StoreError::Keychain => "store_keychain_failed",
            StoreError::Encode => "store_encode_failed",
            StoreError::Poisoned => "store_lock_poisoned",
        }
    }
}

/// The encrypted local store. Owns one SQLite connection (serialized behind a
/// mutex — the agent's writers are low-frequency) and the in-memory payload
/// key. Constructed via [`Store::open`] (production, keychain-backed key) or
/// [`Store::open_with_key`] (tests, injected key).
pub struct Store {
    conn: Mutex<Connection>,
    key: DbKey,
}

impl Store {
    /// Open (creating if absent) the store at `path`, using the keychain-backed
    /// payload key ([`crypto::load_or_create_db_key`]). This is the production
    /// entry point.
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let key = crypto::load_or_create_db_key()?;
        Self::open_with_key(path, key)
    }

    /// Open (creating if absent) the store at `path` with an explicitly
    /// supplied key. Used by tests to reopen the same file with the same key
    /// deterministically (the mock keychain does not persist across `Entry`
    /// instances, so production key loading is tested separately).
    pub fn open_with_key(path: &Path, key: DbKey) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| StoreError::Open)?;
        }
        let conn = Connection::open(path).map_err(|_| StoreError::Open)?;
        Self::init(conn, key)
    }

    /// Open an in-memory store (tests only) with an injected key.
    #[cfg(test)]
    pub fn open_in_memory(key: DbKey) -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory().map_err(|_| StoreError::Open)?;
        Self::init(conn, key)
    }

    /// Shared open path: pragmas, migration, and wiring the mutex + key.
    fn init(conn: Connection, key: DbKey) -> Result<Self, StoreError> {
        // WAL + FULL sync: durable commits (the queue-before-checkpoint rule
        // depends on a commit being on disk before the next step) with good
        // concurrent-read behaviour. `foreign_keys` on for referential
        // integrity. Set via `execute_batch` (not `pragma_update`) because
        // `journal_mode` returns the resulting mode as a row — `pragma_update`
        // would treat that as an unexpected result and error. `execute_batch`
        // ignores returned rows and is a no-op WAL for `:memory:` DBs.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|_| StoreError::Open)?;

        migrate(&conn)?;
        Ok(Store {
            conn: Mutex::new(conn),
            key,
        })
    }

    /// Lock the connection, mapping poisoning to a fixed error code.
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.conn.lock().map_err(|_| StoreError::Poisoned)
    }
}

/// Run the embedded DDL forward from the file's current `user_version` to
/// [`SCHEMA_VERSION`]. The DDL is idempotent (`IF NOT EXISTS`), so this is safe
/// on both a fresh file and a reopen.
fn migrate(conn: &Connection) -> Result<(), StoreError> {
    let current: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| StoreError::Migrate)?;

    if current < 1 {
        conn.execute_batch(SCHEMA_V1)
            .map_err(|_| StoreError::Migrate)?;
    }

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|_| StoreError::Migrate)?;
    Ok(())
}

/// The spec §13.1 tables. All timestamps are epoch milliseconds (`INTEGER`).
/// The ONLY column that ever holds activity content is
/// `pending_events.payload`, a `BLOB` of AES-GCM ciphertext — there is
/// deliberately no plaintext text column for content anywhere.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS installation_state (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    installation_id        TEXT    NOT NULL,
    schema_version         INTEGER NOT NULL,
    privacy_policy_version TEXT    NOT NULL,
    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_state (
    connector_id    TEXT PRIMARY KEY,
    status          TEXT NOT NULL,
    last_run_at     INTEGER,
    last_error_code TEXT,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_checkpoints (
    connector_id TEXT PRIMARY KEY,
    checkpoint   TEXT    NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- The queue. `event_id` is the deterministic natural key the server dedups on
-- (spec §13.2 / §14.1): INSERT OR IGNORE makes local re-enqueue idempotent.
-- `payload` is AES-GCM ciphertext of the bounded analytics-feature JSON — the
-- ONLY content-bearing column, and a BLOB, so no raw text can be stored here.
CREATE TABLE IF NOT EXISTS pending_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT    NOT NULL UNIQUE,
    connector_id TEXT    NOT NULL,
    event_type   TEXT    NOT NULL,
    content_mode TEXT    NOT NULL DEFAULT 'analytics_only',
    occurred_at  INTEGER NOT NULL,
    enqueued_at  INTEGER NOT NULL,
    payload      BLOB    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_events_enqueued_at
    ON pending_events (enqueued_at);

CREATE TABLE IF NOT EXISTS upload_receipts (
    batch_id      TEXT PRIMARY KEY,
    uploaded_at   INTEGER NOT NULL,
    event_count   INTEGER NOT NULL,
    server_status TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_receipts_uploaded_at
    ON upload_receipts (uploaded_at);

CREATE TABLE IF NOT EXISTS policy_cache (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    effective_json TEXT    NOT NULL,
    policy_version TEXT    NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_config_cache (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    config_json    TEXT    NOT NULL,
    signature      TEXT    NOT NULL,
    config_version TEXT    NOT NULL,
    issued_at      INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    fetched_at     INTEGER NOT NULL
);

-- Counts/enums only (spec §23.2): a diagnostics row can never carry a payload.
CREATE TABLE IF NOT EXISTS diagnostics_state (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    kind       TEXT    NOT NULL,
    detail     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnostics_state_created_at
    ON diagnostics_state (created_at);

CREATE TABLE IF NOT EXISTS update_state (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    current_version   TEXT    NOT NULL,
    available_version TEXT,
    channel           TEXT    NOT NULL,
    rollout_state     TEXT    NOT NULL,
    mandatory         INTEGER NOT NULL DEFAULT 0,
    checked_at        INTEGER NOT NULL
);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> DbKey {
        DbKey::from_bytes([3u8; crypto::KEY_LEN])
    }

    /// Every spec §13.1 table exists after open.
    #[test]
    fn open_creates_all_spec_tables() {
        let store = Store::open_in_memory(key()).unwrap();
        let guard = store.lock().unwrap();
        let expected = [
            "installation_state",
            "connector_state",
            "connector_checkpoints",
            "pending_events",
            "upload_receipts",
            "policy_cache",
            "remote_config_cache",
            "diagnostics_state",
            "update_state",
        ];
        for table in expected {
            let count: i64 = guard
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table `{table}` must exist");
        }
    }

    #[test]
    fn migration_sets_user_version_and_is_idempotent_on_reopen() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-store-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        {
            let store = Store::open_with_key(&path, key()).unwrap();
            let guard = store.lock().unwrap();
            let version: i64 = guard
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            assert_eq!(version, SCHEMA_VERSION);
        }
        // Reopening the same file re-runs migrate() with current == SCHEMA_VERSION
        // (no-op) and still succeeds.
        {
            let store = Store::open_with_key(&path, key()).unwrap();
            let guard = store.lock().unwrap();
            let version: i64 = guard
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            assert_eq!(version, SCHEMA_VERSION);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn error_codes_are_present_and_non_secret() {
        for err in [
            StoreError::Open,
            StoreError::Migrate,
            StoreError::Query,
            StoreError::Crypto,
            StoreError::Keychain,
            StoreError::Encode,
            StoreError::Poisoned,
        ] {
            assert!(!err.code().is_empty());
        }
    }
}
