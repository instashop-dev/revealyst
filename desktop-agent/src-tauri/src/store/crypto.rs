//! Application-layer payload encryption for the local store (spec §13, risk #3
//! fallback).
//!
//! ## Encryption decision (plan T3.2, risk #3)
//!
//! We do **not** use SQLCipher. The chosen design is the plan's RECORDED
//! FALLBACK: a plain `rusqlite` `bundled` SQLite database in an OS-protected
//! app directory, with **application-layer AES-256-GCM field encryption** on
//! the sensitive payload column(s). See [`super`] for the rationale and the
//! privacy-disclosure delta this obligates on the T5.4 privacy screen.
//!
//! The 32-byte key is generated once with the OS CSPRNG at first store init
//! and lives ONLY in the OS keychain (via [`crate::secrets`], a NEW account
//! distinct from the device token). It is never written to the database, a
//! config file, or a log line. Losing the keychain entry makes the encrypted
//! payloads unrecoverable by design.
//!
//! On-disk value layout for one encrypted field:
//!
//! ```text
//! [ 12-byte random nonce | AES-256-GCM ciphertext + 16-byte tag ]
//! ```
//!
//! A fresh nonce is drawn per encryption, so identical plaintexts never
//! produce identical ciphertext and a copied database file leaks no equality
//! structure over the payloads.

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

use super::StoreError;

/// AES-256 key length in bytes.
pub const KEY_LEN: usize = 32;

/// AES-GCM nonce length in bytes (96-bit, the standard for GCM).
pub const NONCE_LEN: usize = 12;

/// The 32-byte database payload-encryption key, held in memory for the life of
/// an open [`super::Store`]. Deliberately NOT `Debug`/`Serialize`/`Clone`-print
/// — it must never reach a log line or the frontend.
pub struct DbKey([u8; KEY_LEN]);

impl DbKey {
    /// Wrap raw key bytes (used by tests that inject a fixed key).
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        DbKey(bytes)
    }

    /// Encrypt `plaintext` into `nonce || ciphertext+tag`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, StoreError> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).map_err(|_| StoreError::Crypto)?;
        let nonce = GenericArray::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| StoreError::Crypto)?;

        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypt a `nonce || ciphertext+tag` blob produced by [`Self::encrypt`].
    /// A truncated blob, a wrong key, or any tampering fails authentication
    /// and returns [`StoreError::Crypto`] — never partial plaintext.
    pub fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, StoreError> {
        if blob.len() < NONCE_LEN {
            return Err(StoreError::Crypto);
        }
        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0));
        let nonce = GenericArray::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| StoreError::Crypto)
    }
}

/// Load the store key from the OS keychain, generating and persisting a fresh
/// one on first run. The key is stored base64-encoded (the keychain holds
/// strings); the raw bytes never leave this process except into the keychain.
pub fn load_or_create_db_key() -> Result<DbKey, StoreError> {
    if let Some(encoded) = crate::secrets::get_db_key().map_err(|_| StoreError::Keychain)? {
        if let Some(key) = decode_key(&encoded) {
            return Ok(key);
        }
        // A malformed stored key is unrecoverable — refuse rather than silently
        // minting a new one, which would strand every existing encrypted row.
        return Err(StoreError::Keychain);
    }

    let mut bytes = [0u8; KEY_LEN];
    getrandom::getrandom(&mut bytes).map_err(|_| StoreError::Crypto)?;
    let encoded = STANDARD.encode(bytes);
    crate::secrets::store_db_key(&encoded).map_err(|_| StoreError::Keychain)?;
    Ok(DbKey(bytes))
}

/// Decode a base64 keychain string back into a 32-byte key, or `None` if it is
/// not exactly [`KEY_LEN`] bytes.
fn decode_key(encoded: &str) -> Option<DbKey> {
    let bytes = STANDARD.decode(encoded).ok()?;
    let array: [u8; KEY_LEN] = bytes.try_into().ok()?;
    Some(DbKey(array))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> DbKey {
        DbKey::from_bytes([7u8; KEY_LEN])
    }

    #[test]
    fn round_trips_plaintext() {
        let key = test_key();
        let plaintext = br#"{"promptWordCount":233,"taskCategory":"coding"}"#;
        let blob = key.encrypt(plaintext).unwrap();
        assert_eq!(key.decrypt(&blob).unwrap(), plaintext);
    }

    #[test]
    fn ciphertext_hides_the_plaintext_and_prepends_a_nonce() {
        let key = test_key();
        let plaintext = b"SENTINEL_PLAINTEXT_MARKER";
        let blob = key.encrypt(plaintext).unwrap();
        // Layout: nonce (12) + ciphertext + 16-byte GCM tag.
        assert!(blob.len() >= NONCE_LEN + plaintext.len() + 16);
        // The raw marker never appears in the encrypted bytes.
        assert!(!contains_subslice(&blob, plaintext));
    }

    #[test]
    fn distinct_nonces_make_ciphertext_non_deterministic() {
        let key = test_key();
        let plaintext = b"same input every time";
        let a = key.encrypt(plaintext).unwrap();
        let b = key.encrypt(plaintext).unwrap();
        assert_ne!(a, b, "a fresh nonce must randomize the ciphertext");
        // Both still decrypt back to the same plaintext.
        assert_eq!(key.decrypt(&a).unwrap(), plaintext);
        assert_eq!(key.decrypt(&b).unwrap(), plaintext);
    }

    #[test]
    fn wrong_key_fails_authentication() {
        let blob = test_key().encrypt(b"secret").unwrap();
        let other = DbKey::from_bytes([9u8; KEY_LEN]);
        assert!(matches!(other.decrypt(&blob), Err(StoreError::Crypto)));
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = test_key();
        let mut blob = key.encrypt(b"secret").unwrap();
        // Flip a bit in the ciphertext body (past the nonce).
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(matches!(key.decrypt(&blob), Err(StoreError::Crypto)));
    }

    #[test]
    fn truncated_blob_is_rejected() {
        let key = test_key();
        assert!(matches!(key.decrypt(&[0u8; 4]), Err(StoreError::Crypto)));
        assert!(matches!(key.decrypt(&[]), Err(StoreError::Crypto)));
    }

    #[test]
    fn base64_key_round_trips() {
        let bytes = [42u8; KEY_LEN];
        let encoded = STANDARD.encode(bytes);
        let decoded = decode_key(&encoded).expect("valid base64 key decodes");
        // The decoded key encrypts/decrypts identically to the source bytes.
        let src = DbKey::from_bytes(bytes);
        let blob = src.encrypt(b"x").unwrap();
        assert_eq!(decoded.decrypt(&blob).unwrap(), b"x");
    }

    #[test]
    fn decode_rejects_wrong_length_and_garbage() {
        assert!(decode_key("not base64 !!!").is_none());
        assert!(
            decode_key(&STANDARD.encode([0u8; 16])).is_none(),
            "16 bytes is too short"
        );
        assert!(
            decode_key(&STANDARD.encode([0u8; 64])).is_none(),
            "64 bytes is too long"
        );
    }

    fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }
}
