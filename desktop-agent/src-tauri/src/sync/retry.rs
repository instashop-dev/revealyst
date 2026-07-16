//! Retry taxonomy + backoff schedule (spec §14.4).
//!
//! Both pieces are PURE and injected with their randomness/attempt number, so
//! the whole policy is unit-testable without a clock, a network, or real
//! sleeping. The async engine ([`super::SyncEngine`]) consumes them.
//!
//! ## Taxonomy (spec §14.4, verbatim)
//!
//! - **Retry** (transient): network timeout · connection reset · HTTP 408 ·
//!   425 · 429 · 500–599. Backoff + jitter between attempts.
//! - **Do NOT blindly retry:** 400 · 401/403 (auth) · 409 schema conflict ·
//!   413 without a split · 422 invalid event.
//! - **413 / 422 → bisect-split** the batch and retry the halves (handled by
//!   the engine, which owns the event set); classified here as
//!   [`HttpDisposition::SplitBisect`].
//! - **401 / 403 → re-auth:** the operator paused (403) or revoked (401,
//!   credential deleted) the device — both mean the agent must stop and ask the
//!   human to sign in again ([`HttpDisposition::AuthFailure`] → state
//!   `authentication_required`, spec §20).

use std::time::Duration;

/// How an HTTP status maps onto the engine's next move. A network-transport
/// error (timeout/reset) is classified separately by the engine (it maps to
/// `offline` on exhaustion, not `degraded`), so this enum is HTTP-status only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpDisposition {
    /// 2xx — the server accepted the batch (server-side idempotency makes a
    /// re-send of the same natural keys a safe no-op).
    Success,
    /// 408 · 425 · 429 · 5xx — transient; retry with backoff, then give up as
    /// `degraded` (the server is reachable but unhappy — not `offline`).
    RetryTransient,
    /// 413 · 422 — the batch is too large or an event is invalid; bisect-split
    /// and retry the halves. A single event that still trips this is quarantined
    /// by the engine (it cannot be split further).
    SplitBisect,
    /// 401 · 403 — revoked or paused; stop and require re-authentication.
    AuthFailure,
    /// 400 · 409 · any other unexpected status — do not retry; surface as
    /// `degraded` and leave the events queued (a fix/upgrade may resolve it).
    Fatal,
}

/// Classify an HTTP status per spec §14.4. Never panics; unknown statuses are
/// treated as [`HttpDisposition::Fatal`] (fail closed — never blind-retry an
/// unclassified response).
pub fn classify_status(status: u16) -> HttpDisposition {
    match status {
        200..=299 => HttpDisposition::Success,
        408 | 425 | 429 => HttpDisposition::RetryTransient,
        500..=599 => HttpDisposition::RetryTransient,
        401 | 403 => HttpDisposition::AuthFailure,
        413 | 422 => HttpDisposition::SplitBisect,
        // 400 (bad request), 409 (schema conflict), and everything else:
        // deliberately NOT retried.
        _ => HttpDisposition::Fatal,
    }
}

/// Exponential-backoff-with-jitter policy. `max_attempts` counts the FIRST try
/// plus retries (so `max_attempts = 1` means "no retry").
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub base: Duration,
    pub max: Duration,
    pub max_attempts: u32,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy::production()
    }
}

impl RetryPolicy {
    /// Shipped policy: 500 ms base, doubling, capped at 30 s, 6 total attempts.
    pub const fn production() -> Self {
        RetryPolicy {
            base: Duration::from_millis(500),
            max: Duration::from_secs(30),
            max_attempts: 6,
        }
    }

    /// Zero-delay policy for tests that exercise the orchestration without
    /// waiting on real time. Jitter/schedule bounds are proven separately by
    /// the pure schedule tests below.
    #[cfg(test)]
    pub const fn no_delay(max_attempts: u32) -> Self {
        RetryPolicy {
            base: Duration::ZERO,
            max: Duration::ZERO,
            max_attempts,
        }
    }

    /// The exponential CEILING (pre-jitter) for `attempt` (1-based):
    /// `min(max, base * 2^(attempt-1))`. Saturating — a large attempt number
    /// clamps at `max` instead of overflowing.
    pub fn ceiling_for(&self, attempt: u32) -> Duration {
        if attempt <= 1 {
            return self.base.min(self.max);
        }
        let shift = attempt - 1;
        // Saturating doubling in millis so we never overflow a u128/Duration.
        let base_ms = self.base.as_millis();
        let scaled = base_ms.checked_shl(shift).unwrap_or(u128::MAX);
        let capped = scaled.min(self.max.as_millis());
        Duration::from_millis(capped.min(u64::MAX as u128) as u64)
    }

    /// The actual delay before `attempt`'s retry: FULL jitter over
    /// `[0, ceiling]`. `rand01` is an injected uniform in `[0, 1)` so the
    /// schedule is deterministic under test. Always `<= ceiling_for(attempt)`
    /// and `>= 0`.
    pub fn delay_for(&self, attempt: u32, rand01: f64) -> Duration {
        let ceiling = self.ceiling_for(attempt).as_millis() as f64;
        let clamped = rand01.clamp(0.0, 1.0);
        Duration::from_millis((ceiling * clamped) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_classification_matches_spec_14_4() {
        // Retry set.
        for s in [408, 425, 429, 500, 502, 503, 504, 599] {
            assert_eq!(classify_status(s), HttpDisposition::RetryTransient, "{s}");
        }
        // Split set.
        for s in [413, 422] {
            assert_eq!(classify_status(s), HttpDisposition::SplitBisect, "{s}");
        }
        // Auth set.
        for s in [401, 403] {
            assert_eq!(classify_status(s), HttpDisposition::AuthFailure, "{s}");
        }
        // Do-not-retry set (fail closed).
        for s in [400, 405, 409, 410, 418, 451] {
            assert_eq!(classify_status(s), HttpDisposition::Fatal, "{s}");
        }
        // Success.
        for s in [200, 201, 202, 204, 299] {
            assert_eq!(classify_status(s), HttpDisposition::Success, "{s}");
        }
    }

    #[test]
    fn ceiling_is_bounded_increasing_and_capped() {
        let policy = RetryPolicy::production();
        let mut prev = Duration::ZERO;
        for attempt in 1..=12 {
            let ceiling = policy.ceiling_for(attempt);
            assert!(
                ceiling >= prev,
                "ceiling must be non-decreasing: attempt {attempt} gave {ceiling:?} < {prev:?}"
            );
            assert!(
                ceiling <= policy.max,
                "ceiling must never exceed max: {ceiling:?} > {:?}",
                policy.max
            );
            prev = ceiling;
        }
        // Early attempts strictly grow: 500ms, 1s, 2s, 4s...
        assert_eq!(policy.ceiling_for(1), Duration::from_millis(500));
        assert_eq!(policy.ceiling_for(2), Duration::from_millis(1000));
        assert_eq!(policy.ceiling_for(3), Duration::from_millis(2000));
        // ...and eventually pins at the 30s cap.
        assert_eq!(policy.ceiling_for(12), Duration::from_secs(30));
    }

    #[test]
    fn delay_is_full_jitter_within_zero_and_ceiling() {
        let policy = RetryPolicy::production();
        for attempt in 1..=8 {
            let ceiling = policy.ceiling_for(attempt);
            // rand=0 → 0; rand≈1 → essentially the ceiling; middle → in between.
            assert_eq!(policy.delay_for(attempt, 0.0), Duration::ZERO);
            for rand in [0.0f64, 0.1, 0.5, 0.9, 0.999_999] {
                let delay = policy.delay_for(attempt, rand);
                assert!(
                    delay <= ceiling,
                    "attempt {attempt} rand {rand}: {delay:?} exceeds ceiling {ceiling:?}"
                );
            }
        }
    }

    #[test]
    fn out_of_range_rand_is_clamped_not_panicking() {
        let policy = RetryPolicy::production();
        // A misbehaving RNG can never push the delay past the ceiling or below 0.
        let ceiling = policy.ceiling_for(3);
        assert_eq!(policy.delay_for(3, 5.0), ceiling);
        assert_eq!(policy.delay_for(3, -1.0), Duration::ZERO);
    }

    #[test]
    fn no_delay_policy_is_instant() {
        let policy = RetryPolicy::no_delay(4);
        for attempt in 1..=4 {
            assert_eq!(policy.delay_for(attempt, 0.999), Duration::ZERO);
        }
        assert_eq!(policy.max_attempts, 4);
    }
}
