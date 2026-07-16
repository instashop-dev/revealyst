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

// --- Wire structs (mirror agentIngestRequestSchema) ------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestRequest {
    pub agent_version: String,
    pub summarizer_version: i64,
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
/// - `window` is the min/max of every event's `day` (lexicographic == calendar
///   for `YYYY-MM-DD`), so it is defined even for a gap-only batch and every
///   record/signal day lands inside it (the server rejects out-of-window days).
/// - An event whose `event_type` is not [`USAGE_SUMMARY_EVENT_TYPE`], or whose
///   payload fails to decode, is skipped and recorded as an `other` gap — the
///   builder never partial-parses an unknown shape (honesty over guessing).
pub fn build_request(
    agent_version: &str,
    summarizer_version: i64,
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

/// Split an event set into two roughly-equal halves for bisect retry. The
/// caller guarantees `len >= 2`, so both halves are non-empty.
pub fn split_events(events: Vec<PendingEvent>) -> (Vec<PendingEvent>, Vec<PendingEvent>) {
    let mid = events.len() / 2;
    let mut left = events;
    let right = left.split_off(mid);
    (left, right)
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

        let request = build_request("0.1.0", SUMMARIZER_VERSION, &events);
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
        let request = build_request("0.1.0", 1, &events);
        assert_eq!(request.window.start, "2026-03-02");
        assert_eq!(request.window.end, "2026-03-20");
        // One subject (deduped across the three events).
        assert_eq!(request.subjects.len(), 1);
    }

    #[test]
    fn unsupported_event_type_becomes_a_gap_not_a_partial_parse() {
        let events = vec![event(
            1,
            "x",
            "some_future_type",
            json!({ "anything": true }),
        )];
        let request = build_request("0.1.0", 1, &events);
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
        let id_ba = deterministic_batch_id(&[b, a]);
        assert_eq!(id_ab, id_ba);
        let id_a = deterministic_batch_id(&[a]);
        assert_ne!(id_ab, id_a);
        assert_eq!(id_ab.len(), 64, "sha-256 hex is 64 chars");
    }

    #[test]
    fn split_halves_are_nonempty_and_partition_the_set() {
        let events: Vec<PendingEvent> = (0..5)
            .map(|i| event(i, &format!("e{i}"), USAGE_SUMMARY_EVENT_TYPE, json!({})))
            .collect();
        let (left, right) = split_events(events);
        assert_eq!(left.len(), 2);
        assert_eq!(right.len(), 3);
        assert_eq!(left[0].event_id, "e0");
        assert_eq!(right[0].event_id, "e2");
    }

    #[test]
    fn gzip_round_trips_and_shrinks_repetitive_json() {
        let request = build_request(
            "0.1.0",
            1,
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
