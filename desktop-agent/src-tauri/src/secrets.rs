//! OS secure storage for the device token (spec §8.3, §22.1).
//!
//! The device token lives ONLY here — the macOS Keychain / Windows Credential
//! Manager, via the `keyring` crate. It is NEVER written to SQLite, config
//! files, logs, crash reports, or the frontend. The only thing anything
//! outside this module can learn is the BOOLEAN "is a token present"
//! ([`has_token`], surfaced to the UI as `is_signed_in`) — never the value.
//!
//! There is deliberately no `get_token` exposed to the frontend and no Tauri
//! command that returns the secret; later waves read it Rust-side (sync
//! upload) via [`get_token`], which is `pub(crate)` on purpose.
//!
//! The real OS stores persist by `(service, user)`, so each call constructs a
//! fresh [`Entry`] for the fixed key — that is the single stored credential.
//! The `Ok(None)`/no-op mappings and the value round-trip live in
//! [`read_token`]/[`remove_token`], which the tests exercise against the
//! in-memory mock keystore.

use keyring::{Entry, Error};

/// Keychain service name — the app bundle identifier (matches
/// tauri.conf.json `identifier`).
const SERVICE: &str = "com.revealyst.desktop";

/// Fixed account under the service. One device token per install; a second
/// pairing overwrites it (re-enrollment), never accumulates entries.
const ACCOUNT: &str = "device-token";

/// Fixed account for the local-store payload-encryption key (plan T3.2). A
/// SEPARATE keychain entry from the device token so the two secrets are
/// independent — the store key is generated on first store init and is the
/// AES-256-GCM key that encrypts the queued analytics payloads. It never
/// touches the database, config, logs, or the frontend.
const DB_KEY_ACCOUNT: &str = "db-encryption-key";

fn entry() -> Result<Entry, Error> {
    Entry::new(SERVICE, ACCOUNT)
}

fn db_key_entry() -> Result<Entry, Error> {
    Entry::new(SERVICE, DB_KEY_ACCOUNT)
}

/// Read the token from a specific entry, mapping "no credential" to `Ok(None)`
/// — absence is a normal state, not an error.
fn read_token(entry: &Entry) -> Result<Option<String>, Error> {
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(other) => Err(other),
    }
}

/// Delete the credential behind a specific entry, treating absence as success
/// (deleting nothing is a no-op, not an error).
fn remove_token(entry: &Entry) -> Result<(), Error> {
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(other) => Err(other),
    }
}

/// Store (or overwrite) the device token in the OS secure store.
pub fn store_token(token: &str) -> Result<(), Error> {
    entry()?.set_password(token)
}

/// Read the device token, if one is stored. `Ok(None)` when nothing is
/// enrolled.
///
/// `pub(crate)`: the sync path (a later wave) needs the value Rust-side, but
/// it must never cross the Tauri command boundary to the frontend.
pub(crate) fn get_token() -> Result<Option<String>, Error> {
    read_token(&entry()?)
}

/// Whether a device token is present. This is the ONLY signed-in signal the
/// frontend is allowed to observe (via the `is_signed_in` command) — a
/// boolean, never the token itself.
pub fn has_token() -> bool {
    matches!(get_token(), Ok(Some(_)))
}

/// Remove the stored device token (sign-out / re-enrollment). Absence is
/// success.
pub fn delete_token() -> Result<(), Error> {
    remove_token(&entry()?)
}

/// Store (or overwrite) the base64-encoded local-store encryption key. Called
/// once at first store init (plan T3.2); a distinct account from the device
/// token.
pub(crate) fn store_db_key(encoded: &str) -> Result<(), Error> {
    db_key_entry()?.set_password(encoded)
}

/// Read the base64-encoded local-store encryption key, if one exists.
/// `Ok(None)` on first run, before the store has been initialised.
///
/// `pub(crate)`: the store (`crate::store::crypto`) needs the value Rust-side,
/// but like the device token it must never cross the Tauri command boundary.
pub(crate) fn get_db_key() -> Result<Option<String>, Error> {
    read_token(&db_key_entry()?)
}

/// Remove the stored local-store encryption key. Absence is success. Wiping it
/// makes the encrypted payloads unrecoverable by design (disconnect/reset).
pub fn delete_db_key() -> Result<(), Error> {
    remove_token(&db_key_entry()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// Route all keyring access in this binary through the in-memory mock
    /// store (always available in keyring v3, no feature flag) so tests never
    /// touch the real OS credential store. Must run before the first
    /// `Entry::new`; the `Once` makes concurrent tests safe.
    fn init_mock() {
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    /// Store → read → overwrite → delete round-trip. The mock keystore holds
    /// its value inside the `Entry` instance (no cross-instance persistence),
    /// so the round-trip runs against ONE entry — which is exactly how the
    /// real OS store behaves for a fixed `(service, user)`.
    #[test]
    fn token_round_trips_and_maps_absence() {
        init_mock();
        let entry = entry().expect("mock entry builds");

        // Nothing stored yet: read is None, delete is a no-op success.
        assert_eq!(
            read_token(&entry).unwrap(),
            None,
            "absent → None, not an error"
        );
        remove_token(&entry).expect("deleting nothing is a no-op success");

        // Store and read the exact value back.
        entry.set_password("rva1.org.conn.super-secret").unwrap();
        assert_eq!(
            read_token(&entry).unwrap().as_deref(),
            Some("rva1.org.conn.super-secret"),
            "the exact token round-trips back out"
        );

        // Overwrite (re-enrollment) replaces, never accumulates.
        entry.set_password("rva1.org.conn.second").unwrap();
        assert_eq!(
            read_token(&entry).unwrap().as_deref(),
            Some("rva1.org.conn.second")
        );

        // Delete, then absence maps back to None; a second delete is a no-op.
        remove_token(&entry).expect("delete succeeds");
        assert_eq!(read_token(&entry).unwrap(), None);
        remove_token(&entry).expect("second delete is a no-op");
    }

    /// The public wrappers report "not signed in" on a machine with no stored
    /// token (each builds a fresh, empty mock entry — the never-enrolled path).
    #[test]
    fn public_api_reports_absent_when_never_enrolled() {
        init_mock();
        assert!(!has_token(), "has_token is false with nothing stored");
        assert_eq!(get_token().unwrap(), None);
        delete_token().expect("delete_token is a no-op when absent");
    }

    /// The DB-key entry round-trips on a single entry (the mock keystore has no
    /// cross-`Entry` persistence, exactly like the device-token test) and is a
    /// DISTINCT account from the device token — storing one never surfaces via
    /// the other.
    #[test]
    fn db_key_round_trips_on_its_own_account() {
        init_mock();
        let db = db_key_entry().expect("mock db-key entry builds");

        assert_eq!(read_token(&db).unwrap(), None, "absent → None");
        db.set_password("YmFzZTY0LWtleQ==").unwrap();
        assert_eq!(
            read_token(&db).unwrap().as_deref(),
            Some("YmFzZTY0LWtleQ==")
        );
        remove_token(&db).expect("delete succeeds");
        assert_eq!(read_token(&db).unwrap(), None);
    }

    /// The device-token and DB-key accounts are different strings, so the two
    /// secrets can never collide in the OS store.
    #[test]
    fn db_key_and_token_accounts_are_distinct() {
        assert_ne!(ACCOUNT, DB_KEY_ACCOUNT);
    }
}
