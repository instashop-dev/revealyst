//! Day-aggregate batch assembly for `POST /api/agent/ingest` (spec §14.2/§14.3).
//!
//! ## Wire shape — hand-mirrored from the FROZEN contract
//!
//! D-DA-3: day-aggregate batches ride the EXISTING ingest endpoint, so the wire
//! body is [`IngestRequest`], a byte-for-byte mirror of the frozen
//! `agentIngestRequestSchema` (`src/contracts/api.ts`, contracts-v1) — NOT the
//! aspirational `IngestionBatch { events }` shape from spec §14.2. Because the
//! desktop crate cannot import the TS schema (plan law 5), parity is pinned by
//! [`tests::rust_struct_round_trips_the_frozen_fixture`], which round-trips the
//! checked-in `fixtures/agent-ingest-request.json` — a fixture PRODUCED by
//! parsing an example through the real zod schema (see
//! `scripts/generate-agent-ingest-fixture.mjs` + the web-side drift test). If
//! the frozen schema changes, that fixture changes and this struct must change
//! in the same ADR.
//!
//! ## Analytics-Only floor
//!
//! Every field below is a number, an enum, a day string, or a bounded label —
//! there is no field that can carry prompt/response text (enforced upstream by
//! the T3.3 validator + the queue's structural no-text-column floor). The batch
//! builder only re-shapes already-validated queued summaries; it never reads
//! raw content.
//!
//! ## Day-window-authoritative invariant (P0 — do not break)
//!
//! The server ingest is **destructive per whole day-range**: it runs
//! `deleteWindowForConnection(window.start ..= window.end)` — deleting EVERY row
//! whose day falls in that inclusive range — and then upserts the batch ("a push
//! is authoritative for its window", `src/lib/agent-ingest.ts`). A batch's
//! `window` is the min/max day of the rows it carries. Two consequences the
//! split path MUST respect:
//!
//! 1. **Splitting is BY DAY, never by event count.** If a single day's rows are
//!    divided across two sub-batches, the two sub-batches get OVERLAPPING
//!    windows; uploaded sequentially, the second's window-delete erases the
//!    first's just-committed rows → silent data loss. [`split_events_by_day`]
//!    partitions on a day boundary so every sub-batch covers a DISJOINT set of
//!    whole days and no two windows overlap. A day is never split.
//! 2. **A batch with no rows is never uploaded.** An empty-`records`/empty-
//!    `signals` body would delete its window and upsert nothing (data loss), and
//!    an all-undecodable batch would carry `window.start = ""` (a poison 400).
//!    The engine skips the POST entirely for such a batch (see `sync/mod.rs`).
//!
//! Edge case: a SINGLE day whose rows alone exceed the 250-event / 1 MB caps
//! cannot be split without overlapping windows, so it is sent WHOLE (logged).
//! Phase 1 (D-DA-2, Personal orgs only) is one subject per day — a day is ~one
//! event — so this cannot occur yet, but it is handled explicitly rather than
//! corrupting the window.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::store::queue::PendingEvent;
use crate::store::StoreError;

/// Max events drained into one batch (spec §14.3).
pub const MAX_EVENTS_PER_BATCH: usize = 250;

/// Max compressed request body (spec §14.3). A built batch whose gzip body
/// exceeds this is bisect-split BEFORE upload (proactively), reusing the same
/// mechanism as a 413 response.
pub const MAX_COMPRESSED_BYTES: usize = 1_000_000;

/// The local summarizer-semantics version; the server composes
/// `claude-code-local@<summarizerVersion>` as the source connector. Bumping the
/// on-device summarization logic bumps this (frozen-contract §8.2 metadata).
pub const SUMMARIZER_VERSION: i64 = 1;

/// The queue `event_type` this builder understands. An event with any other
/// type is skipped and surfaced as a gap (the builder never partial-parses an
/// unknown shape — honesty over guessing).
pub const USAGE_SUMMARY_EVENT_TYPE: &str = "usage_summary";

/// The default `source` (ADR 0060): the live Claude Code connector. Matches the
/// frozen schema default, so an omitted field means the live connector — the
/// pre-0060 behavior.
pub const DEFAULT_INGEST_SOURCE: &str = "claude-code-local";

/// The local queue `connector_id` of the Claude data-export importer, whose
/// batches upload under the `claude-export` wire source (ADR 0060 / D-DA-8).
pub const CLAUDE_EXPORT_CONNECTOR_ID: &str = "claude_export";

/// The local queue `connector_id` of the AI-app presence connector (#7). It is
/// a SEPARATE on-device connector that shares the device subject, so it MUST
/// upload under its own `ai-tools` wire source — otherwise its window-delete
/// would erase the live `claude_code` connector's overlapping day (D-DA-8). Its
/// LIVE emission stays gated on the #7 activation gate; this mapping only
/// removes its D-DA-8 blocker so a future activation is safe.
pub const AI_TOOLS_CONNECTOR_ID: &str = "ai_tools";

/// Map a local queue `connector_id` to the closed wire `source` the server
/// accepts (ADR 0060 `AGENT_INGEST_SOURCES`). The desktop groups a flush cycle
/// by `connector_id` so every uploaded batch is single-source; the server
/// composes the actual `source_connector` string from this. `claude_code` (and
/// the worktype signals that ride inside its batch) upload as the live
/// connector; the export and app-presence connectors get their own distinct
/// families. An unrecognized connector uploads as the live connector (the safe
/// default) — a new SEPARATE connector must be added here AND to
/// `AGENT_INGEST_SOURCES` before it can share the device connection safely.
pub fn wire_source_for_connector(connector_id: &str) -> &'static str {
    match connector_id {
        CLAUDE_EXPORT_CONNECTOR_ID => "claude-export",
        AI_TOOLS_CONNECTOR_ID => "ai-tools",
        _ => DEFAULT_INGEST_SOURCE,
    }
}

fn default_ingest_source() -> String {
    DEFAULT_INGEST_SOURCE.to_string()
}

// --- Wire structs (mirror agentIngestRequestSchema) ------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestRequest {
    pub agent_version: String,
    pub summarizer_version: i64,
    /// Which on-device source produced this batch (ADR 0060). A closed enum on
    /// the server (`AGENT_INGEST_SOURCES`); the server composes the actual
    /// `source_connector` from it. Defaulted for an older server/fixture that
    /// omits it → the live connector, the pre-0060 behavior.
    #[serde(default = "default_ingest_source")]
    pub source: String,
    pub window: Window,
    pub subjects: Vec<SubjectDescriptor>,
    pub records: Vec<MetricRecord>,
    pub signals: Vec<SubDailySignal>,
    pub gaps: Vec<HonestyGap>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Window {
    pub start: String,
    pub end: String,
}

/// A subject descriptor. `email`/`display_name` are always serialized (as
/// `null` when absent) to match the schema's `.nullable().default(null)` — the
/// server's parse output always carries them. Analytics-Only Claude Code
/// enrollment leaves both null (no PII leaves the device by default).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectDescriptor {
    pub kind: String,
    pub external_id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubjectRef {
    pub kind: String,
    #[serde(rename = "externalId")]
    pub external_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRecord {
    pub subject: SubjectRef,
    pub metric_key: String,
    pub day: String,
    /// Empty string for a dimensionless metric (schema `.default("")`).
    pub dim: String,
    pub value: f64,
    pub attribution: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubDailySignal {
    pub subject: SubjectRef,
    pub day: String,
    /// 24-slot hour histogram, or `null` when unavailable.
    pub hours: Option<Vec<i64>>,
    #[serde(default)]
    pub peak_concurrency: Option<i64>,
    pub source_granularity: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HonestyGap {
    pub kind: String,
    /// Optional per the schema — omitted entirely when absent (never `null`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// --- On-device queue payload contract (what T5.1 enqueues) -----------------

/// The decrypted payload a `usage_summary` queue event carries — the contract
/// the M5 Claude Code connector (T5.1) must enqueue. It is a per-subject-day
/// analytics summary: a subject, the day, its metric rows, an optional
/// sub-daily signal, and any honesty gaps discovered for that subject-day. The
/// batch builder aggregates many of these (across subjects/days) into one
/// [`IngestRequest`]. Numbers/enums/labels only — no field can hold raw text.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageSummaryPayload {
    subject: SubjectDescriptor,
    day: String,
    #[serde(default)]
    records: Vec<SummaryRecord>,
    #[serde(default)]
    signal: Option<SummarySignal>,
    #[serde(default)]
    gaps: Vec<HonestyGap>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryRecord {
    metric_key: String,
    #[serde(default)]
    dim: String,
    value: f64,
    attribution: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummarySignal {
    hours: Option<Vec<i64>>,
    #[serde(default)]
    peak_concurrency: Option<i64>,
    source_granularity: String,
}

/// A batch prepared for upload: the wire body, its gzip-compressed bytes, the
/// source event row ids (for purge-after-2xx), and the deterministic,
/// content-addressed batch id (for crash-safe receipt idempotency).
#[derive(Debug, Clone)]
pub struct PreparedBatch {
    pub request: IngestRequest,
    pub gzip_body: Vec<u8>,
    pub event_ids: Vec<i64>,
    pub batch_id: String,
}

/// Assemble a day-aggregate [`IngestRequest`] from queued events.
///
/// - Subjects are deduped by `(kind, externalId)` in first-seen order.
/// - Records and signals are concatenated in event order (stable), so the
///   output is deterministic — the contract test depends on this.
/// - `window` is the min/max of every INCLUDED event's `day` (lexicographic ==
///   calendar for `YYYY-MM-DD`), so every record/signal day lands inside it (the
///   server rejects out-of-window days).
/// - An event whose `event_type` is not [`USAGE_SUMMARY_EVENT_TYPE`], whose
///   payload fails to decode, OR whose `day` is not a valid `YYYY-MM-DD` is
///   skipped and recorded as an `other` gap — the builder never partial-parses
///   an unknown shape (honesty over guessing) and never emits a malformed day
///   that would poison the window (M2). A batch that ends up with zero
///   records/signals must NOT be uploaded (the engine enforces this) — uploading
///   an empty body would delete-then-upsert-nothing (data loss) or POST
///   `start = ""` (a 400).
pub fn build_request(
    agent_version: &str,
    summarizer_version: i64,
    source: &str,
    events: &[PendingEvent],
) -> IngestRequest {
    let mut subjects: Vec<SubjectDescriptor> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut records: Vec<MetricRecord> = Vec::new();
    let mut signals: Vec<SubDailySignal> = Vec::new();
    let mut gaps: Vec<HonestyGap> = Vec::new();
    let mut min_day: Option<String> = None;
    let mut max_day: Option<String> = None;

    for event in events {
        if event.event_type != USAGE_SUMMARY_EVENT_TYPE {
            gaps.push(HonestyGap {
                kind: "other".to_string(),
                detail: Some(format!(
                    "skipped unsupported event type `{}`",
                    event.event_type
                )),
            });
            continue;
        }
        let payload: UsageSummaryPayload = match serde_json::from_value(event.payload.clone()) {
            Ok(p) => p,
            Err(_) => {
                // Should-not-happen (the T3.3 validator gates enqueue); if it
                // does, drop the one bad row from the batch and note it —
                // never let a malformed payload poison the whole upload.
                gaps.push(HonestyGap {
                    kind: "other".to_string(),
                    detail: Some("skipped an unreadable queued summary".to_string()),
                });
                continue;
            }
        };

        if !is_valid_day(&payload.day) {
            // A malformed day would poison the window (M2). Skip + note, never
            // emit it; the server day regex would 400 the whole batch.
            gaps.push(HonestyGap {
                kind: "other".to_string(),
                detail: Some("skipped a summary with a malformed day".to_string()),
            });
            continue;
        }

        widen_window(&mut min_day, &mut max_day, &payload.day);

        let subject_key = format!("{}:{}", payload.subject.kind, payload.subject.external_id);
        if seen.insert(subject_key) {
            subjects.push(payload.subject.clone());
        }
        let subject_ref = SubjectRef {
            kind: payload.subject.kind.clone(),
            external_id: payload.subject.external_id.clone(),
        };

        for record in payload.records {
            records.push(MetricRecord {
                subject: subject_ref.clone(),
                metric_key: record.metric_key,
                day: payload.day.clone(),
                dim: record.dim,
                value: record.value,
                attribution: record.attribution,
            });
        }
        if let Some(signal) = payload.signal {
            signals.push(SubDailySignal {
                subject: subject_ref.clone(),
                day: payload.day.clone(),
                hours: signal.hours,
                peak_concurrency: signal.peak_concurrency,
                source_granularity: signal.source_granularity,
            });
        }
        gaps.extend(payload.gaps);
    }

    // A window is always required by the schema (start <= end). Empty batches
    // never reach here (the engine returns early on an empty queue); the
    // fallback keeps `build_request` total for any input the tests may pass.
    let start = min_day.unwrap_or_default();
    let end = max_day.unwrap_or_else(|| start.clone());

    IngestRequest {
        agent_version: agent_version.to_string(),
        summarizer_version,
        source: source.to_string(),
        window: Window { start, end },
        subjects,
        records,
        signals,
        gaps,
    }
}

/// Serialize + gzip an [`IngestRequest`] and package it with its source event
/// ids and a deterministic batch id. Errors only if JSON serialization fails
/// (structurally impossible for the value types here — mapped to
/// [`StoreError::Encode`] for a uniform error surface).
pub fn prepare_batch(
    request: IngestRequest,
    events: &[PendingEvent],
) -> Result<PreparedBatch, StoreError> {
    let json = serde_json::to_vec(&request).map_err(|_| StoreError::Encode)?;
    let gzip_body = gzip(&json).map_err(|_| StoreError::Encode)?;
    let event_ids: Vec<i64> = events.iter().map(|e| e.id).collect();
    let batch_id = deterministic_batch_id(events);
    Ok(PreparedBatch {
        request,
        gzip_body,
        event_ids,
        batch_id,
    })
}

/// gzip a byte slice with the pure-Rust flate2/miniz_oxide backend.
fn gzip(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    encoder.finish()
}

/// A content-addressed batch id: `SHA-256` over the sorted `event_id`s, base16.
/// Deterministic over the batch's CONTENTS, so a crash-then-restart that
/// rebuilds the identical event set produces the identical id — the local
/// `upload_receipts` check can then skip re-sending an already-uploaded batch.
/// It is a LOCAL bookkeeping key only; it is never sent to the server (the
/// server dedups on the frozen metric natural keys, not on any batch id).
pub fn deterministic_batch_id(events: &[PendingEvent]) -> String {
    let mut ids: Vec<&str> = events.iter().map(|e| e.event_id.as_str()).collect();
    ids.sort_unstable();
    let mut hasher = Sha256::new();
    for id in ids {
        hasher.update(id.as_bytes());
        hasher.update([0u8]); // length-unambiguous separator
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// The parseable `YYYY-MM-DD` day of an event, or `None` if it is not a
/// decodable `usage_summary` with a valid day (an unknown type, an unreadable
/// payload, or a malformed day). Such events carry nothing persistable — they
/// contribute no records and no window.
pub fn event_day(event: &PendingEvent) -> Option<String> {
    if event.event_type != USAGE_SUMMARY_EVENT_TYPE {
        return None;
    }
    let payload: UsageSummaryPayload = serde_json::from_value(event.payload.clone()).ok()?;
    if is_valid_day(&payload.day) {
        Some(payload.day)
    } else {
        None
    }
}

/// How many DISTINCT valid days the event set spans. Dayless events (see
/// [`event_day`]) are not counted — they carry no window. The engine uses this
/// to decide whether a chunk can be day-split (`> 1`) or must be sent whole /
/// quarantined (`<= 1`).
pub fn distinct_day_count(events: &[PendingEvent]) -> usize {
    events
        .iter()
        .filter_map(event_day)
        .collect::<HashSet<_>>()
        .len()
}

/// Split an event set on a DAY boundary so the two halves cover DISJOINT sets of
/// whole days — the load-bearing P0 invariant (see the module docs): a day is
/// never divided, and the two resulting windows never overlap, so no sub-batch's
/// destructive window-delete can erase another's committed rows.
///
/// The boundary is the median distinct day: `left` gets every event on a day
/// STRICTLY BEFORE it, `right` gets the rest (including dayless events, which
/// carry no window and ride along harmlessly). The caller guarantees
/// `distinct_day_count(&events) >= 2`, so both halves are non-empty and `left`'s
/// max day is strictly less than `right`'s min day.
pub fn split_events_by_day(events: Vec<PendingEvent>) -> (Vec<PendingEvent>, Vec<PendingEvent>) {
    let mut days: Vec<String> = events
        .iter()
        .filter_map(event_day)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    days.sort_unstable();
    // With >= 2 distinct days, the median index is >= 1, so at least one day is
    // strictly before the boundary (non-empty left) and the boundary day itself
    // is in the right (non-empty right).
    let boundary = days[days.len() / 2].clone();

    let mut left = Vec::new();
    let mut right = Vec::new();
    for event in events {
        match event_day(&event) {
            Some(day) if day < boundary => left.push(event),
            _ => right.push(event),
        }
    }
    (left, right)
}

/// Whether `s` is a `YYYY-MM-DD` calendar day (shape only — the server does the
/// full validation; this backstops the window against a malformed day, M2).
pub fn is_valid_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// Track the min/max `YYYY-MM-DD` day seen (lexicographic == chronological).
fn widen_window(min_day: &mut Option<String>, max_day: &mut Option<String>, day: &str) {
    match min_day {
        Some(current) if current.as_str() <= day => {}
        _ => *min_day = Some(day.to_string()),
    }
    match max_day {
        Some(current) if current.as_str() >= day => {}
        _ => *max_day = Some(day.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The checked-in fixture, produced by parsing an example through the real
    /// frozen zod schema (see `scripts/generate-agent-ingest-fixture.mjs`).
    const FIXTURE: &str = include_str!("../../fixtures/agent-ingest-request.json");

    /// Recursively coerce every JSON number to `f64` so equality ignores the
    /// int-vs-float distinction `serde_json::Value` otherwise draws: the schema
    /// emits `"value": 12` (integer) but a Rust `f64` field re-serializes as
    /// `12.0` (float), and `Number(12) != Number(12.0)` in serde_json. The wire
    /// type is `z.number()` (a single JS number), so this normalization compares
    /// what actually matters — keys, structure, array order, numeric value.
    fn normalize_numbers(value: serde_json::Value) -> serde_json::Value {
        use serde_json::Value;
        match value {
            Value::Number(n) => Value::from(n.as_f64().expect("finite number")),
            Value::Array(items) => Value::Array(items.into_iter().map(normalize_numbers).collect()),
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .map(|(k, v)| (k, normalize_numbers(v)))
                    .collect(),
            ),
            other => other,
        }
    }

    fn event(
        id: i64,
        event_id: &str,
        event_type: &str,
        payload: serde_json::Value,
    ) -> PendingEvent {
        PendingEvent {
            id,
            event_id: event_id.to_string(),
            connector_id: "claude_code".to_string(),
            event_type: event_type.to_string(),
            content_mode: "analytics_only".to_string(),
            occurred_at: 0,
            enqueued_at: 0,
            payload,
        }
    }

    /// CONTRACT TEST: the hand-mirrored Rust struct round-trips the frozen
    /// AgentIngestRequest fixture byte-equivalently. Deserializing proves every
    /// field name/shape matches; re-serializing and comparing as
    /// `serde_json::Value` (key-order-insensitive, array-order-sensitive)
    /// proves nothing is dropped, renamed, or reordered.
    #[test]
    fn rust_struct_round_trips_the_frozen_fixture() {
        let fixture_value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let request: IngestRequest = serde_json::from_str(FIXTURE).unwrap();
        let reserialized = serde_json::to_value(&request).unwrap();
        assert_eq!(
            normalize_numbers(reserialized),
            normalize_numbers(fixture_value),
            "the Rust IngestRequest struct must be a faithful mirror of the frozen schema"
        );
    }

    /// The batch builder, fed an equivalent queue, produces EXACTLY the frozen
    /// fixture (subjects deduped, records concatenated in order, window from
    /// min/max day, gaps carried through).
    #[test]
    fn builder_output_matches_the_frozen_fixture() {
        let events = vec![
            event(
                1,
                "e-2026-07-15",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({
                    "subject": { "kind": "person", "externalId": "user-abc", "email": null, "displayName": null },
                    "day": "2026-07-15",
                    "records": [
                        { "metricKey": "prompts", "dim": "", "value": 12, "attribution": "person" },
                        { "metricKey": "sessions", "dim": "", "value": 2, "attribution": "person" },
                        { "metricKey": "model_requests", "dim": "claude-sonnet-4", "value": 8, "attribution": "person" }
                    ],
                    "signal": {
                        "hours": [0,0,0,0,0,0,0,0,0,2,3,1,0,4,2,1,0,0,0,0,0,0,0,0],
                        "peakConcurrency": 1,
                        "sourceGranularity": "1h"
                    },
                    "gaps": []
                }),
            ),
            event(
                2,
                "e-2026-07-16",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({
                    "subject": { "kind": "person", "externalId": "user-abc" },
                    "day": "2026-07-16",
                    "records": [
                        { "metricKey": "prompts", "value": 5, "attribution": "person" }
                    ],
                    "gaps": [
                        { "kind": "other", "detail": "Some sessions on 2026-07-16 could not be attributed to a source file." }
                    ]
                }),
            ),
        ];

        let request = build_request("0.1.0", SUMMARIZER_VERSION, DEFAULT_INGEST_SOURCE, &events);
        let built = serde_json::to_value(&request).unwrap();
        let fixture_value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(normalize_numbers(built), normalize_numbers(fixture_value));
    }

    #[test]
    fn window_spans_min_and_max_day() {
        let events = vec![
            event(
                1,
                "b",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({ "subject": { "kind": "person", "externalId": "u" }, "day": "2026-03-10", "records": [] }),
            ),
            event(
                2,
                "a",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({ "subject": { "kind": "person", "externalId": "u" }, "day": "2026-03-02", "records": [] }),
            ),
            event(
                3,
                "c",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({ "subject": { "kind": "person", "externalId": "u" }, "day": "2026-03-20", "records": [] }),
            ),
        ];
        let request = build_request("0.1.0", 1, DEFAULT_INGEST_SOURCE, &events);
        assert_eq!(request.window.start, "2026-03-02");
        assert_eq!(request.window.end, "2026-03-20");
        // One subject (deduped across the three events).
        assert_eq!(request.subjects.len(), 1);
    }

    /// ADR 0060: the wire `source` defaults to the live connector, and the
    /// export connector maps to the `claude-export` source, so the server
    /// composes a distinct `source_connector` and scopes its window-delete.
    #[test]
    fn source_defaults_to_live_and_maps_the_separate_connectors() {
        assert_eq!(
            wire_source_for_connector("claude_code"),
            "claude-code-local"
        );
        assert_eq!(
            wire_source_for_connector(CLAUDE_EXPORT_CONNECTOR_ID),
            "claude-export"
        );
        // The AI-app presence connector gets its OWN source (D-DA-8): sharing
        // `claude-code-local` would let its window-delete erase the live
        // connector's day.
        assert_eq!(wire_source_for_connector(AI_TOOLS_CONNECTOR_ID), "ai-tools");
        // An unknown connector uploads as the live connector (safe default).
        assert_eq!(wire_source_for_connector("mystery"), "claude-code-local");

        let events = vec![day_event(1, "P", "2026-01-01")];
        let live = build_request("0.1.0", 1, DEFAULT_INGEST_SOURCE, &events);
        assert_eq!(live.source, "claude-code-local");
        let export = build_request("0.1.0", 1, "claude-export", &events);
        assert_eq!(export.source, "claude-export");
    }

    #[test]
    fn unsupported_event_type_becomes_a_gap_not_a_partial_parse() {
        let events = vec![event(
            1,
            "x",
            "some_future_type",
            json!({ "anything": true }),
        )];
        let request = build_request("0.1.0", 1, DEFAULT_INGEST_SOURCE, &events);
        assert!(request.records.is_empty());
        assert_eq!(request.gaps.len(), 1);
        assert_eq!(request.gaps[0].kind, "other");
    }

    #[test]
    fn deterministic_batch_id_is_content_addressed_and_order_independent() {
        let a = event(1, "e1", USAGE_SUMMARY_EVENT_TYPE, json!({}));
        let b = event(2, "e2", USAGE_SUMMARY_EVENT_TYPE, json!({}));
        // Same event_ids in either row order → same id (survives a restart that
        // reorders rows), and different from a different set.
        let id_ab = deterministic_batch_id(&[a.clone(), b.clone()]);
        let id_ba = deterministic_batch_id(&[b.clone(), a.clone()]);
        assert_eq!(id_ab, id_ba);
        let id_a = deterministic_batch_id(&[a]);
        assert_ne!(id_ab, id_a);
        assert_eq!(id_ab.len(), 64, "sha-256 hex is 64 chars");
    }

    /// A `usage_summary` event on `day` for `subject` with one prompts record.
    fn day_event(id: i64, subject: &str, day: &str) -> PendingEvent {
        event(
            id,
            &format!("e{id}"),
            USAGE_SUMMARY_EVENT_TYPE,
            json!({
                "subject": { "kind": "person", "externalId": subject },
                "day": day,
                "records": [ { "metricKey": "prompts", "value": 1, "attribution": "person" } ]
            }),
        )
    }

    /// P0: splitting is BY DAY, so the two halves' windows are DISJOINT and a
    /// day is never divided across them — even when the same day's events are
    /// interleaved in the queue and would straddle a naive count midpoint.
    #[test]
    fn split_by_day_produces_disjoint_windows() {
        // Queue order interleaves subjects on the same day (01-03), so a
        // count-midpoint split would put 01-03 on BOTH sides (overlapping
        // windows). Day-splitting must keep 01-03 whole.
        let events = vec![
            day_event(1, "P", "2026-01-01"),
            day_event(2, "Q", "2026-01-03"),
            day_event(3, "X", "2026-01-03"),
            day_event(4, "R", "2026-01-05"),
        ];
        let (left, right) = split_events_by_day(events);
        assert!(
            !left.is_empty() && !right.is_empty(),
            "both halves non-empty"
        );

        let left_days: HashSet<String> = left.iter().filter_map(event_day).collect();
        let right_days: HashSet<String> = right.iter().filter_map(event_day).collect();
        assert!(
            left_days.is_disjoint(&right_days),
            "no day may appear in both halves: {left_days:?} vs {right_days:?}"
        );
        // Strict window separation: left's max day < right's min day.
        let left_max = left_days.iter().max().unwrap();
        let right_min = right_days.iter().min().unwrap();
        assert!(
            left_max < right_min,
            "windows must not overlap: left max {left_max}, right min {right_min}"
        );
        // 01-03 lands wholly on one side (both Q and X together).
        let day3: Vec<&str> = left
            .iter()
            .chain(right.iter())
            .filter(|e| event_day(e).as_deref() == Some("2026-01-03"))
            .map(|e| e.event_id.as_str())
            .collect();
        assert_eq!(day3.len(), 2, "both 01-03 events survive the split");
    }

    #[test]
    fn distinct_day_count_ignores_dayless_events() {
        let events = vec![
            day_event(1, "P", "2026-01-01"),
            day_event(2, "Q", "2026-01-01"),
            event(3, "bad", "unknown_type", json!({})),
        ];
        // Two events share a day, one is dayless → exactly one distinct day.
        assert_eq!(distinct_day_count(&events), 1);
    }

    #[test]
    fn malformed_or_missing_day_is_skipped_not_emitted() {
        let events = vec![
            day_event(1, "P", "2026-01-01"),
            event(
                2,
                "bad",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({ "subject": { "kind": "person", "externalId": "Q" }, "day": "07/15", "records": [ { "metricKey": "prompts", "value": 9, "attribution": "person" } ] }),
            ),
        ];
        let request = build_request("0.1.0", 1, DEFAULT_INGEST_SOURCE, &events);
        // Only the valid-day record survives; the malformed day never reaches
        // the window (which would 400 the whole batch).
        assert_eq!(request.records.len(), 1);
        assert_eq!(request.window.start, "2026-01-01");
        assert_eq!(request.window.end, "2026-01-01");
        assert!(request.gaps.iter().any(|g| g.kind == "other"));
    }

    #[test]
    fn gzip_round_trips_and_shrinks_repetitive_json() {
        let request = build_request(
            "0.1.0",
            1,
            DEFAULT_INGEST_SOURCE,
            &[event(
                1,
                "e",
                USAGE_SUMMARY_EVENT_TYPE,
                json!({ "subject": { "kind": "person", "externalId": "u" }, "day": "2026-01-01", "records": [] }),
            )],
        );
        let prepared = prepare_batch(request.clone(), &[]).unwrap();
        // gzip magic bytes.
        assert_eq!(&prepared.gzip_body[..2], &[0x1f, 0x8b]);

        // Inflate and confirm the JSON is intact.
        use flate2::read::GzDecoder;
        use std::io::Read;
        let mut decoder = GzDecoder::new(&prepared.gzip_body[..]);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out).unwrap();
        let round: IngestRequest = serde_json::from_slice(&out).unwrap();
        assert_eq!(round, request);
    }
}
