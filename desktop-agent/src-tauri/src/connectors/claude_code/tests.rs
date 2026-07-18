//! Claude Code connector tests (spec §11.3.1; plan T5.1). CI-run (the `rust`
//! job) — the Windows dev machine has no MSVC linker.
//!
//! Coverage:
//!  1. **Golden parity** — parsing the recorded vendor JSONL fixtures and running
//!     the extractor reproduces the CLI reference summarizer's known-truth
//!     aggregate (the exact values `summarize.test.ts` / the T3.4 extractor tests
//!     assert), field by field.
//!  2. **Parse fidelity** — the JSONL line classifier matches the CLI
//!     `parse.ts` counts (events / skipped / unknown) on the same fixtures.
//!  3. **Unsupported version** — a fixture declaring a version beyond the
//!     supported major yields ZERO events + `unsupported_version` (never partial).
//!  4. **Detection** — a present projects/ tree → `ready`; absent → `not_detected`.
//!  5. **Incremental checkpoint** — a second pass over an unchanged fileset emits
//!     nothing; a changed fileset re-aggregates.
//!  6. **Shared-session** — a shared-device declaration demotes to `account`
//!     attribution + an honesty gap (never a guessed person).
//!  7. **Allowlist projection** — every candidate event flows through T3.3's
//!     `validate_and_enqueue` clean (0 quarantined).
//!  8. **End-to-end drain** — the enqueued `usage_summary` events decode into a
//!     valid `IngestRequest` via the T4.1 batch builder (the pipeline is live).

use super::*;
use std::path::{Path, PathBuf};

use crate::connectors::{ConnectorContext, ConnectorState, SourceConnector};
use crate::extract::counts::MAX_MODEL_LEN;
use crate::extract::{extract, ExtractOptions, ExtractOutput, MetricKey, RecordKind};
use crate::privacy::{validate_and_enqueue, ContentMode, PolicyResolution};
use crate::store::crypto::{DbKey, KEY_LEN};
use crate::store::Store;
use crate::sync::batch::build_request;

const MAIN: &str =
    include_str!("../../../../../fixtures/vendor-payloads/claude-code-local/main-session.jsonl");
const SIDE: &str = include_str!(
    "../../../../../fixtures/vendor-payloads/claude-code-local/sidechain-session.jsonl"
);
const STREAMED: &str =
    include_str!("../../../../../fixtures/vendor-payloads/claude-code-local/streamed-usage.jsonl");
const UNSUPPORTED: &str = include_str!(
    "../../../../../fixtures/vendor-payloads/claude-code-local/unsupported-version.jsonl"
);

// ---- helpers ---------------------------------------------------------------

/// Fold a fixture's content through the line parser (no disk needed).
fn parse_all(content: &str) -> FileParse {
    let mut fp = FileParse::default();
    for line in content.split('\n') {
        parse_line(line, &mut fp);
    }
    fp
}

/// The extractor opts the CLI known-truth is stated against (subject id is only
/// used in candidate ids; the aggregate values are subject-independent).
fn known_truth_opts() -> ExtractOptions {
    ExtractOptions {
        subject_external_id: "dev@example.com".to_string(),
        connector_id: CONNECTOR_ID.to_string(),
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

fn temp_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "revealyst-cc-{}-{}-{:?}",
        name,
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn write_session(home: &Path, proj: &str, file: &str, content: &str) {
    let dir = home.join(".claude").join("projects").join(proj);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(file), content).unwrap();
}

fn store() -> Store {
    Store::open_in_memory(DbKey::from_bytes([31u8; KEY_LEN])).unwrap()
}

fn ctx(home: PathBuf) -> ConnectorContext {
    ConnectorContext {
        policy: PolicyResolution::Allow(ContentMode::AnalyticsOnly),
        // now = 2026-07-31 UTC midnight, a 31-day window ⇒ 2026-07-01..=2026-07-31,
        // matching the known-truth window.
        now_ms: day_start_ms("2026-07-31"),
        window_days: 31,
        consent_identity: false,
        shared_device: false,
        home_dir: home,
        config_dir_override: None,
        device_seed: "seed-abc".to_string(),
    }
}

// ---- 1. Golden parity ------------------------------------------------------

/// Parsing the recorded fixtures then extracting reproduces the CLI summarizer's
/// known truth exactly: last-wins streamed dedup, sidechain usage summed but a
/// sidechain is not a human session, tool-result ≠ prompt, UTC bucketing, the
/// list-price spend estimate, and the sub-daily signal.
#[test]
fn parse_then_extract_matches_cli_known_truth() {
    let mut records = parse_all(MAIN).records;
    records.extend(parse_all(SIDE).records);
    let out = extract(&records, &known_truth_opts());

    // Day-1 token sums (streamed turn counted once, sidechain usage included).
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

    // Human sessions only; tool-result ≠ prompt; active day.
    assert_eq!(
        value(&out, MetricKey::Sessions, "2026-07-01", ""),
        Some(1.0)
    );
    assert_eq!(value(&out, MetricKey::Prompts, "2026-07-01", ""), Some(1.0));
    assert_eq!(value(&out, MetricKey::Prompts, "2026-07-02", ""), Some(1.0));
    assert_eq!(
        value(&out, MetricKey::ActiveDay, "2026-07-01", ""),
        Some(1.0)
    );

    // Model mix — one request per deduped turn (incl. the sidechain haiku turn).
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
            "model=claude-haiku-4-5-20251001"
        ),
        Some(2500.0)
    );

    // Spend estimate (fable@opus 6.30 + sonnet 0.27 + haiku 0.451 = 7.021 → 7.02).
    let spend = value(&out, MetricKey::SpendCentsEstimated, "2026-07-01", "").unwrap();
    assert!((spend - 7.02).abs() < 1e-9, "spend was {spend}");

    // Sub-daily signal: deduped hour-9 count = 6, real interval-overlap peak = 2.
    let day1 = out.signals.iter().find(|s| s.day == "2026-07-01").unwrap();
    assert_eq!(day1.hours[9], 6);
    assert_eq!(day1.hours[10], 1);
    assert_eq!(day1.peak_concurrency, 2);
    assert_eq!(day1.source_granularity, "event");
}

/// The streamed-usage fixture pins last-wins across DIFFERING partial/final usage
/// (100 → 1200): a first-wins regression reports 100, a sum-both bug 1300.
#[test]
fn streamed_fixture_dedups_last_wins() {
    let records = parse_all(STREAMED).records;
    let out = extract(&records, &known_truth_opts());
    assert_eq!(
        value(&out, MetricKey::TokensInput, "2026-07-01", ""),
        Some(1200.0)
    );
    assert_eq!(
        value(&out, MetricKey::TokensCacheRead, "2026-07-01", ""),
        Some(5000.0)
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

// ---- 2. Parse fidelity -----------------------------------------------------

/// The line classifier matches the CLI `parse.ts` counts on `main-session`:
/// 9 events, 1 corrupted line skipped, 1 unknown record type — and prompts vs
/// tool-result carriers split exactly as the CLI does.
#[test]
fn parse_counts_match_cli() {
    let fp = parse_all(MAIN);
    assert_eq!(
        fp.records.len(),
        9,
        "prompt+assistant×5(dup incl)+2 activity+day2"
    );
    assert_eq!(fp.skipped_lines, 1, "the one corrupted line");
    assert_eq!(fp.unknown_types, 1, "x-future-record");

    let prompts = fp
        .records
        .iter()
        .filter(|r| r.kind == RecordKind::Prompt)
        .count();
    let activity = fp
        .records
        .iter()
        .filter(|r| r.kind == RecordKind::Activity)
        .count();
    let assistants = fp
        .records
        .iter()
        .filter(|r| r.kind == RecordKind::Assistant)
        .count();
    assert_eq!(
        prompts, 2,
        "one human prompt per day; tool-result user ≠ prompt"
    );
    assert_eq!(activity, 2, "tool-result carrier + attachment");
    assert_eq!(assistants, 5, "incl. both streamed req-main-1 lines");

    let side = parse_all(SIDE);
    assert_eq!(side.records.len(), 2);
    assert_eq!(
        side.records[0].kind,
        RecordKind::Activity,
        "sidechain user ≠ prompt"
    );
    assert!(side.records[0].is_sidechain);
    assert_eq!(side.records[1].kind, RecordKind::Assistant);
}

/// A hostile model id read from a vendor line is reduced to a BOUNDED,
/// safe-charset label before it enters any payload: `sanitize_model` keeps only
/// `[A-Za-z0-9._:-]` and caps at MAX_MODEL_LEN. So injection structure — spaces,
/// angle brackets, control chars, newlines — cannot survive, and the field can
/// never exceed the cap. It is a legitimate `sent:true` identifier (accepted
/// per the T3.3 review, F3): alphanumeric runs are NOT word-stripped (you can't
/// distinguish a real model token from an injected word), so the guarantee is
/// boundedness + charset-safety, not arbitrary-substring removal.
#[test]
fn hostile_model_is_bounded_after_extract() {
    let hostile = r#"{"type":"assistant","isSidechain":false,"sessionId":"s1","timestamp":"2026-07-01T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude fable 5 <SENTINEL rotate AWS key>","usage":{"input_tokens":1}}}"#;
    let records = parse_all(hostile).records;
    let out = extract(&records, &known_truth_opts());
    let dump = serde_json::to_string(&out.records).unwrap()
        + &out
            .candidate_events
            .iter()
            .map(|e| e.payload.to_string())
            .collect::<String>();
    // Injection structure is stripped: no spaces, no angle brackets, no
    // control chars — so the raw hostile string can never appear verbatim.
    assert!(!dump.contains(' '), "sanitized model carries no spaces");
    assert!(
        !dump.contains('<') && !dump.contains('>'),
        "no angle brackets"
    );
    assert!(
        !dump.contains("SENTINEL rotate"),
        "the raw free-text structure must not survive verbatim"
    );
    assert!(
        !dump.chars().any(|c| c.is_control()),
        "no control characters survive"
    );
    // And every emitted model value is within the safe charset + length cap.
    for ev in &out.candidate_events {
        if let Some(m) = ev.payload.get("model").and_then(|v| v.as_str()) {
            assert!(m.len() <= MAX_MODEL_LEN, "model is length-bounded");
            assert!(
                m.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c)),
                "model is charset-safe"
            );
        }
    }
}

/// F1 CLI-parity: an assistant record with `"usage": null` is NOT a usage-bearing
/// turn. The CLI's truthy `usageRaw ? {...} : null` (parse.ts) treats a falsy
/// usage as no-usage, so the summarizer emits no model_requests/model_tokens for
/// it. A naive `.map(parse_usage)` on `Some(Value::Null)` would spuriously count
/// it as an all-zero request — the object guard prevents that.
#[test]
fn null_usage_does_not_count_a_model_request() {
    let line = r#"{"type":"assistant","isSidechain":false,"sessionId":"s1","timestamp":"2026-07-01T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-fable-5","usage":null}}"#;
    let records = parse_all(line).records;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].kind, RecordKind::Assistant);
    assert!(
        records[0].usage.is_none(),
        "null usage must yield None, not an all-zero UsageNumbers"
    );

    let out = extract(&records, &known_truth_opts());
    // No usage ⇒ no model request / no model tokens (matches the CLI).
    assert_eq!(
        value(
            &out,
            MetricKey::ModelRequests,
            "2026-07-01",
            "model=claude-fable-5"
        ),
        None
    );
    assert_eq!(
        value(
            &out,
            MetricKey::ModelTokens,
            "2026-07-01",
            "model=claude-fable-5"
        ),
        None
    );
    // The assistant turn still marks the day active (it just carries no usage).
    assert_eq!(
        value(&out, MetricKey::ActiveDay, "2026-07-01", ""),
        Some(1.0)
    );
}

// ---- 3. Unsupported version ------------------------------------------------

/// A file declaring a version beyond the supported major yields ZERO events and
/// flips the connector to `unsupported_version` with an honesty gap — never a
/// partial parse of an unrecognized shape (spec §11.3.1).
#[test]
fn unsupported_version_is_zero_events_and_state_transition() {
    let home = temp_home("unsupported");
    write_session(&home, "proj-future", "sess-future.jsonl", UNSUPPORTED);
    let files = list_session_files(&config_dirs(&home, None));
    let batch = collect_from_files(&ctx(home.clone()), &files, None);

    assert_eq!(batch.state, Some(ConnectorState::UnsupportedVersion));
    assert!(
        batch.usage_events.is_empty(),
        "no events from an unsupported file"
    );
    assert!(batch.candidate_events.is_empty());
    assert!(
        batch.gaps.iter().any(|g| g
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("unsupported Claude Code format")),
        "an honesty gap must disclose the skipped unsupported file"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// A machine with BOTH a supported and an unsupported file: the supported days
/// still produce events, the unsupported file is skipped whole, and the state is
/// `partially_supported`.
#[test]
fn mixed_supported_and_unsupported_is_partially_supported() {
    let home = temp_home("mixed");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    write_session(&home, "proj-future", "future.jsonl", UNSUPPORTED);
    let files = list_session_files(&config_dirs(&home, None));
    let batch = collect_from_files(&ctx(home.clone()), &files, None);

    assert_eq!(batch.state, Some(ConnectorState::PartiallySupported));
    assert!(
        !batch.usage_events.is_empty(),
        "supported days still collected"
    );
    // The unsupported day (2026-07-03) never appears.
    assert!(
        batch
            .usage_events
            .iter()
            .all(|e| e.payload["day"].as_str() != Some("2026-07-03")),
        "no day may come from the unsupported file"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// The unsupported file's sentinel content never leaks anywhere.
#[test]
fn unsupported_file_leaks_nothing() {
    let home = temp_home("unsupported-leak");
    write_session(&home, "proj-future", "future.jsonl", UNSUPPORTED);
    let files = list_session_files(&config_dirs(&home, None));
    let batch = collect_from_files(&ctx(home.clone()), &files, None);
    let dump = format!("{:?}", batch.gaps)
        + &batch
            .usage_events
            .iter()
            .map(|e| e.payload.to_string())
            .collect::<String>();
    assert!(!dump.contains("SENTINEL"));
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 4. Detection ----------------------------------------------------------

#[tokio::test]
async fn detect_present_dir_is_ready_absent_is_not_detected() {
    let connector = ClaudeCodeConnector::new();

    // Absent: an empty home → not_detected, zero locations.
    let empty = temp_home("detect-empty");
    std::fs::create_dir_all(&empty).unwrap();
    let d = connector.detect(&ctx(empty.clone())).await.unwrap();
    assert_eq!(d.state, ConnectorState::NotDetected);
    assert_eq!(d.locations, 0);
    let _ = std::fs::remove_dir_all(&empty);

    // Present: a projects tree with a session file → ready, one location.
    let home = temp_home("detect-present");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    let d = connector.detect(&ctx(home.clone())).await.unwrap();
    assert_eq!(d.state, ConnectorState::Ready);
    assert_eq!(d.locations, 1);
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 5. Incremental checkpoint ---------------------------------------------

/// Two passes over an UNCHANGED fileset: the first produces events + a manifest;
/// the second (given that manifest) produces NO new checkpoint and no events —
/// the incremental "no re-emit" property. Adding a file changes the manifest and
/// re-aggregates.
#[test]
fn incremental_no_reemit_then_picks_up_new_file() {
    let home = temp_home("incremental");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    let ctx = ctx(home.clone());

    let files1 = list_session_files(&config_dirs(&home, None));
    let batch1 = collect_from_files(&ctx, &files1, None);
    let cp = batch1
        .new_checkpoint
        .clone()
        .expect("first pass sets a manifest");
    assert!(!batch1.usage_events.is_empty(), "first pass collects");

    // Second pass, same fileset, holding the manifest → nothing new.
    let files2 = list_session_files(&config_dirs(&home, None));
    let batch2 = collect_from_files(&ctx, &files2, Some(&cp));
    assert!(
        batch2.new_checkpoint.is_none(),
        "unchanged fileset advances nothing"
    );
    assert!(
        batch2.usage_events.is_empty(),
        "no re-emit of checkpointed data"
    );
    assert_eq!(batch2.state, Some(ConnectorState::Ready));

    // Add a NEW session file (a new day) → manifest changes → re-aggregate.
    write_session(&home, "proj-b", "stream.jsonl", STREAMED);
    let files3 = list_session_files(&config_dirs(&home, None));
    let batch3 = collect_from_files(&ctx, &files3, Some(&cp));
    assert!(
        batch3.new_checkpoint.is_some(),
        "a changed fileset re-aggregates"
    );
    assert!(!batch3.usage_events.is_empty());
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 9. Proof-panel active-day count ---------------------------------------

/// The Privacy screen's "what we've collected" active-day count
/// (`active_days_in_window`) must equal the number of days the LIVE collector
/// would emit for the SAME logs (one `usage_summary` event per active day). This
/// pins the proof number to reality: it can never drift from what actually gets
/// summarized, and it reads no content (it reuses the same windowed extract).
#[test]
fn active_days_in_window_matches_the_collector_day_count() {
    let home = temp_home("active-days");
    // MAIN spans two days (2026-07-01/02); STREAMED adds more activity — so the
    // day count is non-trivial (a vacuous 0/1 wouldn't prove agreement).
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    write_session(&home, "proj-b", "stream.jsonl", STREAMED);
    let ctx = ctx(home.clone());

    // What the live collector would emit: exactly one event per active day.
    let files = list_session_files(&config_dirs(&home, None));
    let collector_days = collect_from_files(&ctx, &files, None).usage_events.len();

    // The read-only summary scan must agree — and be non-vacuous.
    let summary_days = ClaudeCodeConnector::active_days_in_window(&ctx);
    assert!(collector_days > 1, "fixtures must span multiple days");
    assert_eq!(
        summary_days, collector_days,
        "proof active-day count must match the collector's emitted day count"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// An empty machine (no Claude Code logs) yields an honest zero, never a
/// fabricated count — the "nothing yet" state the Privacy screen renders as
/// "0 days".
#[test]
fn active_days_in_window_is_zero_on_an_empty_machine() {
    let home = temp_home("active-days-empty");
    std::fs::create_dir_all(&home).unwrap();
    let ctx = ctx(home.clone());
    assert_eq!(ClaudeCodeConnector::active_days_in_window(&ctx), 0);
    let _ = std::fs::remove_dir_all(&home);
}

/// Crash-safety via `enqueue_and_checkpoint` (R1): re-running collect with the
/// PRE-enqueue checkpoint (crash between event commit and checkpoint commit)
/// re-emits identical, content-addressed event ids — a duplicate the store's
/// INSERT-OR-IGNORE and the server both dedup, never a gap.
#[test]
fn reaggregation_produces_identical_event_ids() {
    let home = temp_home("crash-safe");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    let ctx = ctx(home.clone());
    let files = list_session_files(&config_dirs(&home, None));

    let a = collect_from_files(&ctx, &files, None);
    let b = collect_from_files(&ctx, &files, None);
    let ids_a: Vec<&str> = a.usage_events.iter().map(|e| e.event_id.as_str()).collect();
    let ids_b: Vec<&str> = b.usage_events.iter().map(|e| e.event_id.as_str()).collect();
    assert_eq!(
        ids_a, ids_b,
        "identical logs → identical event ids (crash-safe dedup)"
    );
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 6. Shared session -----------------------------------------------------

/// Identity: with consent and NOT shared, a readable Claude account email
/// resolves to a `person` subject; a shared-device declaration demotes it to the
/// device `account` (spec §10.3) even with consent — never a guessed person.
#[test]
fn shared_device_demotes_person_to_account_with_gap() {
    let home = temp_home("shared");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    std::fs::write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"emailAddress":"Dev@Example.com","displayName":"Dev"}}"#,
    )
    .unwrap();

    // Consent, not shared → person.
    let mut personal = ctx(home.clone());
    personal.consent_identity = true;
    let id = resolve_local_identity(&personal);
    assert_eq!(id.kind, "person");
    assert_eq!(id.attribution, "person");
    assert_eq!(id.external_id, "dev@example.com");

    // Consent BUT shared → account + gap, and the records carry account attribution.
    let mut shared = ctx(home.clone());
    shared.consent_identity = true;
    shared.shared_device = true;
    let sid = resolve_local_identity(&shared);
    assert_eq!(sid.kind, "account");
    assert_eq!(sid.attribution, "account");
    assert!(sid.external_id.starts_with("device:"));

    let files = list_session_files(&config_dirs(&home, None));
    let batch = collect_from_files(&shared, &files, None);
    assert!(
        batch
            .gaps
            .iter()
            .any(|g| g.detail.as_deref().unwrap_or("").contains("shared")),
        "a shared-session honesty gap must be emitted"
    );
    // Every emitted record is attributed to the account, never a person.
    for ev in &batch.usage_events {
        for rec in ev.payload["records"].as_array().unwrap() {
            assert_eq!(rec["attribution"], "account");
        }
        assert_eq!(ev.payload["subject"]["kind"], "account");
    }
    let _ = std::fs::remove_dir_all(&home);
}

/// Without consent, even a readable email is NOT used — the device account is the
/// honest fallback (review invariant-b: never fabricate a person).
#[test]
fn no_consent_uses_device_account() {
    let home = temp_home("no-consent");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"emailAddress":"dev@example.com"}}"#,
    )
    .unwrap();
    let id = resolve_local_identity(&ctx(home.clone())); // consent defaults false
    assert_eq!(id.kind, "account");
    assert_eq!(id.attribution, "account");
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 7. Allowlist projection (candidate events) ----------------------------

/// Every candidate event the connector's extract produces flows through T3.3's
/// `validate_and_enqueue` clean — 0 quarantined, all enqueued — identical to the
/// CLI allowlist projection.
#[test]
fn candidate_events_pass_validate_and_enqueue_zero_quarantined() {
    let home = temp_home("candidates");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    write_session(&home, "proj-b", "side.jsonl", SIDE);
    let files = list_session_files(&config_dirs(&home, None));
    let batch = collect_from_files(&ctx(home.clone()), &files, None);
    assert!(!batch.candidate_events.is_empty());

    let scratch = store();
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    let outcome = validate_and_enqueue(
        &scratch,
        &policy,
        CONNECTOR_ID,
        &batch.candidate_events,
        "cp",
        1,
    )
    .unwrap();
    assert_eq!(
        outcome.quarantined, 0,
        "the projection matches the allowlist"
    );
    assert_eq!(outcome.enqueued, batch.candidate_events.len());
    assert!(!outcome.halted);
    let _ = std::fs::remove_dir_all(&home);
}

// ---- 8. End-to-end drain ---------------------------------------------------

/// The live path: `collect_and_enqueue` parses → extracts → privacy-gates →
/// enqueues day-aggregate `usage_summary` events, and those events decode into a
/// valid `IngestRequest` via the T4.1 batch builder (window spans the fixture
/// days, subject deduped, records present, spend-estimate honesty gap carried).
/// This is the proof the desktop pipeline can land activity server-side.
#[tokio::test]
async fn collect_and_enqueue_produces_a_drainable_ingest_request() {
    let home = temp_home("e2e");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    write_session(&home, "proj-b", "side.jsonl", SIDE);
    let connector = ClaudeCodeConnector::new();
    let store = store();
    let ctx = ctx(home.clone());

    let outcome = super::super::collect_and_enqueue(&connector, &ctx, &store)
        .await
        .unwrap();
    assert!(!outcome.halted);
    assert_eq!(outcome.would_quarantine, 0);
    assert!(outcome.enqueued >= 2, "day-1 and day-2 aggregates enqueued");
    // The checkpoint advanced through enqueue_and_checkpoint (R1).
    assert!(store.checkpoint(CONNECTOR_ID).unwrap().is_some());

    // Drain the queue exactly as the sync engine would, and build the wire body.
    let queued = store.dequeue_batch(250).unwrap();
    assert_eq!(queued.len(), outcome.enqueued);
    let request = build_request(
        "0.1.0",
        1,
        crate::sync::batch::DEFAULT_INGEST_SOURCE,
        &queued,
    );

    assert_eq!(request.window.start, "2026-07-01");
    assert_eq!(request.window.end, "2026-07-02");
    assert_eq!(request.subjects.len(), 1, "one device subject");
    assert_eq!(request.subjects[0].kind, "account");
    assert!(!request.records.is_empty(), "real metric rows to ingest");
    // The spend-estimate caveat travels with the estimate (invariant-b).
    assert!(
        request.gaps.iter().any(|g| g
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("list prices, not invoices")),
        "the spend-estimate disclosure must reach the wire; gaps: {:?}",
        request.gaps
    );
    // No queued summary was undecodable (no fabricated "unreadable summary" gap).
    assert!(
        !request
            .gaps
            .iter()
            .any(|g| g.detail.as_deref().unwrap_or("").contains("unreadable")),
        "the enqueued shape must decode cleanly as a UsageSummaryPayload"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// No sentinel content from ANY fixture survives into the enqueued wire events —
/// the "summarize locally, never transmit content" tripwire holds end to end.
#[tokio::test]
async fn no_sentinel_content_reaches_the_queue() {
    let home = temp_home("no-leak");
    write_session(&home, "proj-a", "main.jsonl", MAIN);
    write_session(&home, "proj-b", "side.jsonl", SIDE);
    write_session(&home, "proj-c", "stream.jsonl", STREAMED);
    let connector = ClaudeCodeConnector::new();
    let store = store();
    super::super::collect_and_enqueue(&connector, &ctx(home.clone()), &store)
        .await
        .unwrap();

    let queued = store.dequeue_batch(250).unwrap();
    let dump: String = queued
        .iter()
        .map(|e| e.payload.to_string() + &e.event_id)
        .collect();
    assert!(
        !dump.contains("SENTINEL"),
        "no content sentinel may reach the queue"
    );
    let _ = std::fs::remove_dir_all(&home);
}

// ---- RFC-3339 parsing ------------------------------------------------------

#[test]
fn rfc3339_parses_utc_and_offsets() {
    // The confirmed fixture format.
    assert_eq!(
        parse_rfc3339_ms("2026-07-01T09:12:00.000Z"),
        Some(day_start_ms("2026-07-01") + (9 * 3600 + 12 * 60) * 1000)
    );
    // No fractional seconds.
    assert_eq!(
        parse_rfc3339_ms("2026-07-01T00:00:00Z"),
        Some(day_start_ms("2026-07-01"))
    );
    // A positive offset is subtracted to reach UTC.
    assert_eq!(
        parse_rfc3339_ms("2026-07-01T02:00:00+02:00"),
        Some(day_start_ms("2026-07-01"))
    );
    // Garbage → None (⇒ the line is skipped, like the CLI's NaN guard).
    assert_eq!(parse_rfc3339_ms("not-a-timestamp"), None);
    assert_eq!(parse_rfc3339_ms(""), None);
}

#[test]
fn version_major_gate() {
    assert_eq!(parse_major("2.0.34"), Some(2));
    assert_eq!(parse_major("999.0.0"), Some(999));
    assert_eq!(parse_major("garbage"), None);
}
