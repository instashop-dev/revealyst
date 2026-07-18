//! AI-app presence connector tests (ADR 0057).

use super::*;
use crate::privacy::{validate, ContentMode, PolicyResolution};
use crate::store::crypto::{DbKey, KEY_LEN};
use crate::store::Store;

fn analytics_ctx() -> ConnectorContext {
    ConnectorContext {
        policy: PolicyResolution::Allow(ContentMode::AnalyticsOnly),
        now_ms: 1_767_400_000_000,
        window_days: 30,
        // No consent + not shared → device `account` attribution (never a
        // fabricated person). App presence is not identity evidence.
        consent_identity: false,
        shared_device: false,
        home_dir: std::env::temp_dir(),
        config_dir_override: None,
        device_seed: "ai-tools-test-seed".to_string(),
    }
}

// ---- pure detection (no OS probe) ------------------------------------------

#[test]
fn detects_known_apps_by_exact_base_name() {
    let running = vec![
        "Claude".to_string(),      // macOS app process
        "ChatGPT.exe".to_string(), // Windows exe
        "node".to_string(),        // unrelated
        "firefox".to_string(),     // a browser — NOT a native AI app
    ];
    let present = detect_present(&running, AI_TOOL_REGISTRY);
    assert!(present.contains("claude-desktop"));
    assert!(present.contains("chatgpt-desktop"));
    assert!(!present.contains("copilot-desktop"));
    assert!(!present.contains("perplexity-desktop"));
    assert_eq!(present.len(), 2);
}

#[test]
fn matching_is_exact_not_substring() {
    // The Claude Code CLI (`claude-code`) and look-alikes must NOT match the
    // Claude desktop app — exact base-name equality, never substring.
    let running = vec![
        "claude-code".to_string(),
        "claude-helper".to_string(),
        "myclaude".to_string(),
        "chatgpt-web-wrapper".to_string(),
    ];
    let present = detect_present(&running, AI_TOOL_REGISTRY);
    assert!(present.is_empty(), "no exact match → nothing detected");
}

#[test]
fn empty_process_list_detects_nothing() {
    // OFF-safe: no data → no apps, never a fabricated presence.
    assert!(detect_present(&[], AI_TOOL_REGISTRY).is_empty());
}

// ---- registry ↔ frozen contract crossing -----------------------------------

/// Every registry app id MUST be a member of the closed `ai_tool_used` enum the
/// frozen contract (AI_TOOL_IDS) emits and the device validator gates on — so
/// the collector can never emit a value the validator would (rightly) quarantine.
#[test]
fn every_registry_id_is_in_the_closed_contract_enum() {
    for app in AI_TOOL_REGISTRY {
        assert!(
            crate::allowlist::is_allowed_enum_value("ai_tool_used", app.id),
            "registry id `{}` is not in the frozen AI_TOOL_IDS enum — drift",
            app.id
        );
    }
    // Anti-vacuity: the registry (and thus the enum) is non-empty.
    assert!(!AI_TOOL_REGISTRY.is_empty());
}

// ---- collect_presence: shape + privacy -------------------------------------

#[test]
fn collect_presence_builds_flag_records_with_closed_enum_dims() {
    let ctx = analytics_ctx();
    let batch = collect_presence(&ctx, &["Claude".to_string(), "chatgpt.exe".to_string()]);

    // One day event carrying one flag record per detected app.
    assert_eq!(batch.usage_events.len(), 1);
    let payload = &batch.usage_events[0].payload;
    let records = payload["records"].as_array().expect("records array");
    assert_eq!(records.len(), 2);
    for record in records {
        assert_eq!(record["metricKey"], "ai_tool_used");
        assert_eq!(record["value"], 1.0);
        assert_eq!(record["attribution"], "account"); // no consent → device
        let dim = record["dim"].as_str().unwrap();
        assert!(
            dim == "tool=claude-desktop" || dim == "tool=chatgpt-desktop",
            "unexpected dim {dim}"
        );
    }
    // A candidate event per detected app + a checkpoint over the day.
    assert_eq!(batch.candidate_events.len(), 2);
    assert!(batch.new_checkpoint.is_some());
    // The coarse-signal caveat rides the batch (invariant b).
    assert_eq!(batch.gaps.len(), 1);
}

#[test]
fn every_candidate_event_passes_the_privacy_validator() {
    // The "through the privacy-validated enqueue path (fails closed)" guarantee:
    // each candidate the collector emits is accepted by the T3.3 validator
    // (allowlisted + sent + scalar + IN the closed enum) by construction.
    let ctx = analytics_ctx();
    let batch = collect_presence(
        &ctx,
        &["Claude".to_string(), "Perplexity".to_string(), "Copilot.exe".to_string()],
    );
    assert_eq!(batch.candidate_events.len(), 3);
    let policy = PolicyResolution::Allow(ContentMode::AnalyticsOnly);
    for candidate in &batch.candidate_events {
        assert!(
            validate(&candidate.payload, &policy).is_ok(),
            "candidate must pass the validator by construction"
        );
    }
}

#[test]
fn only_closed_enum_app_ids_ever_appear_in_the_payload() {
    // A non-AI process with a "sensitive-looking" name is present alongside a
    // real AI app. NOTHING of that process — not its name, not any substring —
    // may appear anywhere in the serialized batch; only the closed-enum app id
    // of the detected AI app leaves.
    let ctx = analytics_ctx();
    let batch = collect_presence(
        &ctx,
        &[
            "Claude".to_string(),
            "SuperSecretClientProject.exe".to_string(),
            "personal-banking-notes".to_string(),
        ],
    );

    let mut serialized = String::new();
    for event in batch.usage_events.iter().chain(batch.candidate_events.iter()) {
        serialized.push_str(&event.payload.to_string());
    }
    assert!(serialized.contains("claude-desktop"));
    for leak in [
        "SuperSecret",
        "supersecret",
        "ClientProject",
        "banking",
        "personal-banking-notes",
    ] {
        assert!(
            !serialized.contains(leak),
            "a non-enum process detail ({leak}) leaked into the payload"
        );
    }
}

#[test]
fn no_detection_emits_no_day_event_but_still_checkpoints() {
    // An honest zero: nothing detected → no `ai_tool_used` row (never an empty
    // fabricated one), but the checkpoint advances ("we checked today").
    let ctx = analytics_ctx();
    let batch = collect_presence(&ctx, &["node".to_string(), "firefox".to_string()]);
    assert!(batch.usage_events.is_empty());
    assert!(batch.candidate_events.is_empty());
    assert!(batch.new_checkpoint.is_some());
}

// ---- full enqueue path (fail-closed) ---------------------------------------

fn store() -> Store {
    Store::open_in_memory(DbKey::from_bytes([31u8; KEY_LEN])).unwrap()
}

/// The connector drives the shared `collect_and_enqueue` orchestration without
/// panicking and without failing closed on a clean machine: whatever this test
/// host's process set is, every candidate is in-enum by construction, so
/// `would_quarantine` is 0 and the cycle is not halted. (Whether any AI app is
/// running is machine-dependent, so we assert only the fail-closed invariants.)
#[tokio::test]
async fn collect_and_enqueue_never_fails_closed() {
    let store = store();
    let connector = AiToolsConnector::new();
    let ctx = analytics_ctx();
    let outcome = super::super::collect_and_enqueue(&connector, &ctx, &store)
        .await
        .expect("collect+enqueue ok");
    assert_eq!(outcome.would_quarantine, 0, "no candidate may quarantine");
    assert!(!outcome.halted, "a clean probe never halts the cycle");
    assert_eq!(outcome.state, Some(ConnectorState::Collecting));
}
