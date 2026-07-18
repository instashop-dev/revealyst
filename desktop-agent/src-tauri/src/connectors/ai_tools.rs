//! The AI-app presence connector (Recommendation #7; ADR 0057).
//!
//! Reports which known AI **desktop** apps are running on this machine, **by app
//! identity alone**, as a per-day `ai_tool_used` flag (value `1`) whose `dim`
//! carries a value from the CLOSED AI-app enum (`AI_TOOL_IDS`, frozen contract).
//! It reads **only** each process's executable name (`process.name()`) and
//! matches it, case-insensitively and exactly, against a closed registry — then
//! drops the borrow. It never reads window titles, command lines, file paths, or
//! any process detail beyond identity (§29 denylist + the D-DA-5 borrow-and-drop
//! discipline, here reduced to a closed-enum match).
//!
//! ## Content-free by construction
//!
//! - The ONLY value that can leave the device is a bounded closed-enum app id
//!   (e.g. `claude-desktop`). An out-of-set label never reaches the wire — the
//!   candidate event is rejected by the T3.3 validator's closed-enum backstop
//!   (`out_of_enum_value`), so the whole cycle fails closed (no enqueue,
//!   checkpoint held), exactly like any other projection drift.
//! - App presence is **native-app-only and browser-blind** (ADR 0055 §1.3): the
//!   OS reports "a browser is running", never "a ChatGPT tab is open". So this
//!   signal materially under-counts real AI use — a **coarse** breadth signal,
//!   disclosed honestly via an honesty gap on the day event.
//!
//! ## Confidence ceiling
//!
//! `ai_tool_used` is NOT an OTel marker (ADR 0039). A capability bound to it caps
//! at `directional`, never `measured`. Nothing here changes that.
//!
//! ## NOT wired into the live loop yet (D-DA-8)
//!
//! The server ingest window-delete is **connection-scoped**, and the desktop
//! agent pushes every local source through ONE device-token connection. The
//! Claude Code connector re-emits its full window only when its file manifest
//! changes; on an unchanged cycle it emits nothing. A second local source (this
//! one) pushing a narrow window on such a cycle would make the server
//! delete-then-upsert erase the Claude Code connector's overlapping-day metrics
//! — the exact **D-DA-8** hazard for which the Claude export importer already
//! ships projection-only. So this connector is COMPLETE and privacy-validated
//! (its candidate events pass the fail-closed validator, proven below) but is
//! deliberately NOT called by [`crate::runtime::run_cycle`] until the D-DA-8
//! server-side change (a source-connector-scoped window delete) lands. The
//! privacy boundary + closed-enum contract are fully enforced now.

use std::collections::BTreeSet;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::extract::{day_start_ms, utc_day, GapKind, HonestyGap};
use crate::store::queue::NewEvent;
use crate::store::Store;
use crate::sync::batch::USAGE_SUMMARY_EVENT_TYPE;

use super::claude_code::resolve_local_identity;
use super::{
    Checkpoint, CollectionBatch, ConnectorContext, ConnectorDescriptor, ConnectorError,
    ConnectorHealth, ConnectorState, DetectionResult, PermissionResult, SourceConnector,
};

/// The connector id — the local checkpoint/routing key (NOT a server vendor;
/// records land under the shared `claude_code_local` device-token connection).
pub const CONNECTOR_ID: &str = "ai_tools";

/// One known AI desktop app in the CLOSED registry. `id` MUST be a value in the
/// frozen `AI_TOOL_IDS` enum (a test pins the registry to the contract set that
/// crosses via the generated allowlist artifact). `process_names` are the known
/// executable base names, lowercased, WITHOUT any `.exe` suffix — matched
/// exactly (never substring) so `claude-code` can never be mistaken for the
/// Claude desktop app.
struct AiToolApp {
    id: &'static str,
    process_names: &'static [&'static str],
}

/// The closed registry (ADR 0057). Extended ONLY by a future ADR (a new native
/// AI desktop app) alongside the corresponding `AI_TOOL_IDS` addition. The
/// Claude Code CLI is deliberately absent — it is a developer tool measured by
/// its own connector, not a native chat app.
const AI_TOOL_REGISTRY: &[AiToolApp] = &[
    AiToolApp {
        // macOS app process "Claude"; Windows "Claude.exe".
        id: "claude-desktop",
        process_names: &["claude"],
    },
    AiToolApp {
        // macOS "ChatGPT"; Windows "ChatGPT.exe".
        id: "chatgpt-desktop",
        process_names: &["chatgpt"],
    },
    AiToolApp {
        // Microsoft Copilot native app (Windows "Copilot.exe").
        id: "copilot-desktop",
        process_names: &["copilot"],
    },
    AiToolApp {
        // Perplexity native app (macOS "Perplexity"; Windows "Perplexity.exe").
        id: "perplexity-desktop",
        process_names: &["perplexity"],
    },
];

/// Normalize an executable name to a comparable identity: lowercase + drop a
/// single trailing `.exe` (Windows). Nothing else about the process is read.
fn normalize_process_name(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// Pure detection: which closed-registry app ids are present among `running`
/// process names. Case-insensitive EXACT base-name match (no substring), so a
/// look-alike process can't false-positive. Deterministic (BTreeSet → sorted).
/// This is the whole "classification" — a closed-enum membership test, no
/// content, no free text.
fn detect_present(running: &[String], registry: &[AiToolApp]) -> BTreeSet<&'static str> {
    let normalized: BTreeSet<String> = running.iter().map(|n| normalize_process_name(n)).collect();
    let mut present: BTreeSet<&'static str> = BTreeSet::new();
    for app in registry {
        if app
            .process_names
            .iter()
            .any(|candidate| normalized.contains(*candidate))
        {
            present.insert(app.id);
        }
    }
    present
}

/// Read the executable names of the currently running processes — and NOTHING
/// else about them (no command line, no window title, no path, no user). The one
/// impure boundary; the pure [`detect_present`] does the matching so it is unit-
/// testable without an OS probe. Returns an empty vec if enumeration is
/// unavailable (OFF-safe: no apps detected → no records, never a false claim).
///
/// Targets sysinfo 0.32's API (`refresh_processes(ProcessesToUpdate::All, _)`,
/// `process.name() -> &OsStr`); the CI toolchain compiles + lints Rust, so this
/// thin adapter is the one place to adjust if the crate's process API shifts.
fn running_process_names() -> Vec<String> {
    use sysinfo::{ProcessesToUpdate, System};
    let mut sys = System::new();
    // `false` = do not also refresh users/threads — we want process names only.
    sys.refresh_processes(ProcessesToUpdate::All, false);
    sys.processes()
        .values()
        .map(|process| process.name().to_string_lossy().into_owned())
        .collect()
}

/// The honest coarse-signal disclosure (invariant b — a claim surface carries its
/// own caveats): app presence is native-app-only, browser-blind, and a
/// point-in-time check.
fn presence_gap() -> HonestyGap {
    HonestyGap {
        kind: GapKind::Other,
        detail: Some(
            "ai_tool_used reports only known AI desktop apps seen running at check time (app name only) — it cannot see AI used in a browser tab and may miss an app opened and closed between checks".to_string(),
        ),
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// The pure core of [`SourceConnector::collect`], split out so it is testable
/// without an OS probe or the store: given the running process names + the
/// context, it detects the closed-registry apps and builds the day event +
/// per-app privacy-gate candidate events. The checkpoint is always the day
/// (records "we checked today"); the day event is emitted only when at least one
/// app was detected (an empty probe is an honest zero, not an empty row).
fn collect_presence(ctx: &ConnectorContext, running: &[String]) -> CollectionBatch {
    let day = utc_day(ctx.now_ms);
    let occurred_at = day_start_ms(ctx.now_ms);
    let detected = detect_present(running, AI_TOOL_REGISTRY);

    // Resolve the device subject/attribution once. `external_id` is cloned out
    // for the event ids (needed on every path); the remaining subject fields are
    // read only when a day event is actually built (below), so nothing is bound
    // unused on the empty path.
    let identity = resolve_local_identity(ctx);
    let external_id = identity.external_id.clone();

    // Per-app candidate events — the field-level allowlist projection witness the
    // T3.3 validator gates on. Payload restricted to the closed-enum `ai_tool_used`
    // label + the reserved `false` flags, so each passes the validator (allowed +
    // sent + scalar + IN the closed enum) by construction. An out-of-enum label
    // could never reach here (the registry ids ARE the enum), but the validator
    // is the fail-closed backstop regardless.
    let candidate_events: Vec<NewEvent> = detected
        .iter()
        .map(|id| {
            let event_id = format!(
                "{}|{}|{}|presence|tool={}",
                CONNECTOR_ID, external_id, day, id
            );
            let payload = json!({
                "ai_tool_used": id,
                "rawPromptIncluded": false,
                "rawResponseIncluded": false,
            });
            NewEvent::analytics_only(
                event_id,
                CONNECTOR_ID,
                USAGE_SUMMARY_EVENT_TYPE,
                occurred_at,
                payload,
            )
        })
        .collect();

    let gap = presence_gap();

    // The day-aggregate `usage_summary` event (the wire shape the sync engine
    // drains). One `ai_tool_used` flag record per detected app; no sub-daily
    // signal (presence is a day flag). Emitted only when something was detected.
    let usage_events = if detected.is_empty() {
        Vec::new()
    } else {
        let records: Vec<Value> = detected
            .iter()
            .map(|id| {
                json!({
                    "metricKey": "ai_tool_used",
                    "dim": format!("tool={id}"),
                    "value": 1.0,
                    "attribution": identity.attribution,
                })
            })
            .collect();
        let payload = json!({
            "subject": {
                "kind": identity.kind,
                "externalId": external_id.clone(),
                "email": identity.email.clone(),
                "displayName": identity.display_name.clone(),
            },
            "day": day.clone(),
            "records": records,
            "signal": Value::Null,
            "gaps": [
                json!({ "kind": "other", "detail": gap.detail.clone() }),
            ],
        });
        // Content-addressed id: an unchanged day+set re-hashes to the same id
        // (dedup, crash-safe); a changed set gets a fresh one.
        let digest = hex(&Sha256::digest(payload.to_string().as_bytes()));
        let event_id = format!(
            "{}|{}|{}|presence|{}",
            CONNECTOR_ID,
            external_id,
            day,
            &digest[..16]
        );
        vec![NewEvent::analytics_only(
            event_id,
            CONNECTOR_ID,
            USAGE_SUMMARY_EVENT_TYPE,
            occurred_at,
            payload,
        )]
    };

    CollectionBatch {
        state: Some(ConnectorState::Collecting),
        usage_events,
        candidate_events,
        // Advance over the day even when nothing was detected (records "checked").
        new_checkpoint: Some(Checkpoint(day)),
        gaps: vec![gap],
    }
}

/// The AI-app presence connector. Zero-sized — all it needs is the process table.
#[derive(Debug, Default, Clone, Copy)]
pub struct AiToolsConnector;

impl AiToolsConnector {
    pub fn new() -> Self {
        AiToolsConnector
    }
}

impl SourceConnector for AiToolsConnector {
    fn descriptor(&self) -> ConnectorDescriptor {
        ConnectorDescriptor {
            id: CONNECTOR_ID,
            display_name: "AI apps in use",
            provider: "revealyst",
            product: "app_presence",
        }
    }

    async fn detect(&self, _ctx: &ConnectorContext) -> Result<DetectionResult, ConnectorError> {
        // The OS process table is the only "location", and it is always present;
        // detection does not enumerate (that is `collect`'s job). A count of 1
        // means "the source is available", not "an AI app is running".
        Ok(DetectionResult {
            state: ConnectorState::Ready,
            locations: 1,
        })
    }

    async fn request_permissions(
        &self,
        _ctx: &ConnectorContext,
    ) -> Result<PermissionResult, ConnectorError> {
        // Reading own-session process names needs no OS permission prompt on
        // macOS/Windows (Phase 1).
        Ok(PermissionResult { granted: true })
    }

    async fn load_checkpoint(&self, store: &Store) -> Result<Option<Checkpoint>, ConnectorError> {
        Ok(store.checkpoint(CONNECTOR_ID)?.map(Checkpoint))
    }

    async fn collect(
        &self,
        ctx: &ConnectorContext,
        _checkpoint: Option<Checkpoint>,
    ) -> Result<CollectionBatch, ConnectorError> {
        // Presence is a point-in-time probe (no incremental checkpoint short-
        // circuit): every pass re-reads the current process set. The day event
        // is content-addressed, so an unchanged set re-hashes to the same id and
        // dedups — no churn.
        let running = running_process_names();
        Ok(collect_presence(ctx, &running))
    }

    async fn health(&self, _ctx: &ConnectorContext) -> Result<ConnectorHealth, ConnectorError> {
        Ok(ConnectorHealth {
            state: ConnectorState::Ready,
            last_error_code: None,
        })
    }

    async fn disconnect(&self, store: &Store) -> Result<(), ConnectorError> {
        store.reset_connector(CONNECTOR_ID)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
