//! Deep-link callback handling for the `revealyst://` scheme (spec §8.2,
//! §26.4 items 1–2).
//!
//! The web consent step redirects to
//! `revealyst://desktop-auth/callback?code=…&state=…&pairing=…`. This module
//! parses and validates that URL entirely on the Rust side — the frontend has
//! no deep-link capability and can never see the raw URL or the one-time code.
//!
//! Validation, in order (a callback that fails any check never yields a code):
//!   1. well-formed URL, `revealyst` scheme, host `desktop-auth`, path
//!      `/callback` — anything else is a malicious/mistaken link (§26.4 #1);
//!   2. `state` equals the value the in-flight sign-in generated — a CSRF /
//!      injected-callback guard (§26.4 #2);
//!   3. single-fire — a matching callback consumes the pending slot, so a
//!      replayed link finds nothing and is ignored.
//!
//! The pure pieces ([`parse_callback`], [`PendingAuthStore::handle`],
//! [`first_scheme_url`]) carry no Tauri types so they are unit-testable
//! without a running app.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::sync::oneshot;
use url::Url;

use crate::logging::Redact;

/// The custom URI scheme the agent registers.
pub const SCHEME: &str = "revealyst";

/// The callback authority (host) — the redirect is
/// `revealyst://desktop-auth/callback`.
const CALLBACK_HOST: &str = "desktop-auth";

/// The callback path. Parsed by the `url` crate as `/callback` (leading
/// slash). Any other path is rejected.
const CALLBACK_PATH: &str = "/callback";

/// The three query parameters carried on the callback. `pairing` is optional
/// on the wire (the authoritative pairing id comes from the start response);
/// when present it is cross-checked as defence in depth.
///
/// `Debug` is a MANUAL redacting impl, not a derive: `code` is the one-time
/// secret and `state` the CSRF token, so neither may ever reach a log line —
/// even via a future `tracing::debug!(?params)` (token-discipline footgun,
/// spec §23.1). `pairing` is a non-secret handle and shown as-is.
#[derive(PartialEq, Eq)]
pub struct CallbackParams {
    pub code: String,
    pub state: String,
    pub pairing: Option<String>,
}

impl fmt::Debug for CallbackParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CallbackParams")
            .field("code", &Redact(&self.code))
            .field("state", &Redact(&self.state))
            .field("pairing", &self.pairing)
            .finish()
    }
}

/// Why a callback URL was not accepted. Every reason is a fixed,
/// non-sensitive string safe to log (never the URL, which carries the code).
#[derive(Debug, PartialEq, Eq)]
pub enum CallbackError {
    Malformed,
    BadScheme,
    BadPath,
    MissingCode,
    MissingState,
}

impl CallbackError {
    /// Stable log/error code (spec §23.1 allows error codes, never payloads).
    pub fn reason(&self) -> &'static str {
        match self {
            CallbackError::Malformed => "malformed_url",
            CallbackError::BadScheme => "bad_scheme",
            CallbackError::BadPath => "bad_path",
            CallbackError::MissingCode => "missing_code",
            CallbackError::MissingState => "missing_state",
        }
    }
}

/// Parse and structurally validate a deep-link callback URL. Pure — no state,
/// no side effects. Rejects anything that is not exactly
/// `revealyst://desktop-auth/callback` carrying `code` and `state`.
pub fn parse_callback(raw: &str) -> Result<CallbackParams, CallbackError> {
    let url = Url::parse(raw).map_err(|_| CallbackError::Malformed)?;
    if url.scheme() != SCHEME {
        return Err(CallbackError::BadScheme);
    }
    // Host AND path must match exactly — reject `revealyst://evil/callback`
    // and `revealyst://desktop-auth/anything-else` alike.
    if url.host_str() != Some(CALLBACK_HOST) || url.path() != CALLBACK_PATH {
        return Err(CallbackError::BadPath);
    }

    let mut code = None;
    let mut state = None;
    let mut pairing = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "pairing" => pairing = Some(value.into_owned()),
            _ => {}
        }
    }

    Ok(CallbackParams {
        code: code.ok_or(CallbackError::MissingCode)?,
        state: state.ok_or(CallbackError::MissingState)?,
        pairing,
    })
}

/// A sign-in awaiting its browser callback. Holds the `state`/`pairing` the
/// agent generated and the channel the code is delivered on.
struct PendingAuth {
    /// Monotonic id identifying THIS flow, so a stale flow's cleanup can only
    /// clear its own pending (see [`PendingAuthStore::clear_if`]).
    generation: u64,
    expected_state: String,
    expected_pairing: String,
    /// Delivers the one-time `code` to the waiting [`crate::auth`] flow.
    sender: oneshot::Sender<String>,
}

/// The outcome of handling one incoming callback URL — used only for logging.
#[derive(Debug, PartialEq, Eq)]
pub enum CallbackOutcome {
    /// State matched a pending sign-in; the code was delivered.
    Accepted,
    /// No pending sign-in (or the waiter already gave up / a replay).
    Ignored,
    /// A pending sign-in exists but this callback failed a check.
    Rejected(&'static str),
}

/// The single in-flight pending sign-in. At most one pairing runs at a time
/// (the UI drives one), so a single slot is sufficient and keeps single-fire
/// semantics trivial: a match `take`s the slot.
///
/// Each arm stamps the pending with a monotonic generation id so cleanup is
/// ownership-scoped: a timed-out flow can only clear ITS OWN pending, never a
/// newer flow that re-armed the slot. Single-fire correctness therefore does
/// not rest on the UI serializing sign-ins.
pub struct PendingAuthStore {
    slot: Mutex<Option<PendingAuth>>,
    next_generation: AtomicU64,
}

impl Default for PendingAuthStore {
    fn default() -> Self {
        Self {
            slot: Mutex::new(None),
            next_generation: AtomicU64::new(1),
        }
    }
}

impl PendingAuthStore {
    /// Arm the store for a new sign-in, returning the generation id that
    /// identifies THIS flow (pass it to [`Self::clear_if`] on cleanup).
    /// Replaces any prior pending (the old waiter's receiver drops and that
    /// flow errors out with a timeout).
    pub fn arm(
        &self,
        expected_state: String,
        expected_pairing: String,
        sender: oneshot::Sender<String>,
    ) -> u64 {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        *self.slot.lock().expect("pending-auth mutex poisoned") = Some(PendingAuth {
            generation,
            expected_state,
            expected_pairing,
            sender,
        });
        generation
    }

    /// Drop the pending sign-in ONLY if the slot still holds `generation` —
    /// so a stale flow's timeout/drop cleanup never wipes a newer flow's
    /// pending. A no-op if a newer flow (or a completed callback) already
    /// replaced/consumed the slot.
    pub fn clear_if(&self, generation: u64) {
        let mut guard = self.slot.lock().expect("pending-auth mutex poisoned");
        if guard.as_ref().map(|pending| pending.generation) == Some(generation) {
            *guard = None;
        }
    }

    /// Handle an incoming callback URL. On a full match, consumes the pending
    /// slot (single-fire) and delivers the code; a replay then finds nothing.
    ///
    /// A structural failure or a `state`/`pairing` mismatch is rejected
    /// WITHOUT consuming the slot — a spoofed or stray deep link must never
    /// cancel the user's real, still-pending sign-in (§26.4 #2).
    pub fn handle(&self, raw: &str) -> CallbackOutcome {
        let params = match parse_callback(raw) {
            Ok(params) => params,
            Err(err) => return CallbackOutcome::Rejected(err.reason()),
        };

        let mut guard = self.slot.lock().expect("pending-auth mutex poisoned");
        let Some(pending) = guard.as_ref() else {
            // No sign-in in flight, or already consumed → replay/stray.
            return CallbackOutcome::Ignored;
        };

        if params.state != pending.expected_state {
            return CallbackOutcome::Rejected("state_mismatch");
        }
        if let Some(pairing) = &params.pairing {
            if pairing != &pending.expected_pairing {
                return CallbackOutcome::Rejected("pairing_mismatch");
            }
        }

        // Match: single-fire consume, then deliver the code.
        let pending = guard.take().expect("checked Some above");
        match pending.sender.send(params.code) {
            Ok(()) => CallbackOutcome::Accepted,
            // The waiter already timed out and dropped its receiver.
            Err(_) => CallbackOutcome::Ignored,
        }
    }
}

/// Find the first `revealyst://…` argument in a process argv list — used on
/// Windows/Linux where a deep link launches (or re-launches, via
/// single-instance) the app with the URL as a CLI argument. Pure.
pub fn first_scheme_url(args: &[String]) -> Option<&str> {
    let prefix = format!("{SCHEME}://");
    args.iter()
        .map(String::as_str)
        .find(|arg| arg.starts_with(prefix.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK_URL: &str =
        "revealyst://desktop-auth/callback?code=the-code&state=the-state&pairing=pair-1";

    #[test]
    fn parses_a_well_formed_callback() {
        let params = parse_callback(OK_URL).expect("valid callback parses");
        assert_eq!(params.code, "the-code");
        assert_eq!(params.state, "the-state");
        assert_eq!(params.pairing.as_deref(), Some("pair-1"));
    }

    #[test]
    fn rejects_malformed_url() {
        assert_eq!(parse_callback("not a url"), Err(CallbackError::Malformed));
        // Scheme with no authority/path at all.
        assert!(matches!(
            parse_callback("revealyst://"),
            Err(CallbackError::BadPath | CallbackError::Malformed)
        ));
    }

    #[test]
    fn rejects_wrong_scheme() {
        assert_eq!(
            parse_callback("https://desktop-auth/callback?code=c&state=s"),
            Err(CallbackError::BadScheme)
        );
        // A look-alike scheme must not pass.
        assert_eq!(
            parse_callback("revealystx://desktop-auth/callback?code=c&state=s"),
            Err(CallbackError::BadScheme)
        );
    }

    #[test]
    fn rejects_wrong_host_or_path() {
        // Wrong host (authority).
        assert_eq!(
            parse_callback("revealyst://evil/callback?code=c&state=s"),
            Err(CallbackError::BadPath)
        );
        // Right host, wrong path.
        assert_eq!(
            parse_callback("revealyst://desktop-auth/evil?code=c&state=s"),
            Err(CallbackError::BadPath)
        );
        // Right host, path prefix but not exact.
        assert_eq!(
            parse_callback("revealyst://desktop-auth/callback/extra?code=c&state=s"),
            Err(CallbackError::BadPath)
        );
    }

    #[test]
    fn rejects_missing_code_or_state() {
        assert_eq!(
            parse_callback("revealyst://desktop-auth/callback?state=s"),
            Err(CallbackError::MissingCode)
        );
        assert_eq!(
            parse_callback("revealyst://desktop-auth/callback?code=c"),
            Err(CallbackError::MissingState)
        );
    }

    fn pending(state: &str) -> (PendingAuthStore, oneshot::Receiver<String>) {
        let store = PendingAuthStore::default();
        let (tx, rx) = oneshot::channel();
        store.arm(state.to_string(), "pair-1".to_string(), tx);
        (store, rx)
    }

    #[test]
    fn matching_state_delivers_the_code() {
        let (store, mut rx) = pending("the-state");
        assert_eq!(store.handle(OK_URL), CallbackOutcome::Accepted);
        assert_eq!(rx.try_recv().unwrap(), "the-code");
    }

    #[test]
    fn state_mismatch_is_rejected_and_keeps_the_pending_slot() {
        let (store, mut rx) = pending("the-real-state");
        let spoof = "revealyst://desktop-auth/callback?code=evil&state=wrong-state&pairing=pair-1";
        assert_eq!(
            store.handle(spoof),
            CallbackOutcome::Rejected("state_mismatch")
        );
        // The real sign-in is still pending — no code delivered yet…
        assert!(rx.try_recv().is_err());
        // …and the genuine callback still works afterwards.
        assert_eq!(store.handle(OK_URL), CallbackOutcome::Accepted);
        assert_eq!(rx.try_recv().unwrap(), "the-code");
    }

    #[test]
    fn pairing_mismatch_is_rejected() {
        let (store, _rx) = pending("the-state");
        let wrong_pairing =
            "revealyst://desktop-auth/callback?code=c&state=the-state&pairing=other";
        assert_eq!(
            store.handle(wrong_pairing),
            CallbackOutcome::Rejected("pairing_mismatch")
        );
    }

    #[test]
    fn replayed_callback_is_ignored_single_fire() {
        let (store, mut rx) = pending("the-state");
        assert_eq!(store.handle(OK_URL), CallbackOutcome::Accepted);
        assert_eq!(rx.try_recv().unwrap(), "the-code");
        // Replaying the exact same link finds no pending sign-in.
        assert_eq!(store.handle(OK_URL), CallbackOutcome::Ignored);
    }

    #[test]
    fn callback_with_no_pending_is_ignored() {
        let store = PendingAuthStore::default();
        assert_eq!(store.handle(OK_URL), CallbackOutcome::Ignored);
    }

    #[test]
    fn malformed_callback_with_pending_is_rejected_not_delivered() {
        let (store, mut rx) = pending("the-state");
        assert_eq!(
            store.handle("revealyst://desktop-auth/callback?state=the-state"),
            CallbackOutcome::Rejected("missing_code")
        );
        assert!(
            rx.try_recv().is_err(),
            "no code delivered on a bad callback"
        );
    }

    #[test]
    fn stale_flow_cleanup_does_not_wipe_a_newer_pending() {
        let store = PendingAuthStore::default();

        // Flow A arms the slot…
        let (tx_a, _rx_a) = oneshot::channel();
        let gen_a = store.arm("state-a".to_string(), "pair-a".to_string(), tx_a);

        // …then flow B re-arms it before A finishes (unreachable via the UI
        // today, but correctness must not depend on that).
        let (tx_b, mut rx_b) = oneshot::channel();
        let gen_b = store.arm("state-b".to_string(), "pair-b".to_string(), tx_b);
        assert_ne!(gen_a, gen_b, "each arm gets a distinct generation");

        // Flow A times out and runs its ownership-scoped cleanup. It must NOT
        // clear B's pending, because the slot no longer holds A's generation.
        store.clear_if(gen_a);

        // B's genuine callback still resolves.
        let url_b = "revealyst://desktop-auth/callback?code=code-b&state=state-b&pairing=pair-b";
        assert_eq!(store.handle(url_b), CallbackOutcome::Accepted);
        assert_eq!(rx_b.try_recv().unwrap(), "code-b");

        // B's own later cleanup is a harmless no-op (slot already consumed).
        store.clear_if(gen_b);
    }

    #[test]
    fn debug_redacts_the_code_and_state() {
        let params = parse_callback(OK_URL).expect("valid callback parses");
        let rendered = format!("{params:?}");
        assert!(
            !rendered.contains("the-code") && !rendered.contains("the-state"),
            "code and state must never appear in Debug output: {rendered}"
        );
        assert!(
            rendered.contains("[redacted]"),
            "fields are redacted: {rendered}"
        );
        // The non-secret pairing handle is still shown for diagnostics.
        assert!(
            rendered.contains("pair-1"),
            "pairing handle is shown: {rendered}"
        );
    }

    #[test]
    fn first_scheme_url_finds_the_deep_link_among_args() {
        let args = vec![
            "revealyst-agent.exe".to_string(),
            "--flag".to_string(),
            "revealyst://desktop-auth/callback?code=c&state=s".to_string(),
        ];
        assert_eq!(
            first_scheme_url(&args),
            Some("revealyst://desktop-auth/callback?code=c&state=s")
        );

        let none = vec!["revealyst-agent.exe".to_string(), "--show".to_string()];
        assert_eq!(first_scheme_url(&none), None);
    }
}
