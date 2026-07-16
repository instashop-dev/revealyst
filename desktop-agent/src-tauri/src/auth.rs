//! PKCE pairing client (spec §8; backend contract: `src/lib/desktop-pairing.ts`
//! on the web app, ADR 0047).
//!
//! There is no OAuth server and no password form in the agent (spec §8.1). The
//! human authenticates in their system browser against an existing Revealyst
//! web session; the agent only proves possession of a PKCE verifier. The dance:
//!
//!   1. generate a PKCE verifier + its S256 challenge + a random CSRF `state`;
//!   2. `POST /api/desktop/auth/start` with the challenge + device metadata →
//!      receive a `pairingId` and the `browserUrl` to open;
//!   3. open `browserUrl` in the system browser and wait for the deep-link
//!      callback (validated in [`crate::deeplink`]) to deliver the one-time
//!      `code`;
//!   4. `POST /api/desktop/auth/exchange` with `{pairingId, code, codeVerifier}`
//!      → receive the `rva1.` device token EXACTLY once;
//!   5. store the token in the OS keychain ([`crate::secrets`]).
//!
//! Token discipline (spec §8.3, §23.1): the token exists only as a local in the
//! exchange step and is handed straight to the keychain. It is never logged,
//! never placed in a `Debug`/`Serialize` struct, and never returned to the
//! frontend — `begin_sign_in` yields only a boolean.

use std::path::Path;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::deeplink::{PendingAuth, PendingAuthStore};

/// Shipped default: the app + Better Auth origin (spec / `docs/infra.md`). A
/// dev or preview build overrides it at runtime with `REVEALYST_APP_ORIGIN`
/// (e.g. `http://localhost:3000` or a preview deploy) — the constant is the
/// only value a release build pairs against.
const DEFAULT_APP_ORIGIN: &str = "https://app.revealyst.com";

/// File name for the persisted installation id (non-secret) in the app config
/// dir. See [`load_or_create_installation_id`].
const INSTALLATION_ID_FILE: &str = "installation-id";

/// How long the agent waits for the browser round-trip before giving up. The
/// backend one-time code lives ≤10 minutes; 5 minutes is a comfortable window
/// for a human to sign in without stranding the flow forever.
const PAIRING_TIMEOUT: Duration = Duration::from_secs(300);

/// The configured app origin (env override, else the shipped default).
pub fn app_origin() -> String {
    std::env::var("REVEALYST_APP_ORIGIN").unwrap_or_else(|_| DEFAULT_APP_ORIGIN.to_string())
}

/// A fresh PKCE code verifier: 32 CSPRNG bytes → 43 base64url chars, inside
/// RFC 7636's 43–128 range and the backend's `[A-Za-z0-9_-]{43,128}` schema.
pub fn generate_verifier() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS CSPRNG must be available");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The S256 challenge for a verifier: `BASE64URL(SHA256(ascii(verifier)))`
/// (RFC 7636 §4.2). The backend recomputes this from the verifier at exchange.
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A random CSRF `state`: 16 CSPRNG bytes → 22 base64url chars, inside the
/// backend's `[A-Za-z0-9_-]{8,256}` schema. Echoed through the browser
/// redirect and matched on the callback (spec §8.2).
pub fn generate_state() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("OS CSPRNG must be available");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Locally-generated, stable install identity (spec §9.1: NOT derived from MAC
/// address, motherboard/disk serial, or any permanent hardware id). A random
/// UUID v4 persisted as a plain file in the app config dir — non-secret, so it
/// is deliberately NOT in the keychain. Returns the existing id if valid,
/// otherwise mints and persists a new one.
pub fn load_or_create_installation_id(config_dir: &Path) -> std::io::Result<String> {
    let path = config_dir.join(INSTALLATION_ID_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if Uuid::parse_str(trimmed).is_ok() {
            return Ok(trimmed.to_string());
        }
    }
    let id = Uuid::new_v4().to_string();
    std::fs::create_dir_all(config_dir)?;
    std::fs::write(&path, &id)?;
    Ok(id)
}

/// Backend `platform` enum value for this OS. Phase 1 ships macOS + Windows;
/// anything else falls back to `windows` (never a shipped target).
pub fn platform_string() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        _ => "windows",
    }
}

/// Backend `architecture` enum value for this build.
pub fn architecture_string() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        _ => "x64",
    }
}

/// A human-friendly device name from the hostname, clamped to the backend's
/// 1–80 char bound. Falls back to a generic label if the hostname is empty or
/// unreadable — never fails.
pub fn device_display_name() -> String {
    let raw = hostname::get()
        .ok()
        .and_then(|name| name.into_string().ok())
        .unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Revealyst device".to_string();
    }
    trimmed.chars().take(80).collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest<'a> {
    code_challenge: &'a str,
    state: &'a str,
    device_display_name: &'a str,
    platform: &'a str,
    architecture: &'a str,
    agent_version: &'a str,
    installation_id: &'a str,
}

/// The fields of the start response the agent uses. `expiresAt` is present on
/// the wire and intentionally ignored (serde drops unknown fields).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartResponse {
    pairing_id: String,
    browser_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeRequest<'a> {
    pairing_id: &'a str,
    code: &'a str,
    code_verifier: &'a str,
}

/// The exchange response. Deliberately NOT `Debug`/`Serialize`: the `token`
/// field is the device secret and must never be formatted or logged. Only
/// `token` is read (straight into the keychain); `deviceId`/`orgId` are
/// ignored.
#[derive(serde::Deserialize)]
struct ExchangeResponse {
    token: String,
}

/// A pairing failure. Every variant maps to a fixed, non-sensitive log code
/// and a plain-English user message — no source error is carried, so a token
/// or URL can never leak through an error chain.
#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    Config,
    Network,
    BadBrowserUrl,
    OpenBrowser,
    TimedOut,
    Storage,
}

impl AuthError {
    /// Stable log code (spec §23.1 permits error codes, never payloads).
    pub fn code(&self) -> &'static str {
        match self {
            AuthError::Config => "config_unavailable",
            AuthError::Network => "network_failure",
            AuthError::BadBrowserUrl => "bad_browser_url",
            AuthError::OpenBrowser => "open_browser_failed",
            AuthError::TimedOut => "pairing_timed_out",
            AuthError::Storage => "keychain_store_failed",
        }
    }

    /// Beginner-friendly message shown in the UI (CLAUDE.md writing rules).
    pub fn user_message(&self) -> &'static str {
        match self {
            AuthError::Config => "Something went wrong preparing sign-in. Please try again.",
            AuthError::Network => "Couldn't reach Revealyst. Check your connection and try again.",
            AuthError::BadBrowserUrl | AuthError::OpenBrowser => {
                "Couldn't open your browser to sign in. Please try again."
            }
            AuthError::TimedOut => "Sign-in timed out. Please try again.",
            AuthError::Storage => "Couldn't finish signing in on this computer. Please try again.",
        }
    }
}

/// Run the full PKCE pairing dance. On success the device token is in the OS
/// keychain and the agent is signed in; the token never leaves this function
/// except into the keychain.
pub async fn run_pairing<R: Runtime>(app: &AppHandle<R>) -> Result<(), AuthError> {
    let origin = app_origin();

    let verifier = generate_verifier();
    let challenge = challenge_for(&verifier);
    let state = generate_state();

    let config_dir = app.path().app_config_dir().map_err(|_| AuthError::Config)?;
    let installation_id =
        load_or_create_installation_id(&config_dir).map_err(|_| AuthError::Config)?;
    let display_name = device_display_name();

    let client = reqwest::Client::new();

    // 1. start — submit the challenge + device metadata.
    let start: StartResponse = client
        .post(format!("{origin}/api/desktop/auth/start"))
        .json(&StartRequest {
            code_challenge: &challenge,
            state: &state,
            device_display_name: &display_name,
            platform: platform_string(),
            architecture: architecture_string(),
            agent_version: crate::agent_version(),
            installation_id: &installation_id,
        })
        .send()
        .await
        .map_err(|_| AuthError::Network)?
        .error_for_status()
        .map_err(|_| AuthError::Network)?
        .json()
        .await
        .map_err(|_| AuthError::Network)?;

    // Open-redirect guard: the URL to open must be on the origin we posted to
    // (the backend builds it from the request origin). Never open an arbitrary
    // URL the response could contain.
    if !is_same_origin(&start.browser_url, &origin) {
        return Err(AuthError::BadBrowserUrl);
    }

    // 2. arm the callback slot BEFORE opening the browser, so a fast redirect
    // can never race ahead of the waiter.
    let (tx, rx) = oneshot::channel();
    let store = app.state::<PendingAuthStore>();
    store.arm(PendingAuth {
        expected_state: state,
        expected_pairing: start.pairing_id.clone(),
        sender: tx,
    });

    // 3. open the browser to the consent page.
    if app
        .opener()
        .open_url(&start.browser_url, None::<&str>)
        .is_err()
    {
        store.clear();
        return Err(AuthError::OpenBrowser);
    }

    // 4. wait for the validated callback to deliver the one-time code.
    let code = match tokio::time::timeout(PAIRING_TIMEOUT, rx).await {
        Ok(Ok(code)) => code,
        _ => {
            // Timed out, or the sender was dropped (e.g. re-armed by a retry).
            store.clear();
            return Err(AuthError::TimedOut);
        }
    };

    // 5. exchange the code + verifier for the device token.
    let exchange: ExchangeResponse = client
        .post(format!("{origin}/api/desktop/auth/exchange"))
        .json(&ExchangeRequest {
            pairing_id: &start.pairing_id,
            code: &code,
            code_verifier: &verifier,
        })
        .send()
        .await
        .map_err(|_| AuthError::Network)?
        .error_for_status()
        .map_err(|_| AuthError::Network)?
        .json()
        .await
        .map_err(|_| AuthError::Network)?;

    // 6. store the token in the OS keychain — its only resting place. No log
    // line, here or anywhere, ever carries the value.
    crate::secrets::store_token(&exchange.token).map_err(|_| AuthError::Storage)?;

    tracing::info!(
        component = "auth",
        // deviceDisplayName/platform are non-secret device metadata; the token
        // is deliberately absent.
        platform = platform_string(),
        "device paired and signed in"
    );
    Ok(())
}

/// Whether `url` is on `origin` (scheme + authority match). Used to refuse
/// opening anything other than the consent page on our own origin.
fn is_same_origin(url: &str, origin: &str) -> bool {
    if url == origin {
        return true;
    }
    let prefix = format!("{origin}/");
    url.starts_with(prefix.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s256_challenge_matches_rfc7636_test_vector() {
        // RFC 7636 Appendix B known-answer vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(challenge_for(verifier), expected);
    }

    #[test]
    fn verifier_is_base64url_within_length_bounds() {
        for _ in 0..64 {
            let verifier = generate_verifier();
            assert!(
                (43..=128).contains(&verifier.len()),
                "verifier length {} out of RFC 7636 range",
                verifier.len()
            );
            assert!(
                verifier
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "verifier must be base64url (no padding): {verifier}"
            );
        }
    }

    #[test]
    fn state_is_base64url_within_backend_bounds() {
        for _ in 0..64 {
            let state = generate_state();
            assert!(
                (8..=256).contains(&state.len()),
                "state length {} out of backend range",
                state.len()
            );
            assert!(state
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        }
    }

    #[test]
    fn distinct_verifiers_and_states_each_call() {
        assert_ne!(generate_verifier(), generate_verifier());
        assert_ne!(generate_state(), generate_state());
    }

    #[test]
    fn platform_and_architecture_are_backend_enum_values() {
        assert!(matches!(platform_string(), "macos" | "windows"));
        assert!(matches!(architecture_string(), "arm64" | "x64"));
    }

    #[test]
    fn device_display_name_is_non_empty_and_within_bound() {
        let name = device_display_name();
        assert!(!name.is_empty());
        assert!(name.chars().count() <= 80);
    }

    #[test]
    fn installation_id_is_stable_and_a_valid_uuid() {
        let dir = std::env::temp_dir().join(format!(
            "revealyst-install-id-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);

        let first = load_or_create_installation_id(&dir).expect("mints an id");
        assert!(Uuid::parse_str(&first).is_ok(), "id is a valid UUID");

        let second = load_or_create_installation_id(&dir).expect("reads the id back");
        assert_eq!(first, second, "the id persists across calls");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_installation_id_file_is_replaced() {
        let dir = std::env::temp_dir().join(format!(
            "revealyst-install-id-corrupt-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(INSTALLATION_ID_FILE), "not-a-uuid").unwrap();

        let id = load_or_create_installation_id(&dir).expect("replaces the bad id");
        assert!(Uuid::parse_str(&id).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_origin_guard() {
        let origin = "https://app.revealyst.com";
        assert!(is_same_origin("https://app.revealyst.com", origin));
        assert!(is_same_origin(
            "https://app.revealyst.com/desktop/connect?pairing=x",
            origin
        ));
        // Suffix-spoof and cross-origin must fail.
        assert!(!is_same_origin(
            "https://app.revealyst.com.evil.com/x",
            origin
        ));
        assert!(!is_same_origin("https://evil.com/", origin));
    }

    #[test]
    fn error_codes_and_messages_are_present_and_non_secret() {
        for err in [
            AuthError::Config,
            AuthError::Network,
            AuthError::BadBrowserUrl,
            AuthError::OpenBrowser,
            AuthError::TimedOut,
            AuthError::Storage,
        ] {
            assert!(!err.code().is_empty());
            assert!(!err.user_message().is_empty());
        }
    }
}
