//! Agent connection-state model (spec §20).
//!
//! `resolve_state` is the single source of truth for the agent's state: a
//! pure function over raw condition flags with the spec's fixed precedence.
//! The tray status line and the status screen both consume it — they never
//! derive state themselves.
//!
//! Mirrored in TypeScript at `desktop-agent/src/lib/state.ts` — keep the two
//! in lockstep (string literals AND labels).

use serde::Serialize;

/// The ten agent states from spec §20, serialized as the spec's snake_case
/// string literals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Onboarding,
    Healthy,
    PartiallyCovered,
    Offline,
    Paused,
    AuthenticationRequired,
    PolicyBlocked,
    UpdateRequired,
    Degraded,
    StorageFull,
}

impl AgentState {
    /// The spec §20 string literal for this state (matches the serde form).
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentState::Onboarding => "onboarding",
            AgentState::Healthy => "healthy",
            AgentState::PartiallyCovered => "partially_covered",
            AgentState::Offline => "offline",
            AgentState::Paused => "paused",
            AgentState::AuthenticationRequired => "authentication_required",
            AgentState::PolicyBlocked => "policy_blocked",
            AgentState::UpdateRequired => "update_required",
            AgentState::Degraded => "degraded",
            AgentState::StorageFull => "storage_full",
        }
    }

    /// Plain-English status line shown in the tray menu and status screen.
    /// Beginner-friendly copy per the CLAUDE.md writing principles — no
    /// jargon, tell the user what is happening.
    pub fn status_label(&self) -> &'static str {
        match self {
            AgentState::Onboarding => "Setup needed",
            AgentState::Healthy => "Syncing normally",
            AgentState::PartiallyCovered => "Running — some sources not covered",
            AgentState::Offline => "Offline — will retry",
            AgentState::Paused => "Paused",
            AgentState::AuthenticationRequired => "Sign-in needed",
            AgentState::PolicyBlocked => "Blocked by your organization",
            AgentState::UpdateRequired => "Update needed",
            AgentState::Degraded => "Running with problems",
            AgentState::StorageFull => "Local storage is full",
        }
    }
}

/// Raw condition flags the state machine resolves over.
///
/// `Default` is the honest Wave M1 reality: not enrolled, nothing else set —
/// which resolves to `Onboarding`. Later waves flip flags from real signals
/// (M2 sets `enrolled`/`authentication_required`, M3+ the collection flags).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StateInputs {
    pub update_required: bool,
    /// Device has completed enrollment (M2 pairing). `false` until then.
    pub enrolled: bool,
    pub authentication_required: bool,
    pub policy_blocked: bool,
    pub storage_full: bool,
    pub paused: bool,
    pub degraded: bool,
    pub offline: bool,
    pub partially_covered: bool,
}

/// Resolve the agent state with the spec §20 precedence (highest first):
///
/// `update_required` → `authentication_required` → `policy_blocked` →
/// `storage_full` → `paused` → `degraded` → `offline` →
/// `partially_covered` → `healthy`.
///
/// Placement of `onboarding`: the spec lists `onboarding` first in the type
/// but gives precedence only for the operational states. We define:
/// **not-yet-enrolled resolves to `Onboarding` regardless of every other
/// flag, EXCEPT `update_required`, which still wins** — a build too old to
/// talk to the backend must say "update needed" even before enrollment,
/// while every other operational condition is meaningless until the device
/// is enrolled.
pub fn resolve_state(inputs: &StateInputs) -> AgentState {
    if inputs.update_required {
        return AgentState::UpdateRequired;
    }
    if !inputs.enrolled {
        return AgentState::Onboarding;
    }
    if inputs.authentication_required {
        return AgentState::AuthenticationRequired;
    }
    if inputs.policy_blocked {
        return AgentState::PolicyBlocked;
    }
    if inputs.storage_full {
        return AgentState::StorageFull;
    }
    if inputs.paused {
        return AgentState::Paused;
    }
    if inputs.degraded {
        return AgentState::Degraded;
    }
    if inputs.offline {
        return AgentState::Offline;
    }
    if inputs.partially_covered {
        return AgentState::PartiallyCovered;
    }
    AgentState::Healthy
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Enrolled baseline with no conditions set — resolves to `Healthy`.
    fn enrolled_baseline() -> StateInputs {
        StateInputs {
            enrolled: true,
            ..StateInputs::default()
        }
    }

    /// One precedence row: (name, input-mutator, expected state).
    type PrecedenceRow = (&'static str, fn(&mut StateInputs), AgentState);

    /// The full precedence order as (condition-setter, expected-state) rows,
    /// highest precedence first. Row 1 (`enrolled = false`) is the
    /// onboarding placement documented on `resolve_state`.
    fn precedence_table() -> Vec<PrecedenceRow> {
        vec![
            (
                "update_required",
                (|i| i.update_required = true) as fn(&mut StateInputs),
                AgentState::UpdateRequired,
            ),
            (
                "not enrolled",
                |i| i.enrolled = false,
                AgentState::Onboarding,
            ),
            (
                "authentication_required",
                |i| i.authentication_required = true,
                AgentState::AuthenticationRequired,
            ),
            (
                "policy_blocked",
                |i| i.policy_blocked = true,
                AgentState::PolicyBlocked,
            ),
            (
                "storage_full",
                |i| i.storage_full = true,
                AgentState::StorageFull,
            ),
            ("paused", |i| i.paused = true, AgentState::Paused),
            ("degraded", |i| i.degraded = true, AgentState::Degraded),
            ("offline", |i| i.offline = true, AgentState::Offline),
            (
                "partially_covered",
                |i| i.partially_covered = true,
                AgentState::PartiallyCovered,
            ),
        ]
    }

    #[test]
    fn each_condition_alone_yields_its_state() {
        for (name, set, expected) in precedence_table() {
            let mut inputs = enrolled_baseline();
            set(&mut inputs);
            assert_eq!(
                resolve_state(&inputs),
                expected,
                "condition `{name}` alone should yield {expected:?}"
            );
        }
    }

    #[test]
    fn no_conditions_yields_healthy() {
        assert_eq!(resolve_state(&enrolled_baseline()), AgentState::Healthy);
    }

    #[test]
    fn all_ten_states_are_reachable() {
        let mut reached: Vec<AgentState> = precedence_table()
            .into_iter()
            .map(|(_, set, _)| {
                let mut inputs = enrolled_baseline();
                set(&mut inputs);
                resolve_state(&inputs)
            })
            .collect();
        reached.push(resolve_state(&enrolled_baseline()));
        reached.sort_by_key(|s| s.as_str());
        reached.dedup();
        assert_eq!(
            reached.len(),
            10,
            "every AgentState must be reachable: {reached:?}"
        );
    }

    /// The flagship table: every precedence PAIR. For each pair (i, j) with
    /// i higher precedence than j, set BOTH conditions and assert the
    /// higher-precedence state wins.
    #[test]
    fn every_precedence_pair_resolves_to_the_higher_condition() {
        let table = precedence_table();
        for i in 0..table.len() {
            for j in (i + 1)..table.len() {
                let (hi_name, hi_set, hi_expected) = &table[i];
                let (lo_name, lo_set, _) = &table[j];
                let mut inputs = enrolled_baseline();
                hi_set(&mut inputs);
                lo_set(&mut inputs);
                assert_eq!(
                    resolve_state(&inputs),
                    *hi_expected,
                    "`{hi_name}` must beat `{lo_name}`"
                );
            }
        }
    }

    #[test]
    fn default_inputs_resolve_to_onboarding() {
        // Wave M1 reality: nothing is enrolled, nothing is collected.
        assert_eq!(
            resolve_state(&StateInputs::default()),
            AgentState::Onboarding
        );
    }

    #[test]
    fn onboarding_wins_over_every_operational_state_except_update_required() {
        // Everything set at once, not enrolled, no update: Onboarding.
        let mut inputs = StateInputs {
            enrolled: false,
            authentication_required: true,
            policy_blocked: true,
            storage_full: true,
            paused: true,
            degraded: true,
            offline: true,
            partially_covered: true,
            update_required: false,
        };
        assert_eq!(resolve_state(&inputs), AgentState::Onboarding);
        // ...and update_required still beats onboarding.
        inputs.update_required = true;
        assert_eq!(resolve_state(&inputs), AgentState::UpdateRequired);
    }

    #[test]
    fn serde_form_matches_spec_string_literals() {
        for (state, expected) in [
            (AgentState::Onboarding, "\"onboarding\""),
            (AgentState::Healthy, "\"healthy\""),
            (AgentState::PartiallyCovered, "\"partially_covered\""),
            (AgentState::Offline, "\"offline\""),
            (AgentState::Paused, "\"paused\""),
            (
                AgentState::AuthenticationRequired,
                "\"authentication_required\"",
            ),
            (AgentState::PolicyBlocked, "\"policy_blocked\""),
            (AgentState::UpdateRequired, "\"update_required\""),
            (AgentState::Degraded, "\"degraded\""),
            (AgentState::StorageFull, "\"storage_full\""),
        ] {
            assert_eq!(serde_json::to_string(&state).unwrap(), expected);
            assert_eq!(format!("\"{}\"", state.as_str()), expected);
        }
    }
}
