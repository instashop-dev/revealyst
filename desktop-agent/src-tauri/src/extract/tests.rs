//! T3.4 extractor tests. Four guarantees, all CI-run (Rust job):
//!
//! 1. **CLI golden parity** — the day-aggregate equals the CLI reference
//!    summarizer's known-truth outputs (`packages/revealyst-agent/tests/
//!    summarize.test.ts`) for the same fixture inputs. We rebuild the parsed
//!    events by hand (parsing is T5.1's job, not the extractor's) and assert the
//!    aggregate field-by-field.
//! 2. **Counts only, no leak** — the serialized output's sent scalar strings are
//!    bounded (<= 64) and NOTHING in the output contains the counted prompt
//!    text; the char/word-count path measured the content, then dropped it.
//! 3. **Classifier absent (D-DA-5)** — no `taskCategory` / `workflowType` /
//!    `complexityBand` / `has*` / classifier-version fields are emitted.
//! 4. **Validator pass by construction** — every candidate event flows through
//!    T3.3's `validate_and_enqueue` clean (zero quarantined) and lands in the
//!    queue.

use super::*;
use crate::privacy::{validate, validate_and_enqueue, ContentMode, PolicyResolution};
use crate::store::crypto::{DbKey, KEY_LEN};
use crate::store::Store;

// ---- Fixture builders (parsed-event form, mirroring the CLI fixtures) --------

/// Epoch ms for a UTC wall time (inverse of the module's civil helper).
fn ms(y: i64, mo: u32, d: u32, h: i64, mi: i64, s: i64) -> i64 {
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = (if yy >= 0 { yy } else { yy - 399 }) / 400;
    let yoe = yy - era * 400;
    let mp = (if mo > 2 { mo - 3 } else { mo + 9 }) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    (days * 86_400 + h * 3_600 + mi * 60 + s) * 1_000
}

fn usage(input: u64, output: u64, cache_read: u64, cache_write: u64) -> UsageNumbers {
    UsageNumbers {
        input,
        output,
        cache_read,
        cache_write,
    }
}

fn prompt(session: &str, ts: i64, sidechain: bool, content: &str) -> SourceRecord {
    SourceRecord {
        kind: RecordKind::Prompt,
        session_id: session.to_string(),
        timestamp_ms: ts,
        is_sidechain: sidechain,
        dedup_key: String::new(),
        model: None,
        usage: None,
        content: Some(content.to_string()),
    }
}

fn activity(session: &str, ts: i64, sidechain: bool) -> SourceRecord {
    SourceRecord {
        kind: RecordKind::Activity,
        session_id: session.to_string(),
        timestamp_ms: ts,
        is_sidechain: sidechain,
        dedup_key: String::new(),
        model: None,
        usage: None,
        content: None,
    }
}

fn assistant(
    session: &str,
    ts: i64,
    sidechain: bool,
    dedup: &str,
    model: &str,
    usage: UsageNumbers,
) -> SourceRecord {
    SourceRecord {
        kind: RecordKind::Assistant,
        session_id: session.to_string(),
        timestamp_ms: ts,
        is_sidechain: sidechain,
        dedup_key: dedup.to_string(),
        model: Some(model.to_string()),
        usage: Some(usage),
        content: None,
    }
}

/// The main + sidechain fixtures in parsed-event form. Deliberately includes the
/// duplicate streamed assistant line (`req-main-1` twice) to exercise last-wins
/// dedup, and the 2026-06-25 out-of-window turn (999999 tokens) to prove the
/// window filter.
fn fixture_records() -> Vec<SourceRecord> {
    vec![
        // main-session.jsonl
        prompt(
            "sess-main-1",
            ms(2026, 7, 1, 9, 12, 0),
            false,
            "SENTINEL_PROMPT_ALPHA",
        ),
        assistant(
            "sess-main-1",
            ms(2026, 7, 1, 9, 12, 20),
            false,
            "req-main-1",
            "claude-fable-5",
            usage(1200, 300, 5000, 800),
        ),
        // streamed duplicate of req-main-1 (last-wins → collapses to one turn)
        assistant(
            "sess-main-1",
            ms(2026, 7, 1, 9, 12, 25),
            false,
            "req-main-1",
            "claude-fable-5",
            usage(1200, 300, 5000, 800),
        ),
        activity("sess-main-1", ms(2026, 7, 1, 9, 12, 40), false), // tool-result
        activity("sess-main-1", ms(2026, 7, 1, 9, 13, 0), false),  // attachment
        assistant(
            "sess-main-1",
            ms(2026, 7, 1, 10, 30, 0),
            false,
            "req-main-2",
            "claude-sonnet-5",
            usage(400, 100, 0, 0),
        ),
        prompt(
            "sess-main-1",
            ms(2026, 7, 2, 8, 0, 0),
            false,
            "SENTINEL_PROMPT_DELTA",
        ),
        assistant(
            "sess-main-1",
            ms(2026, 7, 2, 8, 0, 30),
            false,
            "req-main-3",
            "claude-fable-5",
            usage(100, 50, 0, 0),
        ),
        // out of window — must never appear in any output
        assistant(
            "sess-main-1",
            ms(2026, 6, 25, 9, 0, 0),
            false,
            "req-main-old",
            "claude-opus-4-8",
            usage(999_999, 999_999, 0, 0),
        ),
        // sidechain-session.jsonl
        activity("sess-side-1", ms(2026, 7, 1, 9, 20, 0), true),
        assistant(
            "sess-side-1",
            ms(2026, 7, 1, 9, 21, 0),
            true,
            "req-side-1",
            "claude-haiku-4-5-20251001",
            usage(2000, 500, 100, 0),
        ),
    ]
}

fn opts() -> ExtractOptions {
    ExtractOptions {
        subject_external_id: "dev@example.com".to_string(),
        connector_id: "claude_code".to_string(),
        window_start: "2026-07-01".to_string(),
        window_end: "2026-07-31".to_string(),
    }
}

fn value(out: &ExtractOutput, key: MetricKey, day: &str, dim: &str) -> Option<f64> {
    out.records
        .iter()
        .find(|r| r.metric_key == key && r.day == day && r.dim == dim)
        .map(|r| r.value)
}

fn signal<'a>(out: &'a ExtractOutput, day: &str) -> &'a DaySignal {
    out.signals
        .iter()
        .find(|s| s.day == day)
        .expect("signal for day")
}

fn day_counts<'a>(out: &'a ExtractOutput, day: &str) -> &'a DayCounts {
    out.counts
        .iter()
        .find(|c| c.day == day)
        .expect("counts for day")
}

// ---- 1. CLI golden parity ---------------------------------------------------

/// The day-aggregate matches the CLI summarizer's known truth (the exact values
/// `summarize.test.ts` asserts): last-wins dedup, sidechain tokens summed but
/// sidechain ≠ session, tool-result ≠ prompt, UTC day bucketing.
#[test]
fn aggregate_matches_cli_summarize_known_truth() {
    let out = extract(&fixture_records(), &opts());

    // Day 1 token sums (streamed turn once, sidechain usage included).
    assert_eq!(
        value(&out, MetricKey::TokensInput, "2026-07-01", ""),
        Some(3600.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensOutput, "2026-07-01", ""),
        Some(900.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensCacheRead, "2026-07-01", ""),
        Some(5100.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensCacheWrite, "2026-07-01", ""),
        Some(800.0)
    );
    // Day 2.
    assert_eq!(
        value(&out, MetricKey::TokensInput, "2026-07-02", ""),
        Some(100.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensOutput, "2026-07-02", ""),
        Some(50.0)
    );

    // Human sessions only; tool-result ≠ prompt; active_day.
    assert_eq!(
        value(&out, MetricKey::Sessions, "2026-07-01", ""),
        Some(1.0)
    );
    assert_eq!(
        value(&out, MetricKey::Sessions, "2026-07-02", ""),
        Some(1.0)
    );
    assert_eq!(value(&out, MetricKey::Prompts, "2026-07-01", ""), Some(1.0));
    assert_eq!(value(&out, MetricKey::Prompts, "2026-07-02", ""), Some(1.0));
    assert_eq!(
        value(&out, MetricKey::ActiveDay, "2026-07-01", ""),
        Some(1.0)
    );

    // Model mix, one request per deduped turn.
    assert_eq!(
        value(
            &out,
            MetricKey::ModelRequests,
            "2026-07-01",
            "model=claude-fable-5"
        ),
        Some(1.0)
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelRequests,
            "2026-07-01",
            "model=claude-sonnet-5"
        ),
        Some(1.0)
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelRequests,
            "2026-07-01",
            "model=claude-haiku-4-5-20251001"
        ),
        Some(1.0)
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelTokens,
            "2026-07-01",
            "model=claude-fable-5"
        ),
        Some(1500.0)
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelTokens,
            "2026-07-01",
            "model=claude-haiku-4-5-20251001"
        ),
        Some(2500.0)
    );

    // Spend estimate (fable@opus 6.30 + sonnet 0.27 + haiku 0.451 = 7.021 → 7.02).
    let spend = value(&out, MetricKey::SpendCentsEstimated, "2026-07-01", "").unwrap();
    assert!((spend - 7.02).abs() < 1e-9, "spend was {spend}");
}

/// Window filtering: the 2026-06-25 turn (999999 tokens) never appears.
#[test]
fn out_of_window_events_are_excluded() {
    let out = extract(&fixture_records(), &opts());
    assert!(out.records.iter().all(|r| r.day.as_str() >= "2026-07-01"));
    assert_eq!(value(&out, MetricKey::TokensInput, "2026-06-25", ""), None);
    assert!(out.signals.iter().all(|s| s.day.as_str() >= "2026-07-01"));
}

/// Hour histogram from DEDUPED events + real interval-overlap concurrency
/// (matches the CLI signal truth).
#[test]
fn signals_match_cli_histogram_and_concurrency() {
    let out = extract(&fixture_records(), &opts());

    let day1 = signal(&out, "2026-07-01");
    // hr9 deduped: prompt, 1 assistant (req-main-1 collapsed), tool-result,
    // attachment, sidechain activity, sidechain assistant = 6.
    assert_eq!(day1.hours[9], 6);
    assert_eq!(day1.hours[10], 1); // req-main-2
    assert_eq!(day1.hours.iter().sum::<u32>(), 7);
    assert_eq!(day1.source_granularity, "event");
    // Sidechain [09:20,09:21] runs inside main [09:12,10:30] → 2 overlap.
    assert_eq!(day1.peak_concurrency, 2);

    let day2 = signal(&out, "2026-07-02");
    assert_eq!(day2.hours[8], 2);
    assert_eq!(day2.peak_concurrency, 1);
}

/// The record emission order matches the CLI: days sorted, the eight flat
/// metrics in fixed order, then model dims sorted by model.
#[test]
fn record_order_is_deterministic_and_cli_shaped() {
    let out = extract(&fixture_records(), &opts());
    let day1: Vec<(&str, &str)> = out
        .records
        .iter()
        .filter(|r| r.day == "2026-07-01")
        .map(|r| (r.metric_key.as_str(), r.dim.as_str()))
        .collect();
    assert_eq!(
        day1,
        vec![
            ("active_day", ""),
            ("sessions", ""),
            ("prompts", ""),
            ("tokens_input", ""),
            ("tokens_output", ""),
            ("tokens_cache_read", ""),
            ("tokens_cache_write", ""),
            ("spend_cents_estimated", ""),
            ("model_requests", "model=claude-fable-5"),
            ("model_requests", "model=claude-haiku-4-5-20251001"),
            ("model_requests", "model=claude-sonnet-5"),
            ("model_tokens", "model=claude-fable-5"),
            ("model_tokens", "model=claude-haiku-4-5-20251001"),
            ("model_tokens", "model=claude-sonnet-5"),
        ]
    );
}

/// Determinism: same input → identical records/signals/counts.
#[test]
fn extraction_is_deterministic() {
    let a = extract(&fixture_records(), &opts());
    let b = extract(&fixture_records(), &opts());
    assert_eq!(a.records, b.records);
    assert_eq!(a.signals, b.signals);
    assert_eq!(a.counts, b.counts);
}

// ---- 2. Counts only, no leak ------------------------------------------------

/// Every source-content substring we fed in. If any survives into the output,
/// the char/word-count path leaked the text it was only allowed to measure.
const SENTINELS: [&str; 3] = ["SENTINEL_PROMPT_ALPHA", "SENTINEL_PROMPT_DELTA", "SENTINEL"];

/// A JSON dump of everything the extractor produced (records, signals, counts,
/// and each candidate event's id + payload) — the surface a leak would show up
/// on.
fn output_dump(out: &ExtractOutput) -> String {
    let mut s = String::new();
    s.push_str(&serde_json::to_string(&out.records).unwrap());
    s.push_str(&serde_json::to_string(&out.signals).unwrap());
    s.push_str(&serde_json::to_string(&out.counts).unwrap());
    for ev in &out.candidate_events {
        s.push_str(&ev.event_id);
        s.push_str(&ev.event_type);
        s.push_str(&ev.payload.to_string());
    }
    s
}

fn collect_strings(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(a) => a.iter().for_each(|x| collect_strings(x, out)),
        serde_json::Value::Object(m) => m.values().for_each(|x| collect_strings(x, out)),
        _ => {}
    }
}

/// The counted content was measured (char/word counts > 0) yet NONE of it
/// leaked anywhere in the output — the content was dropped after counting
/// (spec §7.2, D-DA-5).
#[test]
fn counted_content_is_measured_then_dropped() {
    let out = extract(&fixture_records(), &opts());

    // It WAS counted: "SENTINEL_PROMPT_ALPHA" is 21 scalar values, 1 word.
    let day1 = day_counts(&out, "2026-07-01");
    assert_eq!(day1.prompt_character_count, 21);
    assert_eq!(day1.prompt_word_count, 1);
    let day2 = day_counts(&out, "2026-07-02");
    assert_eq!(day2.prompt_character_count, 21);
    assert_eq!(day2.prompt_word_count, 1);
    // Shape counts too.
    assert_eq!(day1.assistant_turn_count, 3);
    assert_eq!(day1.tool_activity_count, 3);
    assert_eq!(day2.assistant_turn_count, 1);
    assert_eq!(day2.tool_activity_count, 0);

    // ...and it was DROPPED: no sentinel appears anywhere.
    let dump = output_dump(&out);
    for sentinel in SENTINELS {
        assert!(
            !dump.contains(sentinel),
            "counted content `{sentinel}` leaked into the output"
        );
    }
}

/// Property: every sent scalar STRING in a candidate payload is a bounded label
/// (<= 64 scalar values) and carries no source content. The only such string is
/// the sanitized model id.
#[test]
fn candidate_payload_strings_are_bounded_labels() {
    let out = extract(&fixture_records(), &opts());
    assert!(!out.candidate_events.is_empty());
    for ev in &out.candidate_events {
        let mut strings = Vec::new();
        collect_strings(&ev.payload, &mut strings);
        for s in strings {
            assert!(
                s.chars().count() <= counts::MAX_MODEL_LEN,
                "payload string `{s}` exceeds the enum bound"
            );
            for sentinel in SENTINELS {
                assert!(!s.contains(sentinel), "payload string leaked `{sentinel}`");
            }
        }
    }
}

// ---- 3. Classifier absent (D-DA-5) ------------------------------------------

/// The classifier half of `LocalPromptFeatures` is NOT emitted — no
/// `taskCategory` / `workflowType` / `complexityBand` / prompt-structure boolean
/// / classifier-version field appears anywhere in the output. This is the
/// D-DA-5 default: shape + counts only, classifier fields blocked pending T5.2.
#[test]
fn classifier_fields_are_absent() {
    let out = extract(&fixture_records(), &opts());
    let dump = output_dump(&out);
    for banned in [
        "taskCategory",
        "workflowType",
        "complexityBand",
        "hasContext",
        "hasConstraints",
        "hasExamples",
        "hasOutputFormat",
        "hasSuccessCriteria",
        "hasRoleInstruction",
        "hasDataProvided",
        "hasFollowUp",
        "localClassifierVersion",
        "localClassifierConfidence",
    ] {
        assert!(
            !dump.contains(banned),
            "classifier field `{banned}` must not be emitted (D-DA-5)"
        );
    }
}

// ---- 4. Validator pass by construction --------------------------------------

fn store() -> Store {
    Store::open_in_memory(DbKey::from_bytes([7u8; KEY_LEN])).unwrap()
}

/// Every candidate event passes T3.3's `validate` on its own...
#[test]
fn every_candidate_event_validates() {
    let out = extract(&fixture_records(), &opts());
    assert_eq!(
        out.candidate_events.len(),
        4,
        "3 models day1 + 1 model day2"
    );
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    for ev in &out.candidate_events {
        assert!(
            validate(&ev.payload, &policy).is_ok(),
            "candidate payload must validate: {}",
            ev.payload
        );
    }
}

/// ...and the whole batch flows through the enqueue gate clean — nothing
/// quarantined, everything queued.
#[test]
fn candidate_events_enqueue_through_the_privacy_gate() {
    let out = extract(&fixture_records(), &opts());
    let store = store();
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    let outcome = validate_and_enqueue(
        &store,
        &policy,
        "claude_code",
        &out.candidate_events,
        "checkpoint-1",
        100,
    )
    .unwrap();
    assert_eq!(outcome.quarantined, 0);
    assert_eq!(outcome.enqueued, out.candidate_events.len());
    assert!(!outcome.halted);
    assert_eq!(
        store.pending_count().unwrap(),
        out.candidate_events.len() as i64
    );
}

/// The candidate payloads carry ONLY allowlisted `sent: true` keys plus the two
/// reserved privacy flags — no on-device-only (`sent:false`) input ever rides
/// along.
#[test]
fn candidate_payloads_carry_only_sent_keys() {
    let out = extract(&fixture_records(), &opts());
    for ev in &out.candidate_events {
        let obj = ev.payload.as_object().expect("payload is an object");
        for key in obj.keys() {
            let is_flag = key.eq_ignore_ascii_case("rawPromptIncluded")
                || key.eq_ignore_ascii_case("rawResponseIncluded");
            assert!(
                is_flag || (crate::allowlist::is_allowed(key) && crate::allowlist::is_sent(key)),
                "payload key `{key}` is neither a reserved flag nor an allowlisted sent field"
            );
        }
    }
}
