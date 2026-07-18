//! Short-lived access tokens (Desktop Agent M7 / T7.2, backend ADR 0058).
//!
//! The long-lived `rva1.` DEVICE token stays in the OS keychain and is now used
//! only as a REFRESH credential: the agent presents it to
//! `POST /api/desktop/auth/refresh` and receives a short-lived, signed ACCESS
//! token, which it then uses as the `Authorization: Bearer` on its ordinary
//! calls (ingest, diagnostics). A captured access token is worthless within
//! minutes; the powerful device token only ever travels to `/refresh`.
//!
//! The access token is **opaque** to the agent — it never decodes or verifies
//! it (the server that minted it is the only verifier). So there is NO new
//! crate: we treat it as a `String` and use the `expires_in` seconds the
//! `/refresh` response hands us to refresh EARLY, before expiry.
//!
//! Backward compatibility is the whole point: if `/refresh` is unavailable (an
//! old server → 404, a not-yet-configured server → 503, or any network error),
//! the agent falls back to sending the device token directly, exactly as it did
//! before this change. There is never a hard cutover.
//!
//! Security notes:
//! - The access token lives **in memory only** (this cache). It is never
//!   persisted and never written to the keychain.
//! - Neither the device token nor the access token is ever logged: the wire
//!   structs are deliberately not `Debug`, and no `tracing` line formats either.
//! - No Tauri command returns either token — the frontend only ever sees the
//!   `is_signed_in` boolean.

use std::sync::Mutex;

use serde::Deserialize;

/// Refresh the access token once fewer than this many seconds remain before it
/// expires, so an in-flight call never races the expiry boundary.
const REFRESH_MARGIN_SECS: i64 = 120;

/// Per-request timeout for the refresh call. Matches the sync/diagnostics 10s.
const REFRESH_TIMEOUT_SECS: u64 = 10;

/// The `/refresh` success body. Only the fields we need; unknown fields (e.g.
/// `audience`) are ignored. Deliberately not `Debug` — `access_token` is a
/// bearer credential.
#[derive(Deserialize)]
struct RefreshResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "expiresIn")]
    expires_in: i64,
}

/// A refreshed access token plus the wall-clock (epoch ms) at which it expires.
/// Not `Debug`/`Clone`-logged — `value` is a bearer credential.
pub struct AccessToken {
    value: String,
    expires_at_ms: i64,
}

impl AccessToken {
    /// True if the token is at or past its refresh threshold (expired, or within
    /// [`REFRESH_MARGIN_SECS`] of expiry). Pure — unit-tested without a network.
    fn needs_refresh(&self, now_ms: i64) -> bool {
        now_ms >= self.expires_at_ms - REFRESH_MARGIN_SECS * 1000
    }
}

/// Why a refresh did not yield an access token. All variants mean "fall back to
/// the device token" — kept distinct for honest logging only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshError {
    /// The server does not offer rotation yet (404) or has not configured the
    /// signing key (503). Expected during rollout — fall back quietly.
    NotAvailable,
    /// The device token was rejected (401/403). The next sync will surface
    /// `AuthenticationRequired` on its own; fall back for this call.
    AuthFailed,
    /// Network/timeout, or an unparseable success body.
    Network,
}

/// The refresh HTTP seam — mockable so the decision logic is unit-tested without
/// a network (mirrors `sync::IngestTransport`).
#[allow(async_fn_in_trait)]
pub trait RefreshTransport {
    /// POST the device token to `refresh_url`; return the fresh token on 200.
    async fn refresh(
        &self,
        refresh_url: &str,
        device_token: &str,
        now_ms: i64,
    ) -> Result<AccessToken, RefreshError>;
}

/// Production refresh transport over a one-shot `reqwest::Client`.
pub struct ReqwestRefreshTransport;

impl RefreshTransport for ReqwestRefreshTransport {
    async fn refresh(
        &self,
        refresh_url: &str,
        device_token: &str,
        now_ms: i64,
    ) -> Result<AccessToken, RefreshError> {
        let client = reqwest::Client::new();
        let result = client
            .post(refresh_url)
            .header("Authorization", format!("Bearer {device_token}"))
            .timeout(std::time::Duration::from_secs(REFRESH_TIMEOUT_SECS))
            .send()
            .await;

        let response = match result {
            Ok(response) => response,
            Err(_) => return Err(RefreshError::Network),
        };
        let status = response.status().as_u16();
        // 404 (old server, no route) / 503 (signing key not configured) → the
        // server simply has not enabled rotation; fall back to the device token.
        if status == 404 || status == 503 {
            return Err(RefreshError::NotAvailable);
        }
        if status == 401 || status == 403 {
            return Err(RefreshError::AuthFailed);
        }
        if !(200..300).contains(&status) {
            return Err(RefreshError::Network);
        }
        let body: RefreshResponse = match response.json().await {
            Ok(body) => body,
            Err(_) => return Err(RefreshError::Network),
        };
        Ok(AccessToken {
            value: body.access_token,
            expires_at_ms: now_ms + body.expires_in.max(0) * 1000,
        })
    }
}

/// In-memory cache of the current access token. Interior mutability so it lives
/// behind `&self` on the sync engine. Never persisted; never logged.
pub struct AccessTokenCache {
    inner: Mutex<Option<AccessToken>>,
}

impl AccessTokenCache {
    pub fn new() -> Self {
        AccessTokenCache {
            inner: Mutex::new(None),
        }
    }
}

impl Default for AccessTokenCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolve the bearer to send on an authenticated call: a valid cached access
/// token if we have one, otherwise refresh via the transport and cache it,
/// otherwise (any refresh failure) FALL BACK to the device token so the call
/// still authenticates during rollout. `refresh_url` empty → skip refresh
/// entirely and use the device token (the test/injection path).
///
/// Returns an owned `String` the caller passes as the bearer. The device token
/// argument is borrowed and never logged.
pub async fn bearer_for<R: RefreshTransport>(
    cache: &AccessTokenCache,
    transport: &R,
    refresh_url: &str,
    device_token: &str,
    now_ms: i64,
) -> String {
    if refresh_url.is_empty() {
        return device_token.to_string();
    }

    // Fast path: a still-fresh cached token.
    {
        let guard = cache.inner.lock().unwrap();
        if let Some(token) = guard.as_ref() {
            if !token.needs_refresh(now_ms) {
                return token.value.clone();
            }
        }
    }

    // Refresh. On any failure, fall back to the device token (never block a
    // sync on rotation being unavailable).
    match transport.refresh(refresh_url, device_token, now_ms).await {
        Ok(fresh) => {
            let value = fresh.value.clone();
            *cache.inner.lock().unwrap() = Some(fresh);
            value
        }
        Err(err) => {
            tracing::info!(
                component = "token",
                refresh = refresh_error_code(err),
                "access-token refresh unavailable; using device token"
            );
            device_token.to_string()
        }
    }
}

fn refresh_error_code(err: RefreshError) -> &'static str {
    match err {
        RefreshError::NotAvailable => "not_available",
        RefreshError::AuthFailed => "auth_failed",
        RefreshError::Network => "network",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn needs_refresh_is_false_for_a_fresh_token() {
        let token = AccessToken {
            value: "a".to_string(),
            expires_at_ms: NOW + 15 * 60 * 1000,
        };
        assert!(!token.needs_refresh(NOW));
    }

    #[test]
    fn needs_refresh_is_true_within_the_margin_and_past_expiry() {
        let near = AccessToken {
            value: "a".to_string(),
            expires_at_ms: NOW + 60 * 1000, // 60s left, margin is 120s
        };
        assert!(near.needs_refresh(NOW));
        let expired = AccessToken {
            value: "a".to_string(),
            expires_at_ms: NOW - 1,
        };
        assert!(expired.needs_refresh(NOW));
    }

    /// A scripted refresh transport: records how many times it was called and
    /// returns a canned result (cloned each call — `reply` is immutable).
    struct MockRefresh {
        reply: Result<(String, i64), RefreshError>,
        calls: Cell<u32>,
    }
    impl MockRefresh {
        fn ok(value: &str, expires_in: i64) -> Self {
            MockRefresh {
                reply: Ok((value.to_string(), expires_in)),
                calls: Cell::new(0),
            }
        }
        fn err(e: RefreshError) -> Self {
            MockRefresh {
                reply: Err(e),
                calls: Cell::new(0),
            }
        }
    }
    impl RefreshTransport for MockRefresh {
        async fn refresh(
            &self,
            _url: &str,
            _device_token: &str,
            now_ms: i64,
        ) -> Result<AccessToken, RefreshError> {
            self.calls.set(self.calls.get() + 1);
            match &self.reply {
                Ok((value, expires_in)) => Ok(AccessToken {
                    value: value.clone(),
                    expires_at_ms: now_ms + expires_in * 1000,
                }),
                Err(e) => Err(*e),
            }
        }
    }

    #[tokio::test]
    async fn uses_the_access_token_when_refresh_succeeds() {
        let cache = AccessTokenCache::new();
        let transport = MockRefresh::ok("access-xyz", 900);
        let bearer = bearer_for(
            &cache,
            &transport,
            "https://app/api/desktop/auth/refresh",
            "rva1.device",
            NOW,
        )
        .await;
        assert_eq!(bearer, "access-xyz");
        assert_eq!(transport.calls.get(), 1);
    }

    #[tokio::test]
    async fn caches_the_access_token_across_calls_without_refreshing_again() {
        let cache = AccessTokenCache::new();
        let transport = MockRefresh::ok("access-xyz", 900);
        let url = "https://app/api/desktop/auth/refresh";
        let first = bearer_for(&cache, &transport, url, "rva1.device", NOW).await;
        // A moment later, still well before expiry: served from cache, no refresh.
        let second = bearer_for(&cache, &transport, url, "rva1.device", NOW + 1000).await;
        assert_eq!(first, "access-xyz");
        assert_eq!(second, "access-xyz");
        assert_eq!(transport.calls.get(), 1, "second call must hit the cache");
    }

    #[tokio::test]
    async fn falls_back_to_the_device_token_when_refresh_is_unavailable() {
        let cache = AccessTokenCache::new();
        let transport = MockRefresh::err(RefreshError::NotAvailable);
        let bearer = bearer_for(
            &cache,
            &transport,
            "https://app/api/desktop/auth/refresh",
            "rva1.device-token",
            NOW,
        )
        .await;
        assert_eq!(bearer, "rva1.device-token");
    }

    #[tokio::test]
    async fn falls_back_to_the_device_token_on_auth_failure() {
        let cache = AccessTokenCache::new();
        let transport = MockRefresh::err(RefreshError::AuthFailed);
        let bearer = bearer_for(
            &cache,
            &transport,
            "https://app/api/desktop/auth/refresh",
            "rva1.device-token",
            NOW,
        )
        .await;
        assert_eq!(bearer, "rva1.device-token");
    }

    #[tokio::test]
    async fn empty_refresh_url_skips_refresh_and_uses_the_device_token() {
        let cache = AccessTokenCache::new();
        let transport = MockRefresh::ok("access-xyz", 900);
        let bearer = bearer_for(&cache, &transport, "", "rva1.device-token", NOW).await;
        assert_eq!(bearer, "rva1.device-token");
        assert_eq!(transport.calls.get(), 0, "no refresh when url is empty");
    }
}
