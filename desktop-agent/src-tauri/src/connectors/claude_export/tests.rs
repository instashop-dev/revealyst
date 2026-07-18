//! Claude export importer tests (spec §11.3.2 / §26.4; plan T5.3). CI-run (the
//! `rust` job) — the Windows dev machine has no MSVC linker.
//!
//! Coverage:
//!  1. **Path traversal** — a crafted `../evil` entry rejects the WHOLE archive.
//!  2. **Symlink** — a symlink entry rejects the archive.
//!  3. **Magic bytes** — a non-ZIP file is rejected before the reader runs.
//!  4. **Zip-bomb (honest header)** — reported decompressed size over the cap aborts.
//!  5. **Zip-bomb (lying header)** — actual inflated bytes over the cap aborts
//!     (`read_entry_capped` against an infinite reader).
//!  6. **File-count cap** — too many entries aborts.
//!  7. **Malformed entries** — bad conversation array elements are skipped/failed
//!     + counted; malformed JSON is rejected.
//!  8. **Verified cleanup** — the temp root is empty after import; the workspace
//!     guard removes a non-empty dir on drop.
//!  9. **Content drop** — sentinel prompt text (and a sentinel conversation title
//!     that becomes the session id) never reaches a projected payload.
//! 10. **End-to-end** — a mixed synthetic export yields correct counts + sane
//!     day-aggregates that decode into a valid `IngestRequest`.
//! 11. **Enqueue for sync** — a successful import enqueues its day-aggregates
//!     under `claude_export` (ADR 0060); a blocked policy enqueues nothing.

use super::*;

use std::io::{Cursor, Write};
use std::path::PathBuf;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::connectors::ConnectorContext;
use crate::privacy::{ContentMode, PolicyBlockReason, PolicyResolution};
use crate::store::crypto::{DbKey, KEY_LEN};
use crate::store::queue::{NewEvent, PendingEvent};
use crate::store::Store;
use crate::sync::batch::build_request;

/// Project the importer's `NewEvent`s into `PendingEvent`s (as the sync engine
/// would after a dequeue) so a test can build an `IngestRequest` from the
/// import's output shape directly.
fn as_pending(events: &[NewEvent]) -> Vec<PendingEvent> {
    events
        .iter()
        .enumerate()
        .map(|(i, e)| PendingEvent {
            id: i as i64,
            event_id: e.event_id.clone(),
            connector_id: e.connector_id.clone(),
            event_type: e.event_type.clone(),
            content_mode: e.content_mode.clone(),
            occurred_at: e.occurred_at,
            enqueued_at: 0,
            payload: e.payload.clone(),
        })
        .collect()
}

// ---- helpers ---------------------------------------------------------------

fn store() -> Store {
    Store::open_in_memory(DbKey::from_bytes([37u8; KEY_LEN])).unwrap()
}

fn ctx() -> ConnectorContext {
    ConnectorContext {
        policy: PolicyResolution::Allow(ContentMode::AnalyticsOnly),
        now_ms: 1_767_400_000_000,
        window_days: 30,
        consent_identity: false,
        shared_device: false,
        home_dir: std::env::temp_dir(),
        config_dir_override: None,
        device_seed: "export-test-seed".to_string(),
    }
}

/// A unique scratch directory under the system temp dir.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "revealyst-export-test-{tag}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Build an in-memory ZIP from `(name, bytes, compression)` entries.
fn build_zip(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for &(name, data, method) in entries {
        let opts = SimpleFileOptions::default().compression_method(method);
        writer.start_file(name, opts).unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Write `bytes` as `export.zip` inside a fresh scratch dir; return the path.
fn write_export(tag: &str, bytes: &[u8]) -> (PathBuf, PathBuf) {
    let dir = scratch(tag);
    let path = dir.join("export.zip");
    std::fs::write(&path, bytes).unwrap();
    (dir, path)
}

/// A two-day, two-conversation export whose assistant message carries a sentinel
/// so the content-drop guarantee is testable.
const SENTINEL: &str = "SENTINEL_RAW_PROMPT_TEXT_XYZ";

fn valid_conversations_json() -> Vec<u8> {
    format!(
        r#"[
          {{ "uuid": "conv-1", "name": "First",
             "chat_messages": [
               {{ "uuid": "m1", "sender": "human", "text": "hello there",
                  "created_at": "2026-07-15T10:00:00Z" }},
               {{ "uuid": "m2", "sender": "assistant", "text": "{SENTINEL} reply",
                  "created_at": "2026-07-15T10:00:05Z" }}
             ] }},
          {{ "uuid": "conv-2", "name": "Second",
             "chat_messages": [
               {{ "uuid": "m3", "sender": "human", "text": "another question",
                  "created_at": "2026-07-16T09:30:00Z" }}
             ] }}
        ]"#
    )
    .into_bytes()
}

// ---- pure predicate tests --------------------------------------------------

#[test]
fn magic_bytes_recognized_and_rejected() {
    assert!(has_zip_magic(&[0x50, 0x4B, 0x03, 0x04]));
    assert!(has_zip_magic(&[0x50, 0x4B, 0x05, 0x06])); // empty archive
    assert!(has_zip_magic(&[0x50, 0x4B, 0x07, 0x08])); // spanned
    assert!(!has_zip_magic(b"NOTZIP.."));
    assert!(!has_zip_magic(&[0x50, 0x4B])); // too short
    assert!(!has_zip_magic(b""));
}

#[test]
fn entry_name_safety_predicate() {
    // Safe relative in-tree names.
    assert!(is_safe_entry_name("conversations.json"));
    assert!(is_safe_entry_name("projects/foo/bar.json"));
    // Traversal.
    assert!(!is_safe_entry_name("../evil.json"));
    assert!(!is_safe_entry_name("a/../../b"));
    assert!(!is_safe_entry_name("nested/../../etc/passwd"));
    // Absolute / UNC.
    assert!(!is_safe_entry_name("/etc/passwd"));
    assert!(!is_safe_entry_name("\\\\server\\share"));
    // Windows drive / alternate data stream (colon in a component).
    assert!(!is_safe_entry_name("C:\\Windows\\system32"));
    assert!(!is_safe_entry_name("file.json:stream"));
    // Backslash traversal caught on any OS.
    assert!(!is_safe_entry_name("a\\..\\b"));
    // Degenerate.
    assert!(!is_safe_entry_name(""));
    assert!(!is_safe_entry_name("a\0b"));
}

/// The lying-header defense in isolation: an infinite reader is bounded to the
/// budget and aborts, so the actual inflated size — not the declared header —
/// governs memory.
#[test]
fn read_entry_capped_bounds_actual_bytes() {
    // Infinite source: yields far more than the budget → abort at the cap.
    let err = read_entry_capped(std::io::repeat(b'A'), 128).unwrap_err();
    assert_eq!(err, ImportError::DecompressedTooLarge);
    // Within budget → returned intact.
    let ok = read_entry_capped(&b"hello world"[..], 128).unwrap();
    assert_eq!(ok.as_slice(), b"hello world");
    // Exactly at the budget is allowed.
    let exact = read_entry_capped(&b"1234"[..], 4).unwrap();
    assert_eq!(exact.len(), 4);
}

// ---- archive hardening tests (§26.4) ---------------------------------------

#[test]
fn path_traversal_entry_rejects_whole_archive() {
    let zip = build_zip(&[
        ("../evil.json", b"pwned", CompressionMethod::Stored),
        (
            "conversations.json",
            &valid_conversations_json(),
            CompressionMethod::Stored,
        ),
    ]);
    let (_dir, path) = write_export("traversal", &zip);
    let temp_root = scratch("traversal-tmp");
    let err = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::UnsafeEntry);
}

#[test]
fn symlink_entry_rejects_whole_archive() {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    writer
        .add_symlink("evil-link", "/etc/passwd", opts)
        .unwrap();
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    writer.start_file("conversations.json", opts).unwrap();
    writer.write_all(&valid_conversations_json()).unwrap();
    let zip = writer.finish().unwrap().into_inner();

    let (_dir, path) = write_export("symlink", &zip);
    let temp_root = scratch("symlink-tmp");
    let err = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::UnsafeEntry);
}

#[test]
fn non_zip_magic_bytes_rejected() {
    let (_dir, path) = write_export("notzip", b"this is definitely not a zip archive");
    let temp_root = scratch("notzip-tmp");
    let err = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::NotAnArchive);
}

#[test]
fn zip_bomb_reported_size_aborts_early() {
    // A stored (uncompressed) entry whose reported size exceeds a tiny cap.
    let big = vec![b'x'; 4096];
    let zip = build_zip(&[("conversations.json", &big, CompressionMethod::Stored)]);
    let (_dir, path) = write_export("bomb-reported", &zip);
    let temp_root = scratch("bomb-reported-tmp");
    let limits = ImportLimits {
        max_entries: 4096,
        max_total_decompressed: 256,
    };
    let err = import_archive_with(&store(), &ctx(), &path, &limits, &temp_root, 1).unwrap_err();
    assert_eq!(err, ImportError::DecompressedTooLarge);
}

#[test]
fn zip_bomb_deflated_actual_size_aborts() {
    // Highly compressible payload: small compressed, large decompressed. The
    // reported-size pre-check catches it; even if a header lied, the capped read
    // would (proven separately by `read_entry_capped_bounds_actual_bytes`).
    let big = vec![b'a'; 100_000];
    let zip = build_zip(&[("conversations.json", &big, CompressionMethod::Deflated)]);
    let (_dir, path) = write_export("bomb-deflated", &zip);
    let temp_root = scratch("bomb-deflated-tmp");
    let limits = ImportLimits {
        max_entries: 4096,
        max_total_decompressed: 1024,
    };
    let err = import_archive_with(&store(), &ctx(), &path, &limits, &temp_root, 1).unwrap_err();
    assert_eq!(err, ImportError::DecompressedTooLarge);
}

#[test]
fn too_many_entries_aborts() {
    let entries: Vec<(String, Vec<u8>)> = (0..8)
        .map(|i| (format!("file{i}.txt"), b"x".to_vec()))
        .collect();
    let refs: Vec<(&str, &[u8], CompressionMethod)> = entries
        .iter()
        .map(|(n, d)| (n.as_str(), d.as_slice(), CompressionMethod::Stored))
        .collect();
    let zip = build_zip(&refs);
    let (_dir, path) = write_export("many", &zip);
    let temp_root = scratch("many-tmp");
    let limits = ImportLimits {
        max_entries: 4,
        max_total_decompressed: 512 * 1024 * 1024,
    };
    let err = import_archive_with(&store(), &ctx(), &path, &limits, &temp_root, 1).unwrap_err();
    assert_eq!(err, ImportError::TooManyEntries);
}

#[test]
fn no_conversations_entry_rejected() {
    let zip = build_zip(&[("users.json", b"{}", CompressionMethod::Stored)]);
    let (_dir, path) = write_export("noconv", &zip);
    let temp_root = scratch("noconv-tmp");
    let err = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::NoConversations);
}

#[test]
fn malformed_json_rejected() {
    let zip = build_zip(&[(
        "conversations.json",
        b"{ this is not valid json",
        CompressionMethod::Stored,
    )]);
    let (_dir, path) = write_export("badjson", &zip);
    let temp_root = scratch("badjson-tmp");
    let err = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::MalformedJson);
}

#[test]
fn malformed_conversation_entries_skipped_and_counted() {
    // A good conversation, a non-object element (failed), and an empty-messages
    // conversation (skipped).
    let json = r#"[
          { "uuid": "ok", "chat_messages": [
             { "uuid": "m1", "sender": "human", "text": "hi",
                "created_at": "2026-07-15T10:00:00Z" } ] },
          "not-an-object",
          { "uuid": "empty", "chat_messages": [] }
        ]"#;
    let zip = build_zip(&[(
        "conversations.json",
        json.as_bytes(),
        CompressionMethod::Stored,
    )]);
    let (_dir, path) = write_export("mixed-counts", &zip);
    let temp_root = scratch("mixed-counts-tmp");
    let outcome = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap();
    assert_eq!(outcome.imported, 1, "one usable conversation");
    assert_eq!(outcome.skipped, 1, "one empty conversation skipped");
    assert_eq!(outcome.failed, 1, "one non-object element failed");
}

// ---- cleanup + content-drop ------------------------------------------------

#[test]
fn temp_root_is_empty_after_import() {
    let zip = build_zip(&[(
        "conversations.json",
        &valid_conversations_json(),
        CompressionMethod::Deflated,
    )]);
    let (_dir, path) = write_export("cleanup", &zip);
    let temp_root = scratch("cleanup-tmp");
    import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap();
    let residue: Vec<_> = std::fs::read_dir(&temp_root).unwrap().collect();
    assert!(
        residue.is_empty(),
        "the temp root must be empty after import (no extraction residue): {} entries",
        residue.len()
    );
}

#[test]
fn temp_workspace_drop_removes_nonempty_dir() {
    let root = scratch("wsdrop");
    let path = {
        let ws = TempWorkspace::new(&root).unwrap();
        std::fs::write(ws.path.join("residue.txt"), b"content").unwrap();
        assert!(ws.path.exists());
        ws.path.clone()
    }; // ws dropped here
    assert!(
        !path.exists(),
        "the workspace dir must be removed on drop, even when non-empty"
    );
}

#[test]
fn no_raw_conversation_text_reaches_the_projection() {
    let zip = build_zip(&[(
        "conversations.json",
        &valid_conversations_json(),
        CompressionMethod::Deflated,
    )]);
    let (_dir, path) = write_export("sentinel", &zip);
    let temp_root = scratch("sentinel-tmp");
    let outcome = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap();
    assert!(
        !outcome.projected_events.is_empty(),
        "the import must project day-aggregates"
    );

    // Scan every projected payload: the sentinel prompt text must appear NOWHERE.
    for event in &outcome.projected_events {
        let serialized = event.payload.to_string();
        assert!(
            !serialized.contains(SENTINEL),
            "raw conversation text leaked into a projected payload"
        );
        assert!(
            !serialized.contains("hello there") && !serialized.contains("another question"),
            "human prompt text leaked into a projected payload"
        );
    }
}

/// A conversation with NO uuid falls back to its `name` for the session id — so a
/// sentinel TITLE exercises that fallback path. The title still never reaches a
/// projected payload (the session id is not a payload field), so the content-drop
/// guarantee holds even for the derived identifier.
#[test]
fn sentinel_conversation_title_never_reaches_the_projection() {
    const TITLE_SENTINEL: &str = "SENTINEL_CONVERSATION_TITLE_QRS";
    let json = format!(
        r#"[
          {{ "name": "{TITLE_SENTINEL}",
             "chat_messages": [
               {{ "sender": "human", "text": "hi",
                  "created_at": "2026-07-15T10:00:00Z" }}
             ] }}
        ]"#
    );
    let zip = build_zip(&[(
        "conversations.json",
        json.as_bytes(),
        CompressionMethod::Stored,
    )]);
    let (_dir, path) = write_export("title-sentinel", &zip);
    let temp_root = scratch("title-sentinel-tmp");
    let outcome = import_archive_with(
        &store(),
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap();
    // The conversation imported via the name→session_id fallback (no uuid).
    assert_eq!(outcome.imported, 1);
    assert!(!outcome.projected_events.is_empty());
    for event in &outcome.projected_events {
        let serialized = event.payload.to_string();
        assert!(
            !serialized.contains(TITLE_SENTINEL),
            "conversation title (session id) leaked into a projected payload"
        );
    }
}

// ---- end-to-end ------------------------------------------------------------

#[test]
fn mixed_export_produces_sane_day_aggregates() {
    let zip = build_zip(&[(
        "export/conversations.json", // a leading dir is tolerated
        &valid_conversations_json(),
        CompressionMethod::Deflated,
    )]);
    let (_dir, path) = write_export("e2e", &zip);
    let temp_root = scratch("e2e-tmp");
    let store = store();
    let outcome = import_archive_with(
        &store,
        &ctx(),
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap();

    assert_eq!(outcome.imported, 2);
    assert_eq!(outcome.skipped, 0);
    assert_eq!(outcome.failed, 0);
    assert!(!outcome.halted);
    // Two days present ⇒ two projected day-aggregate events.
    assert_eq!(outcome.projected_events.len(), 2);
    // ADR 0060: the events ARE now enqueued for sync (was projection-only).
    assert_eq!(store.pending_count().unwrap(), 2);

    // The enqueued events decode into a valid single-source IngestRequest tagged
    // with the `claude-export` wire source — the server scopes its window-delete
    // to `claude_export@1` and never clobbers the live connector's days.
    let queued = as_pending(&outcome.projected_events);
    let source = crate::sync::batch::wire_source_for_connector(&queued[0].connector_id);
    assert_eq!(source, "claude-export");
    let request = build_request("0.1.0", 1, source, &queued);
    assert_eq!(request.source, "claude-export");
    assert_eq!(request.window.start, "2026-07-15");
    assert_eq!(request.window.end, "2026-07-16");
    assert_eq!(request.subjects.len(), 1, "one device subject");
    // The import contributes DAY-LEVEL records only — no sub-daily signals
    // (the live connector is the signal authority; ADR 0060).
    assert!(request.signals.is_empty(), "export emits no signals");

    let has = |key: &str| request.records.iter().any(|r| r.metric_key == key);
    assert!(has("active_day"));
    assert!(has("sessions"));
    assert!(has("prompts"));

    // Two prompts total (one human message per conversation), one per day.
    let prompt_total: f64 = request
        .records
        .iter()
        .filter(|r| r.metric_key == "prompts")
        .map(|r| r.value)
        .sum();
    assert_eq!(prompt_total as i64, 2, "two human prompts, one per day");
}

/// ADR 0060: the importer's connector id must equal the sync layer's export
/// connector id, so its batches upload under the `claude-export` wire source.
#[test]
fn connector_id_maps_to_the_export_wire_source() {
    assert_eq!(CONNECTOR_ID, crate::sync::batch::CLAUDE_EXPORT_CONNECTOR_ID);
    assert_eq!(
        crate::sync::batch::wire_source_for_connector(CONNECTOR_ID),
        "claude-export"
    );
}

#[test]
fn blocked_policy_halts_without_importing() {
    let zip = build_zip(&[(
        "conversations.json",
        &valid_conversations_json(),
        CompressionMethod::Stored,
    )]);
    let (_dir, path) = write_export("blocked", &zip);
    let temp_root = scratch("blocked-tmp");
    let store = store();
    let mut blocked = ctx();
    blocked.policy = PolicyResolution::Blocked(PolicyBlockReason::BroadenAttempt);
    let err = import_archive_with(
        &store,
        &blocked,
        &path,
        &ImportLimits::default(),
        &temp_root,
        1,
    )
    .unwrap_err();
    assert_eq!(err, ImportError::PolicyBlocked);
    assert_eq!(store.pending_count().unwrap(), 0);
}
