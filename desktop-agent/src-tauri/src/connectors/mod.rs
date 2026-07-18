//! Source connectors — the local surfaces the agent collects from (spec §11;
//! Desktop Agent plan T5.1).
//!
//! This module defines the [`SourceConnector`] contract (spec §11.1) and the
//! orchestration seam that turns a connector's [`CollectionBatch`] into durable,
//! privacy-gated queue rows the sync engine ([`crate::sync`]) can drain. The
//! first connector is the Claude Code local-log reader ([`claude_code`]).
//!
//! ## Where this sits in the pipeline
//!
//! ```text
//!   detect → collect → (privacy gate) → enqueue → sync drains → server
//!   └─ SourceConnector ─┘  └─ validate ─┘ └ enqueue_and_checkpoint ┘ (T4.1)
//! ```
//!
//! A connector never touches the network and never advances a checkpoint on its
//! own: [`collect`](SourceConnector::collect) returns a batch (events + the new
//! opaque checkpoint), and [`collect_and_enqueue`] performs the two
//! privacy/durability steps in order:
//!
//! 1. **Privacy enforcement (spec §16.3).** Every per-field *candidate* event the
//!    extractor emits is run through T3.3's [`validate`](crate::privacy::validate)
//!    against the resolved policy. This is the allowlist-projection gate: a
//!    candidate that would quarantine signals extractor drift or tampering, so
//!    the cycle *fails closed* — the day-aggregate is NOT enqueued and the
//!    checkpoint is held, exactly like a policy block (data loss is not
//!    acceptable, spec §13.2). In the happy path every candidate is clean
//!    (0 quarantined), proving the projection matches the CLI's allowlist.
//! 2. **Durable enqueue (R1).** The day-aggregate `usage_summary` events (the
//!    [`UsageSummaryPayload`](crate::sync::batch) wire shape T4.1 drains) are
//!    committed via [`Store::enqueue_and_checkpoint`](crate::store::Store) — the
//!    ONE API that guarantees events are durable before the checkpoint moves
//!    (queue-before-checkpoint). A crash mid-cycle re-emits identical,
//!    content-addressed event ids on the next run — a duplicate the server
//!    dedups, never a gap.
//!
//! ### Why two event shapes, and why only one is enqueued for sync
//!
//! The extractor (T3.4) emits BOTH a per-`(day, model)` **candidate** payload
//! (`{ model, usage.*_tokens, rawPromptIncluded:false, … }` — the field-level
//! allowlist projection that passes the T3.3 validator by construction) AND a
//! per-day **aggregate** (`records` / `signals` / `gaps`). The sync batch builder
//! (T4.1, [`crate::sync::batch`]) decodes a `usage_summary` queue event STRICTLY
//! as a [`UsageSummaryPayload`](crate::sync::batch) (`{ subject, day, records,
//! signal, gaps }`) — the shape its docstring names "the contract the M5 Claude
//! Code connector must enqueue". The per-field candidate shape has no
//! `subject`/`day`, so co-enqueuing it would make the builder emit a fabricated
//! "unreadable queued summary" gap (an invariant-(b) overclaim) and carry no
//! data. So the aggregate is what we enqueue for sync; the candidates are the
//! privacy-gate witness (step 1). The aggregate's own Analytics-Only floor is
//! **structural**: [`UsageSummaryPayload`] has no content-bearing field, and its
//! one attacker-influenceable string — the model id inside a `model=<id>` dim —
//! was already charset-clamped in the extractor
//! ([`counts::sanitize_model`](crate::extract::counts)).

// The AI-app presence connector (Recommendation #7 / ADR 0057) is COMPLETE and
// fully tested, but is deliberately NOT called by `runtime::run_cycle` yet: a
// second local source pushing its own narrow window through the shared
// device-token connection would let the connection-scoped server window-delete
// clobber the Claude Code connector's overlapping-day metrics (the D-DA-8
// hazard, same reason `claude_export` ships projection-only). `#[allow(dead_code)]`
// keeps the dormant collector from tripping a `-D warnings` build until the
// D-DA-8 server-side change (a source-connector-scoped window delete) lands and
// it is wired live. Its behavior is proven by its own unit tests.
#[allow(dead_code)]
pub mod ai_tools;
pub mod claude_code;
pub mod claude_export;

use serde::Serialize;

use crate::extract::HonestyGap;
use crate::privacy::{validate, PolicyResolution};
use crate::store::queue::NewEvent;
use crate::store::{Store, StoreError};

/// How often the live collect loop polls a source (spec §14: conservative,
/// battery-friendly). The manual "Sync now" trigger bypasses the interval.
pub const DEFAULT_POLL_INTERVAL_SECS: u64 = 15 * 60;

/// The connector lifecycle states (spec §11.2), serialized as the spec's
/// snake_case string literals. Mirrors the TS `ConnectorState` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorState {
    NotDetected,
    Detected,
    PermissionRequired,
    Ready,
    Collecting,
    PartiallySupported,
    Paused,
    Degraded,
    Blocked,
    DisabledRemotely,
    UnsupportedVersion,
}

impl ConnectorState {
    /// The spec §11.2 string literal (matches the serde form). Persisted into
    /// `connector_state.status` (counts/enums only — never a payload).
    pub fn as_str(&self) -> &'static str {
        match self {
            ConnectorState::NotDetected => "not_detected",
            ConnectorState::Detected => "detected",
            ConnectorState::PermissionRequired => "permission_required",
            ConnectorState::Ready => "ready",
            ConnectorState::Collecting => "collecting",
            ConnectorState::PartiallySupported => "partially_supported",
            ConnectorState::Paused => "paused",
            ConnectorState::Degraded => "degraded",
            ConnectorState::Blocked => "blocked",
            ConnectorState::DisabledRemotely => "disabled_remotely",
            ConnectorState::UnsupportedVersion => "unsupported_version",
        }
    }
}

/// Static identity of a connector (spec §11.1 `ConnectorDescriptor`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDescriptor {
    /// Stable connector id — the `connector_id` on every queued event and the
    /// checkpoint key (e.g. `claude_code`).
    pub id: &'static str,
    /// Plain-English name for the trust/status surface.
    pub display_name: &'static str,
    /// Provider + product (spec §12.1 event fields).
    pub provider: &'static str,
    pub product: &'static str,
}

/// An opaque per-connector checkpoint cursor (spec §13.1). Its internal shape is
/// the connector's business; the store treats it as a string and the orchestrator
/// only ever compares/advances it through [`Store::enqueue_and_checkpoint`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkpoint(pub String);

/// The outcome of [`SourceConnector::detect`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectionResult {
    pub state: ConnectorState,
    /// Number of local data locations found (config dirs that exist). Zero ⇒
    /// `not_detected`. A count only — never a path (paths are on the §5 denylist).
    pub locations: usize,
}

/// The outcome of [`SourceConnector::request_permissions`]. The Claude Code
/// connector reads files under the user's OWN home directory via the Rust core
/// (`std::fs`), so no OS permission prompt is required and this is always granted
/// in Phase 1 — but the method exists so a future connector needing Full Disk
/// Access / accessibility can surface `permission_required`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionResult {
    pub granted: bool,
}

/// Health snapshot (spec §11.1 `ConnectorHealth`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectorHealth {
    pub state: ConnectorState,
    /// A stable, content-free error code if the last collect degraded.
    pub last_error_code: Option<&'static str>,
}

/// What one [`SourceConnector::collect`] pass produced. The connector fills this;
/// [`collect_and_enqueue`] persists it. NOTHING here has been enqueued yet.
#[derive(Debug, Clone, Default)]
pub struct CollectionBatch {
    /// The resolved connector state after this pass (drives `connector_state`).
    pub state: Option<ConnectorState>,
    /// Day-aggregate `usage_summary` events in the [`UsageSummaryPayload`] wire
    /// shape — the events the sync engine drains. Enqueued via
    /// `enqueue_and_checkpoint` (R1).
    pub usage_events: Vec<NewEvent>,
    /// Per-`(day, model)` candidate events — the field-level allowlist projection
    /// witness. Run through the privacy validator as the §16.3 enforcement gate;
    /// deliberately NOT enqueued for sync (see the module docs).
    pub candidate_events: Vec<NewEvent>,
    /// The new opaque checkpoint after this pass (the file manifest). Advanced
    /// through `enqueue_and_checkpoint` alongside the events, even when there are
    /// zero events (records "we have seen this fileset").
    pub new_checkpoint: Option<Checkpoint>,
    /// Honesty gaps discovered this pass (spend-estimate caveat, unsupported
    /// version, unknown model, …). Carried into the aggregate events' `gaps[]`.
    pub gaps: Vec<HonestyGap>,
}

/// A connector failure — a fixed, content-free code (mirrors the store/auth
/// error-code posture so nothing sensitive can leak through an error chain).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectorError {
    /// The local data surface could not be read (I/O, permissions).
    Io,
    /// A store operation failed.
    Store,
    /// Serializing an aggregate payload failed (structurally near-impossible).
    Encode,
}

impl ConnectorError {
    pub fn code(&self) -> &'static str {
        match self {
            ConnectorError::Io => "connector_io_failed",
            ConnectorError::Store => "connector_store_failed",
            ConnectorError::Encode => "connector_encode_failed",
        }
    }
}

impl From<StoreError> for ConnectorError {
    fn from(_: StoreError) -> Self {
        ConnectorError::Store
    }
}

/// Everything a connector needs for one pass — the resolved policy, the clock,
/// the trailing-window width, and the person↔account attribution inputs. Kept
/// deliberately small and owned-by-value where cheap so the connector stays a
/// pure function of its context + the on-disk logs.
#[derive(Debug, Clone)]
pub struct ConnectorContext {
    /// The resolved collection policy (spec §16). Only `Allow(AnalyticsOnly)`
    /// permits collection in Phase 1.
    pub policy: PolicyResolution,
    /// Wall clock (epoch ms, UTC) for this pass — the trailing window ends today.
    pub now_ms: i64,
    /// Trailing window width in days (inclusive). Days beyond surviving local log
    /// retention just yield empty days (ADR 0025 window-pin honesty).
    pub window_days: u32,
    /// The user consented (at pairing) to attach their Claude account email as a
    /// `person` subject. Without it the device-scoped `account` fallback is used
    /// even when the email is readable (review invariant-b: never fabricate a
    /// person).
    pub consent_identity: bool,
    /// "This computer is shared" (spec §10.3). Demotes the device's events from
    /// `person` to `account` attribution + adds an honesty gap; automatic
    /// multi-person detection is NOT attempted in Phase 1.
    pub shared_device: bool,
    /// The user's home directory (where `.claude/` lives). Injected so the
    /// connector is testable against a fixture home.
    pub home_dir: std::path::PathBuf,
    /// Optional `CLAUDE_CONFIG_DIR` override (comma-separated, ccusage parity).
    pub config_dir_override: Option<String>,
    /// Stable machine-scoped seed (hostname + username) for the device-account
    /// fallback subject. Only its hash ever leaves the machine.
    pub device_seed: String,
}

/// The Rust connector contract (spec §11.1). Static-dispatched (no `dyn`), so the
/// async methods use the in-trait-async pattern the sync engine's transport seam
/// already uses (`#[allow(async_fn_in_trait)]`) rather than pulling in
/// `async_trait`. Phase 1 file I/O is synchronous under the hood; the async
/// signature matches the spec and lets a future network-backed connector do real
/// awaits.
#[allow(async_fn_in_trait)]
pub trait SourceConnector {
    /// Static identity (id, names, provider/product).
    fn descriptor(&self) -> ConnectorDescriptor;

    /// Is the source present on this machine, and in what state?
    async fn detect(&self, ctx: &ConnectorContext) -> Result<DetectionResult, ConnectorError>;

    /// Acquire any OS permission the source needs (none for Claude Code — it
    /// reads the user's own home). Always `granted: true` in Phase 1.
    async fn request_permissions(
        &self,
        ctx: &ConnectorContext,
    ) -> Result<PermissionResult, ConnectorError>;

    /// Load the persisted checkpoint for this connector, if any.
    async fn load_checkpoint(&self, store: &Store) -> Result<Option<Checkpoint>, ConnectorError>;

    /// Read new activity since `checkpoint` into a [`CollectionBatch`]. Pure over
    /// the on-disk logs + `ctx`; never enqueues, never advances the checkpoint,
    /// never touches the network.
    async fn collect(
        &self,
        ctx: &ConnectorContext,
        checkpoint: Option<Checkpoint>,
    ) -> Result<CollectionBatch, ConnectorError>;

    /// A health snapshot for the status surface.
    async fn health(&self, ctx: &ConnectorContext) -> Result<ConnectorHealth, ConnectorError>;

    /// Forget everything for this connector (checkpoint) — a user disconnect.
    async fn disconnect(&self, store: &Store) -> Result<(), ConnectorError>;
}

/// The result of one full collect→enqueue cycle, for the caller's status/logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CollectOutcome {
    /// Day-aggregate events newly inserted into the queue (dedup: a re-emitted
    /// identical day is 0).
    pub enqueued: usize,
    /// Candidate events that would have quarantined (should be 0 — a non-zero
    /// value means the cycle failed closed).
    pub would_quarantine: usize,
    /// The resolved connector state after the cycle.
    pub state: Option<ConnectorState>,
    /// `true` iff the cycle failed closed (policy blocked, or a candidate would
    /// quarantine): nothing enqueued, checkpoint held for re-evaluation.
    pub halted: bool,
}

/// Run one connector's collect pass and persist it with the two ordered steps
/// (privacy gate, then durable enqueue). This is the single wiring point the live
/// loop and the manual "Sync now" trigger both call. See the module docs for the
/// full rationale.
pub async fn collect_and_enqueue<C: SourceConnector>(
    connector: &C,
    ctx: &ConnectorContext,
    store: &Store,
) -> Result<CollectOutcome, ConnectorError> {
    let descriptor = connector.descriptor();
    let connector_id = descriptor.id;

    // A blocked policy is a HALT, never a drop (spec §13.2/§20): collect nothing,
    // hold the checkpoint so the range is re-evaluated once the policy clears.
    if let PolicyResolution::Blocked(reason) = ctx.policy {
        tracing::warn!(
            component = "connector",
            connector = connector_id,
            result = "policy_blocked",
            reason = reason.code(),
            "collection halted; checkpoint held"
        );
        store.set_connector_state(
            connector_id,
            ConnectorState::Blocked.as_str(),
            Some(ctx.now_ms),
            Some(reason.code()),
            ctx.now_ms,
        )?;
        return Ok(CollectOutcome {
            state: Some(ConnectorState::Blocked),
            halted: true,
            ..CollectOutcome::default()
        });
    }

    let checkpoint = connector.load_checkpoint(store).await?;
    let batch = connector.collect(ctx, checkpoint).await?;

    // Step 1 — privacy enforcement (spec §16.3). Every field-level candidate must
    // pass the validator against the resolved policy. A single failure means the
    // extractor produced (or a tamper injected) a non-allowlisted/free-text field
    // — fail closed: do NOT enqueue the aggregate and do NOT advance the
    // checkpoint, so the range survives for a fixed build. In the happy path this
    // is 0 (the projection matches the CLI allowlist by construction).
    let mut would_quarantine = 0usize;
    for candidate in &batch.candidate_events {
        if validate(&candidate.payload, &ctx.policy).is_err() {
            would_quarantine += 1;
        }
    }
    if would_quarantine > 0 {
        store.record_diagnostic("candidate_quarantine", "projection_drift", ctx.now_ms)?;
        store.set_connector_state(
            connector_id,
            ConnectorState::Degraded.as_str(),
            Some(ctx.now_ms),
            Some("candidate_projection_drift"),
            ctx.now_ms,
        )?;
        tracing::warn!(
            component = "connector",
            connector = connector_id,
            result = "failed_closed",
            would_quarantine,
            "a candidate event would quarantine; aggregate held, checkpoint not advanced"
        );
        return Ok(CollectOutcome {
            would_quarantine,
            state: Some(ConnectorState::Degraded),
            halted: true,
            ..CollectOutcome::default()
        });
    }

    // Step 2 — durable enqueue (R1). Advance the checkpoint ONLY through
    // enqueue_and_checkpoint, so the aggregate events are durable before the
    // checkpoint moves. When the fileset changed but produced no in-window events,
    // this still advances the checkpoint over an empty event set (records that we
    // have processed this manifest) — never a standalone set_checkpoint.
    let enqueued = if let Some(Checkpoint(cursor)) = &batch.new_checkpoint {
        store.enqueue_and_checkpoint_at(connector_id, &batch.usage_events, cursor, ctx.now_ms)?
    } else {
        // No new manifest ⇒ nothing changed ⇒ nothing to persist (and nothing to
        // advance). The connector returns None only when the source is absent or
        // unchanged.
        0
    };

    if let Some(state) = batch.state {
        store.set_connector_state(
            connector_id,
            state.as_str(),
            Some(ctx.now_ms),
            None,
            ctx.now_ms,
        )?;
    }

    tracing::info!(
        component = "connector",
        connector = connector_id,
        enqueued,
        state = batch.state.map(|s| s.as_str()).unwrap_or("unchanged"),
        "collect cycle complete"
    );

    Ok(CollectOutcome {
        enqueued,
        would_quarantine: 0,
        state: batch.state,
        halted: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privacy::{ContentMode, PolicyResolution};
    use crate::store::crypto::{DbKey, KEY_LEN};

    fn store() -> Store {
        Store::open_in_memory(DbKey::from_bytes([21u8; KEY_LEN])).unwrap()
    }

    #[test]
    fn connector_state_literals_match_spec() {
        assert_eq!(ConnectorState::NotDetected.as_str(), "not_detected");
        assert_eq!(
            ConnectorState::UnsupportedVersion.as_str(),
            "unsupported_version"
        );
        assert_eq!(
            ConnectorState::PartiallySupported.as_str(),
            "partially_supported"
        );
        // serde form matches as_str.
        assert_eq!(
            serde_json::to_string(&ConnectorState::Collecting).unwrap(),
            "\"collecting\""
        );
    }

    fn analytics_ctx(home: std::path::PathBuf) -> ConnectorContext {
        ConnectorContext {
            policy: PolicyResolution::Allow(ContentMode::AnalyticsOnly),
            now_ms: 1_767_400_000_000,
            window_days: 30,
            consent_identity: false,
            shared_device: false,
            home_dir: home,
            config_dir_override: None,
            device_seed: "test-seed".to_string(),
        }
    }

    /// A blocked policy halts the cycle: nothing enqueued, connector marked
    /// blocked, no checkpoint advance.
    #[tokio::test]
    async fn blocked_policy_halts_the_cycle() {
        use crate::privacy::PolicyBlockReason;
        let store = store();
        let connector = claude_code::ClaudeCodeConnector::new();
        let mut ctx = analytics_ctx(std::env::temp_dir());
        ctx.policy = PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);

        let outcome = collect_and_enqueue(&connector, &ctx, &store).await.unwrap();
        assert!(outcome.halted);
        assert_eq!(outcome.enqueued, 0);
        assert_eq!(outcome.state, Some(ConnectorState::Blocked));
        assert_eq!(store.pending_count().unwrap(), 0);
        assert_eq!(store.checkpoint("claude_code").unwrap(), None);
    }
}
