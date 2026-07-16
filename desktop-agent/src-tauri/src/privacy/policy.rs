//! The privacy policy engine (spec §16.1/§16.2; Desktop Agent plan T3.3).
//!
//! # The content-mode lattice
//!
//! The three data modes (spec §6.2) form a total order by **collection
//! breadth** — how much leaves the device:
//!
//! ```text
//!   most restrictive  ─────────────────────────────►  least restrictive
//!   (collects least)                                   (collects most)
//!
//!   AnalyticsOnly   <   RedactedSummary   <   FullContent
//!   breadth 0            breadth 1              breadth 2
//!    ALLOW                DENY                   DENY
//!  (only mode           (not implemented       (not implemented
//!   implemented)         in Phase 1)            in Phase 1)
//! ```
//!
//! `most_restrictive` is the lattice **meet** — the minimum breadth over its
//! inputs. Effective policy = `most_restrictive(platform_hard_limit,
//! org_policy, user_policy, connector_capability)` (spec §16.1 precedence).
//! `AnalyticsOnly` is the only permitted floor and the only mode that resolves
//! to ALLOW; `RedactedSummary`/`FullContent` are enum variants that exist so a
//! policy *requesting* them can be recognized and DENIED — they never activate.
//!
//! # Never-broaden (spec §16.2 / §29)
//!
//! A remote-config / org / user / connector input may only NARROW collection.
//! The platform hard limit is a constant floor ([`PLATFORM_HARD_LIMIT`], Phase 1
//! = `AnalyticsOnly`). Any input proposing a mode *broader* than that floor is a
//! broadening attempt — it is **refused**, resolving to
//! [`PolicyResolution::Blocked`] with reason [`PolicyBlockReason::BroadenAttempt`]
//! (the spec §20 `policy_blocked` state). The broadening is never silently
//! absorbed and never applied: the effective mode is never elevated above
//! `AnalyticsOnly`; instead the agent halts collection. The signed-config verify
//! that feeds these inputs lands in T4.2; this layer models the resolution so
//! that verifier plugs straight in.

/// A data mode (spec §6.2). Ordered by collection breadth; `AnalyticsOnly` is
/// the most restrictive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentMode {
    /// Numbers + bounded enums only. The default and the ONLY mode implemented
    /// in Phase 1 — the only mode that resolves to ALLOW.
    AnalyticsOnly,
    /// Locally redacted snippets. Not implemented in Phase 1 (resolves to DENY).
    RedactedSummary,
    /// Raw prompts/responses. Not implemented in Phase 1 (resolves to DENY).
    FullContent,
}

impl ContentMode {
    /// Collection breadth — the lattice coordinate. Lower = more restrictive.
    fn breadth(self) -> u8 {
        match self {
            ContentMode::AnalyticsOnly => 0,
            ContentMode::RedactedSummary => 1,
            ContentMode::FullContent => 2,
        }
    }

    /// Whether this mode is implemented in Phase 1. Only `AnalyticsOnly` is —
    /// everything broader is a recognized-but-denied variant.
    pub fn is_implemented(self) -> bool {
        matches!(self, ContentMode::AnalyticsOnly)
    }
}

/// The platform hard limit — the broadest mode the platform itself will ever
/// permit. Phase 1 pins this to `AnalyticsOnly`: the mandatory floor that no
/// org/user/connector/remote-config input can move above (spec §29 "Analytics
/// Only is the default and mandatory MVP mode").
pub const PLATFORM_HARD_LIMIT: ContentMode = ContentMode::AnalyticsOnly;

/// The spec §20 agent state a blocked policy maps to.
pub const POLICY_BLOCKED_STATE: &str = "policy_blocked";

/// The four policy inputs (spec §16.1). Each is a mode PROPOSAL; the engine
/// combines them under most-restrictive precedence + the never-broaden rule.
#[derive(Debug, Clone, Copy)]
pub struct PolicyInputs {
    /// Platform hard limit — defaults to [`PLATFORM_HARD_LIMIT`].
    pub platform_hard_limit: ContentMode,
    /// Organization policy (from signed remote config, T4.2).
    pub org_policy: ContentMode,
    /// User policy (local preference).
    pub user_policy: ContentMode,
    /// Connector capability — the broadest a given source can honestly support.
    pub connector_capability: ContentMode,
}

impl Default for PolicyInputs {
    /// The Phase-1 baseline: every input at the `AnalyticsOnly` floor.
    fn default() -> Self {
        PolicyInputs {
            platform_hard_limit: PLATFORM_HARD_LIMIT,
            org_policy: ContentMode::AnalyticsOnly,
            user_policy: ContentMode::AnalyticsOnly,
            connector_capability: ContentMode::AnalyticsOnly,
        }
    }
}

impl PolicyInputs {
    /// The four inputs as a slice, platform floor first.
    fn all(&self) -> [ContentMode; 4] {
        [
            self.platform_hard_limit,
            self.org_policy,
            self.user_policy,
            self.connector_capability,
        ]
    }

    /// The three config-driven inputs (everything except the platform floor).
    /// These are the ones that may only narrow.
    fn config_inputs(&self) -> [ContentMode; 3] {
        [self.org_policy, self.user_policy, self.connector_capability]
    }
}

/// Why a policy resolved to blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyBlockReason {
    /// A config input proposed a mode broader than the platform hard limit
    /// (spec §16.2 never-broaden). Refused, never applied.
    BroadenAttempt,
    /// The resolved mode is not implemented in Phase 1 (`RedactedSummary` /
    /// `FullContent`) — denied rather than collected under an unimplemented mode.
    ModeNotImplemented,
}

impl PolicyBlockReason {
    /// Stable, content-free code for logs/diagnostics.
    pub fn code(&self) -> &'static str {
        match self {
            PolicyBlockReason::BroadenAttempt => "broaden_attempt",
            PolicyBlockReason::ModeNotImplemented => "mode_not_implemented",
        }
    }
}

/// The outcome of resolving a policy. Only `Allow(AnalyticsOnly)` ever permits
/// collection in Phase 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyResolution {
    /// Collection is permitted in this mode. In Phase 1 the mode is always
    /// `AnalyticsOnly` — [`resolve`] never yields `Allow` of anything broader.
    Allow(ContentMode),
    /// Collection is blocked (spec §20 `policy_blocked`).
    Blocked(PolicyBlockReason),
}

impl PolicyResolution {
    /// The spec §20 agent state string for this resolution. `Blocked` →
    /// `policy_blocked`; `Allow` → `None` (the state is decided by the wider
    /// connection-state model, not by a permitted policy).
    pub fn agent_state(&self) -> Option<&'static str> {
        match self {
            PolicyResolution::Blocked(_) => Some(POLICY_BLOCKED_STATE),
            PolicyResolution::Allow(_) => None,
        }
    }
}

/// The lattice meet (spec §16.1): the MOST RESTRICTIVE (least breadth) of the
/// given modes. Empty input defaults to the `AnalyticsOnly` floor.
pub fn most_restrictive(modes: &[ContentMode]) -> ContentMode {
    modes
        .iter()
        .copied()
        .min_by_key(|m| m.breadth())
        .unwrap_or(ContentMode::AnalyticsOnly)
}

/// Resolve the effective policy from its four inputs (spec §16.1 + §16.2).
///
/// 1. **Never-broaden:** if any config input (org/user/connector) proposes a
///    mode broader than `platform_hard_limit`, refuse → `Blocked(BroadenAttempt)`.
/// 2. Otherwise take the lattice meet (most restrictive) of all four inputs.
/// 3. If the meet is implemented (`AnalyticsOnly`) → `Allow(AnalyticsOnly)`;
///    else → `Blocked(ModeNotImplemented)`.
pub fn resolve(inputs: &PolicyInputs) -> PolicyResolution {
    let floor = inputs.platform_hard_limit.breadth();
    // Step 1 — never-broaden: no config input may exceed the platform floor.
    if inputs.config_inputs().iter().any(|m| m.breadth() > floor) {
        return PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);
    }
    // Step 2 — most-restrictive precedence over all inputs.
    let effective = most_restrictive(&inputs.all());
    // Step 3 — only an implemented mode activates.
    if effective.is_implemented() {
        PolicyResolution::Allow(effective)
    } else {
        PolicyResolution::Blocked(PolicyBlockReason::ModeNotImplemented)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_MODES: [ContentMode; 3] = [
        ContentMode::AnalyticsOnly,
        ContentMode::RedactedSummary,
        ContentMode::FullContent,
    ];

    #[test]
    fn most_restrictive_is_the_least_breadth() {
        assert_eq!(
            most_restrictive(&[ContentMode::FullContent, ContentMode::AnalyticsOnly]),
            ContentMode::AnalyticsOnly
        );
        assert_eq!(
            most_restrictive(&[ContentMode::RedactedSummary, ContentMode::FullContent]),
            ContentMode::RedactedSummary
        );
        // Empty → the floor.
        assert_eq!(most_restrictive(&[]), ContentMode::AnalyticsOnly);
    }

    #[test]
    fn phase1_baseline_allows_analytics_only() {
        let r = resolve(&PolicyInputs::default());
        assert_eq!(r, PolicyResolution::Allow(ContentMode::AnalyticsOnly));
        assert_eq!(r.agent_state(), None);
    }

    /// Spec §26.1: remote/org config cannot silently broaden. An org proposing
    /// Full Content is refused (`policy_blocked`); the mode is never elevated,
    /// and the untouched baseline still resolves to Analytics Only.
    #[test]
    fn org_broaden_attempt_is_blocked_and_analytics_only_stays() {
        let inputs = PolicyInputs {
            org_policy: ContentMode::FullContent,
            ..PolicyInputs::default()
        };
        let r = resolve(&inputs);
        assert_eq!(
            r,
            PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt)
        );
        assert_eq!(r.agent_state(), Some(POLICY_BLOCKED_STATE));
        // Never yields Allow(FullContent) — the broadening never took effect.
        assert_ne!(r, PolicyResolution::Allow(ContentMode::FullContent));
        // The baseline (no broaden) still allows Analytics Only.
        assert_eq!(
            resolve(&PolicyInputs::default()),
            PolicyResolution::Allow(ContentMode::AnalyticsOnly)
        );
    }

    #[test]
    fn user_or_connector_broaden_attempt_is_blocked() {
        for broaden in [ContentMode::RedactedSummary, ContentMode::FullContent] {
            let via_user = resolve(&PolicyInputs {
                user_policy: broaden,
                ..PolicyInputs::default()
            });
            let via_connector = resolve(&PolicyInputs {
                connector_capability: broaden,
                ..PolicyInputs::default()
            });
            assert_eq!(
                via_user,
                PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt)
            );
            assert_eq!(
                via_connector,
                PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt)
            );
        }
    }

    /// Spec §26.1: Redacted Summary + Full Content refuse to activate without an
    /// explicit policy Phase 1 never grants. Even when the platform floor is
    /// (hypothetically) raised so no broaden is detected, an unimplemented
    /// resolved mode is denied — never allowed.
    #[test]
    fn unimplemented_modes_never_activate() {
        for broad in [ContentMode::RedactedSummary, ContentMode::FullContent] {
            // Raise the whole lattice so the meet is `broad` and no config input
            // exceeds the floor — the ONLY way to reach step 3 with a broad mode.
            let inputs = PolicyInputs {
                platform_hard_limit: broad,
                org_policy: broad,
                user_policy: broad,
                connector_capability: broad,
            };
            assert_eq!(
                resolve(&inputs),
                PolicyResolution::Blocked(PolicyBlockReason::ModeNotImplemented),
                "an unimplemented resolved mode must be denied, never allowed"
            );
        }
    }

    /// The load-bearing safety property: over EVERY combination of the four
    /// inputs, `resolve` never returns `Allow` of anything but `AnalyticsOnly`.
    /// There is no path to activating a broader mode.
    #[test]
    fn allow_implies_analytics_only_for_all_input_combinations() {
        let mut saw_allow = 0usize;
        for platform in ALL_MODES {
            for org in ALL_MODES {
                for user in ALL_MODES {
                    for connector in ALL_MODES {
                        let inputs = PolicyInputs {
                            platform_hard_limit: platform,
                            org_policy: org,
                            user_policy: user,
                            connector_capability: connector,
                        };
                        if let PolicyResolution::Allow(mode) = resolve(&inputs) {
                            saw_allow += 1;
                            assert_eq!(
                                mode,
                                ContentMode::AnalyticsOnly,
                                "Allow must only ever be AnalyticsOnly (inputs: {inputs:?})"
                            );
                        }
                    }
                }
            }
        }
        // Anti-vacuity: the property is non-trivial only if `Allow` was actually
        // reached — a `resolve` that stopped allowing would make the loop above
        // pass empty. It must fire for the all-AnalyticsOnly floor at minimum.
        assert!(
            saw_allow > 0,
            "no Allow observed — the test would be vacuous"
        );
    }

    #[test]
    fn block_reason_codes_are_distinct_and_nonempty() {
        assert_ne!(
            PolicyBlockReason::BroadenAttempt.code(),
            PolicyBlockReason::ModeNotImplemented.code()
        );
        assert!(!PolicyBlockReason::BroadenAttempt.code().is_empty());
    }
}
