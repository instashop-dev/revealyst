//! The Claude Code connector (spec §11.3.1; Desktop Agent plan T5.1).
//!
//! Reads the Claude Code CLI's local session logs — the append-only JSONL files
//! under `~/.claude/projects/**` — and turns them into day-aggregate
//! `usage_summary` events for the sync engine. It is a faithful Rust port of the
//! reference CLI pipeline the founder already dogfoods:
//!
//! | CLI (`packages/revealyst-agent/src`) | here |
//! |--------------------------------------|------|
//! | `discover.ts` (config-dir scan)      | [`config_dirs`] + [`list_session_files`] |
//! | `parse.ts` (JSONL → ParsedEvent)     | [`parse_line`] → [`crate::extract::SourceRecord`] |
//! | `identity.ts` (person vs device)     | [`resolve_local_identity`] |
//! | `window.ts` (trailing window)        | [`trailing_window`] |
//! | `summarize.ts` (day aggregate)       | [`crate::extract::extract`] (already ported by T3.4) |
//!
//! ## Confirmed-surface-only + `unsupported_version` (spec §11.3.1)
//!
//! The only local format this connector claims to understand is the one its
//! fixtures cover — Claude Code session JSONL at schema/CLI **major version 2**
//! (`version` field, e.g. `2.0.34`). A file that declares a MAJOR version above
//! [`MAX_SUPPORTED_MAJOR`] is treated as an unsupported format: it contributes
//! **zero events** (never a partial parse of a shape we don't recognize) and
//! flips the connector to `unsupported_version` with an honesty gap. Absent or
//! unparsable versions are lenient (many record types legitimately omit it) —
//! the gate fires only on a version we can positively read AND that is beyond
//! what we support.
//!
//! ## Incremental collection (checkpoint = file manifest)
//!
//! The checkpoint is a content hash of the discovered fileset — each file's
//! path + size + mtime. On a pass:
//!
//! - **Manifest unchanged** ⇒ nothing on disk moved ⇒ zero new events, no
//!   re-emit (the incremental property).
//! - **Manifest changed** ⇒ re-aggregate the FULL trailing window across ALL
//!   files. This is deliberate: the server ingest is destructive per whole
//!   day-range (delete-window-then-upsert — see [`crate::sync::batch`]), so a
//!   push must be authoritative for the days it covers. A partial re-read of only
//!   the appended bytes would push a partial day and the server's window-delete
//!   would erase the rest of that day. Re-aggregating the window keeps every
//!   emitted day whole. Per-day **content-addressed** event ids mean an unchanged
//!   day re-hashes to the same id (dedup, no duplicate row / no re-push churn),
//!   while a day that gained activity gets a fresh id.
//!
//! Checkpoints only ever advance through
//! [`Store::enqueue_and_checkpoint`](crate::store::Store) (R1), so a crash
//! between the event commit and the checkpoint commit re-aggregates + re-enqueues
//! identical ids next run — a duplicate the server dedups, never a gap.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::extract::{
    extract, ExtractOptions, ExtractOutput, GapKind, HonestyGap, RecordKind, SourceRecord,
    UsageNumbers,
};
use crate::store::queue::NewEvent;
use crate::store::Store;
use crate::sync::batch::USAGE_SUMMARY_EVENT_TYPE;

use super::{
    Checkpoint, CollectionBatch, ConnectorContext, ConnectorDescriptor, ConnectorError,
    ConnectorHealth, ConnectorState, DetectionResult, PermissionResult, SourceConnector,
};

/// The connector id — the `connector_id` on every queued event and the
/// checkpoint key.
pub const CONNECTOR_ID: &str = "claude_code";

/// The highest Claude Code session-log MAJOR version this connector supports.
/// A file declaring a higher major is `unsupported_version` (never partial
/// parsed). Bumping this requires new fixtures proving the newer shape parses
/// identically (spec §11.3.1 / §29 "isolated behind a connector with fixtures").
pub const MAX_SUPPORTED_MAJOR: u64 = 2;

/// Record types that exist but carry nothing we may transmit — ignored without
/// reading payloads (verbatim from the CLI `parse.ts` `IGNORED_TYPES`).
const IGNORED_TYPES: [&str; 6] = [
    "summary",
    "ai-title",
    "custom-title",
    "last-prompt",
    "mode",
    "queue-operation",
];

/// The Claude Code connector. Zero-sized: all state lives on disk (the logs) and
/// in the store (the checkpoint) — the connector is a pure function of its
/// [`ConnectorContext`] plus those.
#[derive(Debug, Default, Clone, Copy)]
pub struct ClaudeCodeConnector;

impl ClaudeCodeConnector {
    pub fn new() -> Self {
        ClaudeCodeConnector
    }
}

// ---- Discovery (port of discover.ts) ---------------------------------------

/// One discovered session file — path + size + mtime (the manifest inputs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFileRef {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub mtime_ms: i64,
}

/// Bounded recursion depth guarding against symlink cycles (mirrors discover.ts
/// `MAX_SCAN_DEPTH`). Real layouts nest sidechains at
/// `projects/<proj>/<sessionId>/subagents/*.jsonl`.
const MAX_SCAN_DEPTH: usize = 6;

/// The config dirs to scan (verbatim §5 logic from discover.ts): `~/.claude`,
/// `~/.config/claude`, plus every comma-separated `CLAUDE_CONFIG_DIR` path. The
/// override is additive (ccusage parity) and the set is de-duplicated in
/// first-seen order.
pub fn config_dirs(home: &Path, config_dir_override: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![home.join(".claude"), home.join(".config").join("claude")];
    if let Some(override_val) = config_dir_override {
        for part in override_val.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                dirs.push(PathBuf::from(trimmed));
            }
        }
    }
    // De-dup, preserving order.
    let mut seen = BTreeSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// Every `*.jsonl` under `<dir>/projects/**` for each config dir, recursively.
/// Missing dirs are skipped silently (an empty machine is not an error). Sorted
/// by path for a deterministic manifest.
pub fn list_session_files(config_dirs: &[PathBuf]) -> Vec<SessionFileRef> {
    let mut refs: Vec<SessionFileRef> = Vec::new();
    for dir in config_dirs {
        walk(&dir.join("projects"), 0, &mut refs);
    }
    refs.sort_by(|a, b| a.path.cmp(&b.path));
    refs
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<SessionFileRef>) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // missing/unreadable dir — skip silently
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // deleted between read_dir and stat — skip
        };
        if meta.is_dir() {
            walk(&path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(SessionFileRef {
                path,
                size_bytes: meta.len(),
                mtime_ms: mtime_ms(&meta),
            });
        }
    }
}

/// File mtime as epoch ms (0 if unavailable — a stable sentinel; combined with
/// size it still changes the manifest when the file is rewritten).
fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The checkpoint value: a SHA-256 over the sorted `(path, size, mtime)` of every
/// discovered file. Deterministic; changes iff a file is added, removed, grown,
/// or touched.
pub fn compute_manifest(files: &[SessionFileRef]) -> String {
    let mut hasher = Sha256::new();
    for f in files {
        hasher.update(f.path.to_string_lossy().as_bytes());
        hasher.update([0u8]);
        hasher.update(f.size_bytes.to_le_bytes());
        hasher.update(f.mtime_ms.to_le_bytes());
        hasher.update([0u8]);
    }
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// ---- Parsing (port of parse.ts) --------------------------------------------

/// The parse of one file: its records + drift counters + the max declared format
/// major version seen (drives the `unsupported_version` gate).
#[derive(Debug, Default)]
struct FileParse {
    records: Vec<SourceRecord>,
    skipped_lines: u64,
    unknown_types: u64,
    /// The highest positively-parsed `version` major in the file, if any.
    max_major: Option<u64>,
}

/// Parse one session file line-by-line (never materializing a multi-GB file as
/// one string). Mirrors the CLI `createSessionParser`: unparseable lines and
/// unknown record types are counted and skipped, never fatal. The connector reads
/// only block TYPE (to classify prompt vs tool-result activity) and the §5
/// allowlisted structural fields — never block/prompt CONTENT (§29: raw prompt
/// text is never read into the connector, so it can never be stored or sent).
fn parse_file(path: &Path) -> std::io::Result<FileParse> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut fp = FileParse::default();
    for line in reader.lines() {
        // A mid-read I/O error abandons the file's already-parsed prefix (mirrors
        // stream.ts all-or-nothing) — propagate so the caller counts it unreadable.
        let line = line?;
        parse_line(&line, &mut fp);
    }
    Ok(fp)
}

/// Fold one JSONL line into the file parse. Byte-for-byte the CLI `pushLine`
/// classification (`parse.ts`), plus the version read for the format gate.
fn parse_line(line: &str, fp: &mut FileParse) {
    if line.trim().is_empty() {
        return;
    }
    let record: Value = match serde_json::from_str(line) {
        Ok(Value::Object(map)) => Value::Object(map),
        Ok(_) => {
            fp.skipped_lines += 1;
            return;
        }
        Err(_) => {
            fp.skipped_lines += 1;
            return;
        }
    };

    // Version read for the unsupported-format gate. Denylisted for the EVENT
    // (never enters a SourceRecord) — read here only to decide supported-ness.
    if let Some(major) = record
        .get("version")
        .and_then(Value::as_str)
        .and_then(parse_major)
    {
        fp.max_major = Some(fp.max_major.map_or(major, |m| m.max(major)));
    }

    let ty = match non_empty_str(&record, "type") {
        Some(t) => t,
        None => {
            fp.skipped_lines += 1;
            return;
        }
    };
    if IGNORED_TYPES.contains(&ty) {
        return; // ignored, not counted
    }

    let session_id = match non_empty_str(&record, "sessionId") {
        Some(s) => s.to_string(),
        None => {
            fp.skipped_lines += 1;
            return;
        }
    };
    let timestamp_ms = match record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_ms)
    {
        Some(ms) => ms,
        None => {
            fp.skipped_lines += 1;
            return;
        }
    };
    let is_sidechain = record.get("isSidechain") == Some(&Value::Bool(true));

    match ty {
        "assistant" => {
            let message = record.get("message");
            // Guard to an OBJECT before parsing, mirroring the CLI's truthy
            // `usageRaw ? {...} : null` check (parse.ts): a `"usage": null`
            // (or any non-object) yields None, so the extractor does NOT count a
            // model request / emit model_tokens=0 for a turn the CLI would skip.
            // Without this, `.map(parse_usage)` on `Some(Value::Null)` produces a
            // spurious all-zero usage turn — a CLI-parity divergence.
            let usage = message
                .and_then(|m| m.get("usage"))
                .filter(|u| u.is_object())
                .map(parse_usage);
            fp.records.push(SourceRecord {
                kind: RecordKind::Assistant,
                session_id,
                timestamp_ms,
                is_sidechain,
                dedup_key: dedup_key(&record, message, timestamp_ms),
                // Raw model id; the extractor sanitizes it (counts::sanitize_model)
                // before it can enter a payload.
                model: message
                    .and_then(|m| m.get("model"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                usage,
                content: None,
            });
        }
        "user" => {
            let kind = if is_sidechain || is_tool_result_carrier(&record) {
                RecordKind::Activity
            } else {
                RecordKind::Prompt
            };
            fp.records.push(SourceRecord {
                kind,
                session_id,
                timestamp_ms,
                is_sidechain,
                dedup_key: String::new(),
                model: None,
                usage: None,
                // Deliberately never read the prompt text (§29) — only its
                // EXISTENCE (kind=prompt) is counted downstream.
                content: None,
            });
        }
        "system" | "attachment" => {
            fp.records.push(SourceRecord {
                kind: RecordKind::Activity,
                session_id,
                timestamp_ms,
                is_sidechain,
                dedup_key: String::new(),
                model: None,
                usage: None,
                content: None,
            });
        }
        _ => {
            fp.unknown_types += 1;
        }
    }
}

/// A non-empty string field (mirrors the CLI `asString`: empty string ⇒ absent).
fn non_empty_str<'a>(record: &'a Value, key: &str) -> Option<&'a str> {
    record
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

/// `requestId ?? message.id ?? uuid ?? "<sessionId>:<timestampMs>"` — the
/// stream-stable dedup key (CLI `parse.ts`).
fn dedup_key(record: &Value, message: Option<&Value>, timestamp_ms: i64) -> String {
    non_empty_str(record, "requestId")
        .map(str::to_string)
        .or_else(|| {
            message
                .and_then(|m| non_empty_str(m, "id"))
                .map(str::to_string)
        })
        .or_else(|| non_empty_str(record, "uuid").map(str::to_string))
        .unwrap_or_else(|| {
            let session = non_empty_str(record, "sessionId").unwrap_or("");
            format!("{session}:{timestamp_ms}")
        })
}

/// A user record is a tool-result carrier (activity, not a human prompt) when a
/// `toolUseResult` key is present OR any `message.content` block has
/// `type == "tool_result"`. Only block TYPE is inspected — never block content.
fn is_tool_result_carrier(record: &Value) -> bool {
    if record.get("toolUseResult").is_some() {
        return true;
    }
    record
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks
                .iter()
                .any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
        })
}

/// Token counts from a `message.usage` object (mirrors the CLI `UsageNumbers`
/// mapping; a missing/non-finite field is 0).
fn parse_usage(usage: &Value) -> UsageNumbers {
    UsageNumbers {
        input: usage_num(usage, "input_tokens"),
        output: usage_num(usage, "output_tokens"),
        cache_read: usage_num(usage, "cache_read_input_tokens"),
        cache_write: usage_num(usage, "cache_creation_input_tokens"),
    }
}

fn usage_num(usage: &Value, key: &str) -> u64 {
    match usage.get(key) {
        Some(Value::Number(n)) => n
            .as_u64()
            .or_else(|| {
                n.as_f64()
                    .filter(|f| f.is_finite() && *f >= 0.0)
                    .map(|f| f as u64)
            })
            .unwrap_or(0),
        _ => 0,
    }
}

/// The major component of a `MAJOR.MINOR.PATCH` version string, if it parses.
fn parse_major(version: &str) -> Option<u64> {
    version.split('.').next()?.parse::<u64>().ok()
}

/// Parse an RFC-3339 / ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`)
/// to epoch ms. Covers the confirmed Claude Code session-log format; returns
/// `None` for anything it can't read (⇒ the line is skipped, like the CLI's
/// `Number.isNaN(Date.parse(...))`). No chrono dependency.
fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Optional fractional seconds + optional timezone offset.
    let mut rest = &s[19..];
    let mut millis: i64 = 0;
    if let Some(stripped) = rest.strip_prefix('.') {
        let frac_len = stripped.chars().take_while(char::is_ascii_digit).count();
        let frac = &stripped[..frac_len];
        // Use up to 3 fractional digits as milliseconds.
        let ms_digits: String = frac.chars().take(3).collect();
        if !ms_digits.is_empty() {
            let scaled = format!("{ms_digits:0<3}");
            millis = scaled.parse().ok()?;
        }
        rest = &stripped[frac_len..];
    }

    // Timezone: Z (UTC) or ±HH:MM offset (subtracted to reach UTC).
    let mut offset_minutes: i64 = 0;
    match rest.chars().next() {
        Some('Z') | Some('z') | None => {}
        Some(sign @ ('+' | '-')) => {
            let off = &rest[1..];
            let oh: i64 = off.get(0..2)?.parse().ok()?;
            let om: i64 = off.get(3..5).unwrap_or("00").parse().ok()?;
            let total = oh * 60 + om;
            offset_minutes = if sign == '+' { total } else { -total };
        }
        _ => return None,
    }

    let days = days_from_civil(year, month, day);
    let secs = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60;
    Some(secs * 1_000 + millis)
}

/// (year, month, day) → days since the Unix epoch (Howard Hinnant's civil
/// algorithm, forward direction — the inverse of the extractor's
/// `civil_from_days`).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (if m > 2 { m - 3 } else { m + 9 }) as i64; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Epoch ms for the UTC midnight of a `YYYY-MM-DD` day (the aggregate event's
/// representative `occurred_at`).
fn day_start_ms(day: &str) -> i64 {
    let y: i64 = day.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(1970);
    let m: u32 = day.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: u32 = day.get(8..10).and_then(|s| s.parse().ok()).unwrap_or(1);
    days_from_civil(y, m, d) * 86_400_000
}

// ---- Trailing window (port of window.ts) -----------------------------------

/// Inclusive trailing UTC-day window ending today (`now_ms`). Mirrors the CLI
/// `trailingWindow`.
pub fn trailing_window(now_ms: i64, days: u32) -> (String, String) {
    let days = days.max(1) as i64;
    let end = utc_day(now_ms);
    let start = utc_day(now_ms - (days - 1) * 86_400_000);
    (start, end)
}

/// Epoch ms → `YYYY-MM-DD` (UTC). One formatter shared with the extractor's day
/// bucketing (same civil algorithm), so pinning and aggregation never disagree.
fn utc_day(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---- Identity (port of identity.ts) ----------------------------------------

/// The subject the device's events are attributed to, plus the attribution
/// ladder level. Person only when consent was given AND the machine is not
/// declared shared; otherwise a stable device-scoped account (never a guessed
/// person — review invariant-b).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalIdentity {
    pub kind: &'static str,
    pub external_id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    /// Attribution ladder level: `"person"` or `"account"`.
    pub attribution: &'static str,
}

impl LocalIdentity {
    fn subject_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "externalId": self.external_id,
            "email": self.email,
            "displayName": self.display_name,
        })
    }
}

/// Read `oauthAccount.emailAddress` from `<home>/.claude.json`. Never throws; any
/// read/parse failure means "no identity available" (mirrors the CLI
/// `readOauthEmail`).
fn read_oauth_email(home: &Path) -> Option<(String, Option<String>)> {
    let raw = std::fs::read_to_string(home.join(".claude.json")).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    let account = parsed.get("oauthAccount")?;
    let email = account.get("emailAddress").and_then(Value::as_str)?;
    if !email.contains('@') {
        return None;
    }
    let display = account
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some((email.to_lowercase(), display))
}

/// Resolve the device's subject + attribution (spec §10.3 shared-session +
/// identity.ts). A shared-computer declaration forces the `account` ladder even
/// when a person email is readable — the ambiguity is disclosed, never guessed.
pub fn resolve_local_identity(ctx: &ConnectorContext) -> LocalIdentity {
    let allow_person = ctx.consent_identity && !ctx.shared_device;
    if allow_person {
        if let Some((email, display)) = read_oauth_email(&ctx.home_dir) {
            return LocalIdentity {
                kind: "person",
                external_id: email.clone(),
                email: Some(email),
                display_name: display,
                attribution: "person",
            };
        }
    }
    let hash = hex(&Sha256::digest(ctx.device_seed.as_bytes()));
    LocalIdentity {
        kind: "account",
        external_id: format!("device:{}", &hash[..16]),
        email: None,
        display_name: None,
        attribution: "account",
    }
}

// ---- Aggregate → usage_summary events --------------------------------------

/// Build the day-aggregate `usage_summary` queue events (the
/// [`UsageSummaryPayload`](crate::sync::batch) wire shape) from the extractor
/// output. One event per day; the subject + attribution are stamped from the
/// resolved identity. All honesty gaps (the extractor's + the connector's) ride
/// the EARLIEST day's event once, so the batch builder carries them a single time
/// rather than duplicating them per day.
///
/// ## Window-authoritative delete contract (T4.1)
///
/// The days we emit here become the batch's window: [`build_request`](crate::sync::batch)
/// derives `window = min..max` of the emitted days, and the server ingest is
/// DESTRUCTIVE per that whole day-range — `deleteWindowForConnection(start..=end)`
/// then upsert ("a push is authoritative for its window"). Days with no records
/// are omitted, so the window auto-pins to real data (no over-deletion at the
/// edges — ADR 0025). The one residual assumption: a day INSIDE the bounding
/// range that loses its only local source between pushes (unusual selective
/// mid-window log deletion) would be delete-erased with no re-upsert, because we
/// emit no event for it yet it falls within min..max. Full-window re-aggregation
/// (only the ends can pin) means this cannot happen at the boundaries; it is a
/// tolerated edge for interior days that vanish from disk mid-window.
fn build_usage_events(
    out: &ExtractOutput,
    identity: &LocalIdentity,
    extra_gaps: &[HonestyGap],
) -> Vec<NewEvent> {
    let days: BTreeSet<&str> = out.records.iter().map(|r| r.day.as_str()).collect();
    let mut all_gaps: Vec<Value> = Vec::new();
    for gap in out.gaps.iter().chain(extra_gaps.iter()) {
        all_gaps.push(gap_json(gap));
    }

    let subject = identity.subject_json();
    let mut events = Vec::with_capacity(days.len());
    for (idx, day) in days.iter().copied().enumerate() {
        let records: Vec<Value> = out
            .records
            .iter()
            .filter(|r| r.day == day)
            .map(|r| {
                json!({
                    "metricKey": r.metric_key.as_str(),
                    "dim": r.dim,
                    "value": r.value,
                    "attribution": identity.attribution,
                })
            })
            .collect();
        let signal = out.signals.iter().find(|s| s.day == day).map(|s| {
            json!({
                "hours": s.hours.to_vec(),
                "peakConcurrency": s.peak_concurrency,
                "sourceGranularity": s.source_granularity,
            })
        });
        // Gaps ride the earliest day only (deterministic; days is sorted).
        let gaps = if idx == 0 {
            all_gaps.clone()
        } else {
            Vec::new()
        };

        let payload = json!({
            "subject": subject.clone(),
            "day": day,
            "records": records,
            "signal": signal,
            "gaps": gaps,
        });

        // Content-addressed id: an unchanged day re-hashes to the same id (dedup,
        // crash-safe), a changed day gets a fresh one.
        let digest = hex(&Sha256::digest(payload.to_string().as_bytes()));
        let event_id = format!(
            "{}|{}|{}|summary|{}",
            CONNECTOR_ID,
            identity.external_id,
            day,
            &digest[..16]
        );
        events.push(NewEvent::analytics_only(
            event_id,
            CONNECTOR_ID,
            USAGE_SUMMARY_EVENT_TYPE,
            day_start_ms(day),
            payload,
        ));
    }
    events
}

fn gap_json(gap: &HonestyGap) -> Value {
    match &gap.detail {
        Some(detail) => json!({ "kind": gap_kind_str(gap.kind), "detail": detail }),
        None => json!({ "kind": gap_kind_str(gap.kind) }),
    }
}

fn gap_kind_str(kind: GapKind) -> &'static str {
    match kind {
        GapKind::OauthActorsMissing => "oauth_actors_missing",
        GapKind::TelemetryOnlyUsersInTotals => "telemetry_only_users_in_totals",
        GapKind::SharedKeyNotPersonLevel => "shared_key_not_person_level",
        GapKind::ServiceAccountsUnresolved => "service_accounts_unresolved",
        GapKind::SubDailyUnavailable => "sub_daily_unavailable",
        GapKind::SyncWindowIncomplete => "sync_window_incomplete",
        GapKind::Other => "other",
    }
}

/// The pure core of [`SourceConnector::collect`], split out so it is testable
/// without the store/trait plumbing: given the discovered files + the context, it
/// parses, version-gates, extracts, and builds the batch. Returns the batch with
/// its computed manifest.
fn collect_from_files(
    ctx: &ConnectorContext,
    files: &[SessionFileRef],
    checkpoint: Option<&Checkpoint>,
) -> CollectionBatch {
    if files.is_empty() {
        return CollectionBatch {
            state: Some(ConnectorState::NotDetected),
            new_checkpoint: None,
            ..CollectionBatch::default()
        };
    }

    let manifest = compute_manifest(files);
    if checkpoint.is_some_and(|c| c.0 == manifest) {
        // Nothing on disk moved — no re-emit (the incremental property).
        return CollectionBatch {
            state: Some(ConnectorState::Ready),
            new_checkpoint: None,
            ..CollectionBatch::default()
        };
    }

    let mut records: Vec<SourceRecord> = Vec::new();
    let mut skipped_lines: u64 = 0;
    let mut unknown_types: u64 = 0;
    let mut unreadable_files: u64 = 0;
    let mut unsupported_files: u64 = 0;

    for f in files {
        match parse_file(&f.path) {
            Ok(fp) => {
                if fp.max_major.is_some_and(|m| m > MAX_SUPPORTED_MAJOR) {
                    // Unsupported format version: discard the WHOLE file's records
                    // (never a partial parse of a shape we don't recognize) and
                    // flag the connector. spec §11.3.1.
                    unsupported_files += 1;
                    continue;
                }
                records.extend(fp.records);
                skipped_lines += fp.skipped_lines;
                unknown_types += fp.unknown_types;
            }
            Err(_) => unreadable_files += 1,
        }
    }

    let identity = resolve_local_identity(ctx);
    let (window_start, window_end) = trailing_window(ctx.now_ms, ctx.window_days);
    let out = extract(
        &records,
        &ExtractOptions {
            subject_external_id: identity.external_id.clone(),
            connector_id: CONNECTOR_ID.to_string(),
            window_start: window_start.clone(),
            window_end,
        },
    );

    // Connector-level honesty gaps layered onto the extractor's (spend estimate /
    // unknown model). Every one is a content-free, code-authored disclosure.
    let mut extra_gaps: Vec<HonestyGap> = Vec::new();
    if unsupported_files > 0 {
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(format!(
                "{unsupported_files} session file(s) use an unsupported Claude Code format version and were skipped without partial parsing"
            )),
        });
    }
    if skipped_lines > 0 || unknown_types > 0 {
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(format!(
                "log parse drift: {skipped_lines} lines skipped, {unknown_types} unknown record types"
            )),
        });
    }
    if unreadable_files > 0 {
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(format!(
                "{unreadable_files} session file(s) could not be read"
            )),
        });
    }
    if ctx.shared_device {
        // spec §10.3 ambiguous shared session: attribution demoted to the device,
        // never a guessed person.
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(
                "this computer is declared shared; activity is attributed to the device, not an individual (spec §10.3)".to_string(),
            ),
        });
    }
    // ADR 0025 window-pin honesty: the pushed window auto-pins to the days we
    // actually emit; if that is later than the requested lookback start, say so.
    let earliest = out
        .records
        .iter()
        .map(|r| r.day.as_str())
        .min()
        .filter(|e| *e > window_start.as_str());
    if let Some(earliest) = earliest {
        extra_gaps.push(HonestyGap {
            kind: GapKind::SyncWindowIncomplete,
            detail: Some(format!(
                "local logs only cover from {earliest}; requested lookback started {window_start} — earlier days were left untouched"
            )),
        });
    }

    let usage_events = build_usage_events(&out, &identity, &extra_gaps);

    // When ALL detected files are unsupported, `out.records` is empty ⇒
    // `build_usage_events` emits no event ⇒ the computed honesty gaps (incl. the
    // "unsupported format" disclosure) never reach the wire, because there is
    // nothing to sync. That is acceptable: in this case the disclosure lives in
    // the persisted `connector_state = unsupported_version` (set by
    // `collect_and_enqueue`), which the status surface reads — not in an
    // `AgentIngestRequest.gaps[]` entry. `batch.gaps` still carries it for any
    // in-process consumer/test.
    let state = if unsupported_files > 0 && out.records.is_empty() {
        ConnectorState::UnsupportedVersion
    } else if unsupported_files > 0 {
        ConnectorState::PartiallySupported
    } else {
        ConnectorState::Collecting
    };

    CollectionBatch {
        state: Some(state),
        usage_events,
        candidate_events: out.candidate_events,
        new_checkpoint: Some(Checkpoint(manifest)),
        gaps: extra_gaps,
    }
}

impl SourceConnector for ClaudeCodeConnector {
    fn descriptor(&self) -> ConnectorDescriptor {
        ConnectorDescriptor {
            id: CONNECTOR_ID,
            display_name: "Claude Code",
            provider: "anthropic",
            product: "claude_code",
        }
    }

    async fn detect(&self, ctx: &ConnectorContext) -> Result<DetectionResult, ConnectorError> {
        let dirs = config_dirs(&ctx.home_dir, ctx.config_dir_override.as_deref());
        // A "location" is a config dir that actually has a projects/ subtree.
        let locations = dirs.iter().filter(|d| d.join("projects").is_dir()).count();
        let files = list_session_files(&dirs);
        let state = if files.is_empty() {
            ConnectorState::NotDetected
        } else {
            ConnectorState::Ready
        };
        Ok(DetectionResult { state, locations })
    }

    async fn request_permissions(
        &self,
        _ctx: &ConnectorContext,
    ) -> Result<PermissionResult, ConnectorError> {
        // Reads the user's OWN home directory via the Rust core — no OS
        // permission prompt in Phase 1.
        Ok(PermissionResult { granted: true })
    }

    async fn load_checkpoint(&self, store: &Store) -> Result<Option<Checkpoint>, ConnectorError> {
        Ok(store.checkpoint(CONNECTOR_ID)?.map(Checkpoint))
    }

    async fn collect(
        &self,
        ctx: &ConnectorContext,
        checkpoint: Option<Checkpoint>,
    ) -> Result<CollectionBatch, ConnectorError> {
        let dirs = config_dirs(&ctx.home_dir, ctx.config_dir_override.as_deref());
        let files = list_session_files(&dirs);
        Ok(collect_from_files(ctx, &files, checkpoint.as_ref()))
    }

    async fn health(&self, ctx: &ConnectorContext) -> Result<ConnectorHealth, ConnectorError> {
        let detection = self.detect(ctx).await?;
        Ok(ConnectorHealth {
            state: detection.state,
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
