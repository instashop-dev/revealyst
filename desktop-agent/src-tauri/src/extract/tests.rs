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
//! 3. **Classifier present, content-free (D-DA-5 / ADR 0059)** — the work-type
//!    classifier emits ONLY closed-enum `task_category` labels + `iteration_depth`
//!    / `verification_behavior` counts; the fields we deliberately did NOT build
//!    (`workflowType` / `complexityBand` / `has*` / classifier-version) stay
//!    absent, and no prompt substring leaks through classification.
//! 4. **Validator pass by construction** — every candidate event (usage AND
//!    worktype) flows through T3.3's `validate`/`validate_and_enqueue` clean (zero
//!    quarantined), and an out-of-enum `task_category` label quarantines.

use super::classify::TaskCategory;
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
    // Worktype surfaces (ADR 0059) are part of the leak-check too: a classifier
    // that echoed prompt text would surface here.
    s.push_str(&serde_json::to_string(&out.worktype_records).unwrap());
    for wt in &out.worktype {
        s.push_str(&wt.day);
        for (category, count) in &wt.category_counts {
            s.push_str(category.as_str());
            s.push_str(&count.to_string());
        }
        s.push_str(&wt.iteration_depth.to_string());
        s.push_str(&wt.verification_behavior.to_string());
    }
    for ev in out
        .candidate_events
        .iter()
        .chain(out.worktype_candidate_events.iter())
    {
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

// ---- 3. Classifier present, content-free (D-DA-5 / ADR 0059) ----------------

/// The fields we deliberately did NOT build under ADR 0059 stay absent — only
/// `task_category` / `iteration_depth` / `verification_behavior` are the
/// classifier's outputs. `workflowType` / `complexityBand` / the prompt-structure
/// booleans (`hasContext`, …) / classifier-version fields are the separately-
/// deferred `LocalPromptFeatures` half and must never surface.
#[test]
fn unbuilt_classifier_fields_stay_absent() {
    let out = extract(&fixture_records(), &opts());
    let dump = output_dump(&out);
    for banned in [
        // camelCase (spec `LocalPromptFeatures`)…
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
        // …and snake_case — our structs serde-serialize snake_case, so a
        // deferred field would surface in these forms, not the camelCase ones.
        "workflow_type",
        "complexity_band",
        "has_context",
        "has_constraints",
        "has_examples",
        "has_output_format",
        "has_success_criteria",
        "has_role_instruction",
        "has_data_provided",
        "has_follow_up",
        "local_classifier_version",
        "local_classifier_confidence",
    ] {
        assert!(
            !dump.contains(banned),
            "deferred classifier field `{banned}` must not be emitted (ADR 0059)"
        );
    }
}

/// The work-type classifier IS present now (ADR 0059): the fixture prompts are
/// classified into closed-enum `task_category` records + candidate events, and
/// EVERY emitted `task_category` dim/label is a value from the closed enum — so
/// no free string (a smuggled snippet) can ever be the label. The two fixture
/// prompts ("SENTINEL_PROMPT_*") carry no keyword, so they classify to `other`.
#[test]
fn worktype_is_emitted_as_closed_enum_labels_only() {
    let out = extract(&fixture_records(), &opts());

    // task_category records exist and land on the SEPARATE worktype_records vec,
    // NOT on the CLI-parity `records` vec.
    assert!(
        !out.worktype_records.is_empty(),
        "the classifier must emit worktype records for the fixture prompts"
    );
    assert!(
        out.records
            .iter()
            .all(|r| r.metric_key != MetricKey::TaskCategory),
        "worktype records must not pollute the CLI-parity `records` vec"
    );

    // Both fixture days classify their one human prompt to `other` (no keyword).
    for day in ["2026-07-01", "2026-07-02"] {
        let count = out
            .worktype_records
            .iter()
            .find(|r| {
                r.metric_key == MetricKey::TaskCategory
                    && r.day == day
                    && r.dim == "task_category=other"
            })
            .map(|r| r.value);
        assert_eq!(count, Some(1.0), "day {day} should have 1 `other` prompt");
    }

    // EVERY task_category dim is `task_category=<known label>` — the closed set.
    let known: std::collections::BTreeSet<&str> = [
        "analysis",
        "coding",
        "drafting",
        "ideation",
        "other",
        "planning",
        "research",
        "review",
        "summarization",
    ]
    .into_iter()
    .collect();
    for r in &out.worktype_records {
        if r.metric_key == MetricKey::TaskCategory {
            let label = r.dim.strip_prefix("task_category=").expect("dim prefix");
            assert!(
                known.contains(label),
                "task_category label `{label}` is not in the closed enum"
            );
        }
    }
}

/// A long, content-rich prompt is classified to a closed-enum label + counts and
/// NOTHING of its content survives — the borrow-and-drop guarantee, extended from
/// counting (`count_text`) to classification (spec §16.3 / ADR 0055 §2.4).
#[test]
fn rich_prompt_classifies_without_leaking_any_substring() {
    // A verbose, secret-bearing prompt with distinctive tokens. It DOES classify
    // (it contains "refactor"→coding, "verify"→verification, "make it"→refinement)
    // but none of the secret words may appear in any output surface.
    let secret_words = [
        "ZZQCONFIDENTIAL",
        "projectbluefalcon",
        "acquisitiontarget",
        "salaryfigures",
    ];
    let rich = format!(
        "Please refactor the {} module for {}, then verify the {} and make it handle {} correctly.",
        secret_words[0], secret_words[1], secret_words[2], secret_words[3]
    );
    let records = vec![prompt(
        "sess-rich",
        ms(2026, 7, 3, 10, 0, 0),
        false,
        &rich,
    )];
    let out = extract(&records, &opts());

    // It WAS classified (coding, with refinement + verification detected).
    let wt = out
        .worktype
        .iter()
        .find(|w| w.day == "2026-07-03")
        .expect("worktype for the rich day");
    assert_eq!(wt.category_counts.get(&TaskCategory::Coding), Some(&1));
    assert_eq!(wt.iteration_depth, 1);
    assert_eq!(wt.verification_behavior, 1);

    // …yet NONE of the secret content leaked anywhere in the output.
    let dump = output_dump(&out);
    for secret in secret_words {
        assert!(
            !dump.contains(secret),
            "classified content `{secret}` leaked into the output"
        );
    }
    // The only strings in the worktype candidate payloads are closed-enum labels.
    for ev in &out.worktype_candidate_events {
        let mut strings = Vec::new();
        collect_strings(&ev.payload, &mut strings);
        for s in strings {
            assert!(
                s.chars().count() <= counts::MAX_MODEL_LEN,
                "worktype payload string `{s}` exceeds the enum bound"
            );
            for secret in secret_words {
                assert!(!s.contains(secret), "worktype payload leaked `{secret}`");
            }
        }
    }
}

/// Every worktype candidate event passes T3.3's `validate` — the closed-enum
/// `task_category` label is accepted, the counts are numbers, the reserved flags
/// are false. Fail-closed privacy path, proven by construction.
#[test]
fn worktype_candidate_events_validate() {
    let out = extract(&fixture_records(), &opts());
    assert!(
        !out.worktype_candidate_events.is_empty(),
        "there must be worktype candidate events to validate"
    );
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    for ev in &out.worktype_candidate_events {
        assert!(
            validate(&ev.payload, &policy).is_ok(),
            "worktype candidate payload must validate: {}",
            ev.payload
        );
    }
}

/// Only the HUMAN's prompts are classified — a sidechain (subagent) prompt is
/// excluded, so its content never contributes a work-type. A machine-generated
/// subagent prompt is not the person's work (honesty), and this also keeps the
/// classifier off content the user did not author.
#[test]
fn sidechain_prompts_are_not_classified() {
    // One human prompt (coding) + one sidechain prompt (would be coding too).
    let records = vec![
        prompt(
            "sess-human",
            ms(2026, 7, 5, 9, 0, 0),
            false,
            "refactor this function",
        ),
        prompt(
            "sess-sub",
            ms(2026, 7, 5, 9, 5, 0),
            true, // sidechain — must NOT be classified
            "debug the compiler error and refactor",
        ),
    ];
    let out = extract(&records, &opts());
    let wt = out
        .worktype
        .iter()
        .find(|w| w.day == "2026-07-05")
        .expect("worktype for the day");
    // Exactly ONE coding prompt counted (the human's) — the sidechain is excluded.
    assert_eq!(wt.category_counts.get(&TaskCategory::Coding), Some(&1));
    let total: u64 = wt.category_counts.values().sum();
    assert_eq!(total, 1, "only the human prompt is classified");
}

/// The closed-enum backstop on the DEVICE: a hand-crafted candidate payload with
/// an out-of-enum `task_category` label (short, clean ASCII — so it clears the
/// free-text bound) must quarantine as `out_of_enum_value`, never enqueue. This
/// is the smuggled-snippet vector; the classifier's closed Rust enum makes it
/// unreachable in practice, and the validator is the fail-closed backstop.
#[test]
fn out_of_enum_task_category_quarantines() {
    use crate::privacy::QuarantineReason;
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    for smuggled in ["secret-memo", "summarize this", "drafting the merger", ""] {
        let payload = serde_json::json!({
            "task_category": smuggled,
            "rawPromptIncluded": false,
            "rawResponseIncluded": false,
        });
        assert_eq!(
            validate(&payload, &policy),
            Err(QuarantineReason::OutOfEnumValue),
            "out-of-enum task_category `{smuggled:?}` must quarantine"
        );
    }
    // A known label passes.
    let ok = serde_json::json!({
        "task_category": "coding",
        "rawPromptIncluded": false,
        "rawResponseIncluded": false,
    });
    assert!(validate(&ok, &policy).is_ok());
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

// ---- 5. Streamed-usage last-wins (regression guard, real values) ------------

/// The CLI reference has a dedicated `streamed-usage` fixture whose partial and
/// final lines carry DIFFERENT usage (`input:100` partial → `input:1200`
/// final). Porting it makes the dedup direction observable: a first-wins
/// regression would report 100, a sum-both bug 1300; only last-wins yields the
/// final 1200. (The `main-session` fixture's duplicate lines carry identical
/// usage, so they can't distinguish these — this test can.)
#[test]
fn streamed_usage_dedups_last_wins_with_differing_values() {
    let records = vec![
        prompt(
            "sess-stream",
            ms(2026, 7, 1, 12, 0, 0),
            false,
            "SENTINEL_PROMPT",
        ),
        // partial streamed line
        assistant(
            "sess-stream",
            ms(2026, 7, 1, 12, 0, 10),
            false,
            "req-stream",
            "claude-fable-5",
            usage(100, 50, 0, 0),
        ),
        // final cumulative line — SAME dedup key, different usage
        assistant(
            "sess-stream",
            ms(2026, 7, 1, 12, 0, 15),
            false,
            "req-stream",
            "claude-fable-5",
            usage(1200, 300, 5000, 800),
        ),
    ];
    let out = extract(&records, &opts());

    // Last-wins: the FINAL line's usage, not the partial (100) and not the sum
    // (1300). A `.or_insert`-style first-wins regression fails here.
    assert_eq!(
        value(&out, MetricKey::TokensInput, "2026-07-01", ""),
        Some(1200.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensOutput, "2026-07-01", ""),
        Some(300.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensCacheRead, "2026-07-01", ""),
        Some(5000.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensCacheWrite, "2026-07-01", ""),
        Some(800.0)
    );
    // One deduped turn → one request, not two.
    assert_eq!(
        value(&out, MetricKey::Sessions, "2026-07-01", ""),
        Some(1.0)
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelRequests,
            "2026-07-01",
            "model=claude-fable-5"
        ),
        Some(1.0)
    );
}

// ---- 6. Honesty gaps (invariant-(b): estimate ships with its caveat) --------

fn gap_details(out: &ExtractOutput) -> Vec<String> {
    out.gaps.iter().filter_map(|g| g.detail.clone()).collect()
}

/// Whenever a `spend_cents_estimated` record is emitted, the "list prices, not
/// invoices" disclosure travels with it — matching the CLI `summarize` gap
/// wording verbatim. Without it, T5.1 would route a spend ESTIMATE into the
/// server's `gaps[]`-bearing ingest as if it were exact (invariant-(b) leak).
#[test]
fn spend_estimate_gap_accompanies_the_spend_metric() {
    let out = extract(&fixture_records(), &opts());
    // Spend IS emitted...
    assert!(value(&out, MetricKey::SpendCentsEstimated, "2026-07-01", "").is_some());
    // ...so its disclosure MUST be present, byte-for-byte the CLI wording.
    let details = gap_details(&out);
    assert!(
        details
            .iter()
            .any(|d| d == "spend_cents_estimated uses public list prices, not invoices"),
        "spend-estimate disclosure missing; gaps were {details:?}"
    );
    // All fixture models are known — no unknown-model warning.
    assert!(
        !details.iter().any(|d| d.starts_with("unknown model rates")),
        "no unknown-model gap expected for known fixture models"
    );
    assert!(out.gaps.iter().all(|g| g.kind == GapKind::Other));
}

/// A model outside the price table defaults to the highest tier AND raises the
/// unknown-model warning (sorted, capped at five) — mirrors `summarize.ts`.
#[test]
fn unknown_model_raises_the_defaulted_high_gap() {
    let records = vec![assistant(
        "sess-x",
        ms(2026, 7, 1, 9, 0, 0),
        false,
        "req-x",
        "brand-new-model-9000",
        usage(10, 10, 0, 0),
    )];
    let out = extract(&records, &opts());
    let details = gap_details(&out);
    // Spend disclosure still present...
    assert!(details
        .iter()
        .any(|d| d == "spend_cents_estimated uses public list prices, not invoices"));
    // ...plus the unknown-model warning naming the model.
    assert!(
        details
            .iter()
            .any(|d| d.starts_with("unknown model rates defaulted high:")
                && d.contains("brand-new-model-9000")),
        "unknown-model gap missing; gaps were {details:?}"
    );
}

/// No spend claim ⇒ no spend disclaimer. With zero in-window events nothing is
/// aggregated, so the output carries no gaps (a disclaimer with no claim would
/// be noise, and the property under test is "caveat present WHENEVER the claim
/// is").
#[test]
fn no_gaps_when_nothing_is_aggregated() {
    let out = extract(&[], &opts());
    assert!(out.records.is_empty());
    assert!(out.gaps.is_empty());
}
