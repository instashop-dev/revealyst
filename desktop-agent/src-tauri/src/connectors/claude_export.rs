//! The Claude data-export importer (spec §11.3.2; Desktop Agent plan T5.3).
//!
//! A **user-initiated** importer (not a background loop): given the path to a
//! Claude data export, it validates + parses the archive **entirely in memory**,
//! reduces it to the same Analytics-Only day-aggregates the live Claude Code
//! connector produces (reusing the T3.4 extractor), and runs them through the
//! T3.3 privacy gate. It reports `{imported, skipped, failed}` conversation
//! counts and returns the validated, projected `usage_summary` events.
//!
//! ## Live sync is GATED — the projection is NOT enqueued (data-loss guard)
//!
//! This importer deliberately **does NOT enqueue** the projected events into the
//! shared sync queue. The desktop agent uploads through ONE device connection,
//! and the server's window-delete is **connection-scoped, not connector-scoped**
//! (`deleteWindowForConnection`, `src/lib/agent-ingest.ts` /
//! `src/db/org-scope/metrics.ts`): it erases the whole `min..max` day-window for
//! the connection regardless of `sourceConnector`. So an import that spans or
//! overlaps days the live `claude_code` connector also covers (e.g. a chunk
//! carrying Jul 1 + Jul 16 ⇒ window `[Jul 1 .. Jul 16]`) would clobber the live
//! rows for the intervening days on the next sync — a HIGH data-loss defect. The
//! full parse + hardening + privacy validation runs and the projection is
//! returned/inspected, but live import→sync stays gated on a
//! connector-scoped-ingest decision (ADR). See [`CONNECTOR_ID`] and
//! [`import_archive_with`].
//!
//! ## The export shape we parse
//!
//! A Claude.ai data export is a ZIP whose payload of interest is
//! `conversations.json` — a JSON array of conversation objects:
//!
//! ```json
//! [ { "uuid": "…", "name": "…", "created_at": "…",
//!     "chat_messages": [ { "uuid": "…", "sender": "human"|"assistant",
//!                          "text": "…", "created_at": "…" } ] } ]
//! ```
//!
//! We read ONLY the structural fields — `sender` (to classify prompt vs
//! assistant turn), the message timestamp (to bucket by UTC day), and the
//! conversation/message ids (for session grouping + dedup). The message
//! **`text`/`content` is never read** into a [`SourceRecord`] (`content: None`),
//! so raw conversation text can neither be counted, stored, queued, nor uploaded
//! (spec §29; the strongest form of the extractor's content-drop — we never
//! touch the bytes). Exports carry no token usage, so an import yields the
//! activity-shaped day metrics (`active_day` / `sessions` / `prompts`) with zero
//! token/spend — sane, honest day-aggregates.
//!
//! ## Hardening (spec §26.4 — the crux)
//!
//! The importer treats the archive as hostile input:
//!
//! 1. **Magic bytes.** The file must begin with a real ZIP signature (`PK\x03\x04`
//!    / `PK\x05\x06` / `PK\x07\x08`) — an extension is not trusted. A non-ZIP is
//!    rejected before the ZIP reader ever sees it.
//! 2. **Path-traversal / symlink rejection (fail-closed).** Every entry name is
//!    validated ([`is_safe_entry_name`]): a `..` component, an absolute path, a
//!    UNC/backslash root, or a Windows drive/ADS colon rejects the WHOLE archive,
//!    as does any entry the ZIP marks as a symlink. Because we never extract to
//!    disk, a traversal name could not write outside a temp dir anyway — but we
//!    reject it regardless, as malicious.
//! 3. **File-count cap.** `archive.len() > max_entries` aborts immediately,
//!    before any entry is read.
//! 4. **Decompressed-size cap, two-layer.** A cheap pre-check sums each entry's
//!    *reported* uncompressed size and aborts if the total exceeds the cap
//!    (honest-header zip-bomb defense). Then the ONE entry we actually inflate
//!    (`conversations.json`) is read through [`read_entry_capped`], which bounds
//!    the ACTUAL bytes read to the cap — so a **lying header** (small declared
//!    size, huge real output) is caught mid-inflate and aborted, with memory
//!    bounded to `cap + 1` bytes. Non-target entries are never inflated, so a
//!    bomb hidden in one costs nothing.
//! 5. **No disk extraction.** Parsing is fully in-memory (`ZipArchive` reads the
//!    file via `Seek`; the target entry inflates into a capped `Vec`). A scoped
//!    [`TempWorkspace`] is still created and RAII-cleaned so any future disk
//!    spill is guaranteed to be removed; the happy path writes nothing to it, and
//!    the tests assert the temp root is left empty (verified cleanup).
//!
//! A malformed conversation *entry* is skipped and counted (never a partial
//! parse); an unreadable/oversized/traversal archive fails closed with a
//! content-free error code.

use std::io::{Read, Seek};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::extract::{
    extract, ExtractOptions, ExtractOutput, GapKind, HonestyGap, RecordKind, SourceRecord,
};
use crate::privacy::{validate, PolicyResolution};
use crate::store::queue::NewEvent;
use crate::store::Store;
use crate::sync::batch::USAGE_SUMMARY_EVENT_TYPE;

use super::claude_code::{resolve_local_identity, LocalIdentity};
use super::ConnectorContext;

/// The connector id stamped on projected import events.
///
/// **NOTE: this is NOT a safety boundary.** The desktop agent uploads through ONE
/// device connection, and the server's window-delete
/// (`deleteWindowForConnection`) is **connection-scoped, not connector-scoped** —
/// it erases the whole `min..max` day-window for the connection regardless of
/// `sourceConnector`. So an import that spans or overlaps days the live
/// `claude_code` connector also covers WOULD clobber the live rows for those days
/// on sync. A distinct connector id does not prevent this. Because of it, live
/// import→sync is gated: the importer computes + validates the projected events
/// but does NOT enqueue them into the shared sync queue (see
/// [`import_archive_with`]), pending a connector-scoped-ingest ADR.
pub const CONNECTOR_ID: &str = "claude_export";

/// The entry the importer inflates. Matched on basename anywhere in the archive
/// (a real export nests it at the root, but we tolerate a leading dir).
const CONVERSATIONS_ENTRY: &str = "conversations.json";

/// Bounds on a single import, injectable so tests can drive the abort paths with
/// tiny caps while production stays generous. `Default` is the production policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportLimits {
    /// Max number of archive entries before aborting (file-count cap).
    pub max_entries: usize,
    /// Max total decompressed bytes — enforced against BOTH the reported header
    /// sizes (pre-check) and the actual inflated bytes (lying-header defense).
    pub max_total_decompressed: u64,
}

impl Default for ImportLimits {
    fn default() -> Self {
        ImportLimits {
            // A Claude export is a handful of files; 4096 is orders of magnitude
            // of headroom while still bounding a "many tiny entries" bomb.
            max_entries: 4_096,
            // 512 MiB covers a heavy user's full history yet bounds memory.
            max_total_decompressed: 512 * 1024 * 1024,
        }
    }
}

/// A user-facing, content-free failure. Every variant maps to a fixed code (for
/// logs) and a plain-English message (for the import screen) — never any part of
/// the archive's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportError {
    /// The file does not start with a ZIP signature.
    NotAnArchive,
    /// The ZIP structure is malformed / unreadable.
    MalformedArchive,
    /// An entry name is a path-traversal / absolute path / symlink.
    UnsafeEntry,
    /// More entries than [`ImportLimits::max_entries`].
    TooManyEntries,
    /// Reported or actual decompressed bytes exceed the cap (zip-bomb).
    DecompressedTooLarge,
    /// No `conversations.json` entry in the archive.
    NoConversations,
    /// `conversations.json` is not valid JSON at all.
    MalformedJson,
    /// Collection policy is blocked (transient) — nothing imported.
    PolicyBlocked,
    /// A local I/O or store failure.
    Io,
}

impl ImportError {
    /// A stable, content-free code for structured logs.
    pub fn code(&self) -> &'static str {
        match self {
            ImportError::NotAnArchive => "import_not_an_archive",
            ImportError::MalformedArchive => "import_malformed_archive",
            ImportError::UnsafeEntry => "import_unsafe_entry",
            ImportError::TooManyEntries => "import_too_many_entries",
            ImportError::DecompressedTooLarge => "import_decompressed_too_large",
            ImportError::NoConversations => "import_no_conversations",
            ImportError::MalformedJson => "import_malformed_json",
            ImportError::PolicyBlocked => "import_policy_blocked",
            ImportError::Io => "import_io_failed",
        }
    }

    /// Plain-English guidance for the import screen (CLAUDE.md UX rule).
    pub fn user_message(&self) -> &'static str {
        match self {
            ImportError::NotAnArchive => {
                "That file isn't a Claude export. Choose the .zip you downloaded from Claude."
            }
            ImportError::MalformedArchive => {
                "That export couldn't be opened — it may be incomplete. Try downloading it again."
            }
            ImportError::UnsafeEntry => {
                "That export contains unexpected file paths, so it wasn't imported for safety."
            }
            ImportError::TooManyEntries | ImportError::DecompressedTooLarge => {
                "That export is unexpectedly large, so it wasn't imported for safety."
            }
            ImportError::NoConversations => {
                "That export doesn't contain a conversations file. Choose your Claude data export."
            }
            ImportError::MalformedJson => {
                "The conversations in that export couldn't be read. Try downloading it again."
            }
            ImportError::PolicyBlocked => {
                "Importing is paused right now. Try again once collection is allowed."
            }
            ImportError::Io => "Something went wrong reading that file. Please try again.",
        }
    }
}

impl From<crate::store::StoreError> for ImportError {
    fn from(_: crate::store::StoreError) -> Self {
        ImportError::Io
    }
}

/// The result of one import: the per-conversation counts for the import screen +
/// the validated, projected day-aggregate events. The projection is deliberately
/// NOT enqueued into the shared sync queue (see the module docs / [`CONNECTOR_ID`]
/// on the connection-scoped window-delete data-loss guard); it is returned so the
/// caller (and tests) can inspect exactly what a future connector-scoped-ingest
/// path WOULD sync.
#[derive(Debug, Default)]
pub struct ImportOutcome {
    /// Conversations that contributed at least one usable message.
    pub imported: usize,
    /// Conversations with no usable messages (empty / all-unparseable turns).
    pub skipped: usize,
    /// Conversation entries that were not a parseable object.
    pub failed: usize,
    /// Candidate events that would have quarantined (>0 ⇒ failed closed).
    pub would_quarantine: usize,
    /// `true` iff the import halted before projection (policy blocked / drift).
    pub halted: bool,
    /// The validated day-aggregate `usage_summary` events this import WOULD sync.
    /// NOT enqueued — live sync is gated (see the module docs).
    pub projected_events: Vec<NewEvent>,
}

// ---- Archive validation ----------------------------------------------------

/// Whether `bytes` begins with a ZIP local-file / end-of-central-dir / spanned
/// signature. The extension is never trusted (spec §26.4 magic-byte check).
fn has_zip_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && bytes[0] == 0x50
        && bytes[1] == 0x4B
        && matches!(bytes[2], 0x03 | 0x05 | 0x07)
}

/// Is `name` a safe RELATIVE, in-tree archive entry name? Rejects the classic
/// traversal vectors so a crafted entry can never point outside a controlled
/// root (spec §26.4). Pure + total, so it is unit-tested directly.
///
/// Rejected: empty · a NUL byte · an absolute path (`/…` or `\…`) · any `..`
/// path component · any component carrying a `:` (a Windows drive letter like
/// `C:` or an alternate-data-stream `file:stream`). Both `/` and `\` are treated
/// as separators so a Windows-style traversal is caught on any OS.
pub fn is_safe_entry_name(name: &str) -> bool {
    if name.is_empty() || name.contains('\0') {
        return false;
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return false;
    }
    for component in name.split(['/', '\\']) {
        if component == ".." || component.contains(':') {
            return false;
        }
    }
    true
}

/// Read at most `budget + 1` bytes from `reader`; error with
/// [`ImportError::DecompressedTooLarge`] if the source yields MORE than `budget`.
///
/// This is the lying-header defense: it bounds the ACTUAL inflated output
/// regardless of what the ZIP header claimed, so a small-compressed /
/// huge-decompressed entry cannot exhaust memory — at most `budget + 1` bytes are
/// ever materialized. Pure over any `Read`, so it is unit-tested against an
/// infinite reader.
fn read_entry_capped<R: Read>(reader: R, budget: u64) -> Result<Vec<u8>, ImportError> {
    let mut buf = Vec::new();
    let mut limited = reader.take(budget.saturating_add(1));
    limited
        .read_to_end(&mut buf)
        .map_err(|_| ImportError::MalformedArchive)?;
    if buf.len() as u64 > budget {
        return Err(ImportError::DecompressedTooLarge);
    }
    Ok(buf)
}

/// Open + validate the archive and return the decompressed `conversations.json`
/// bytes — WITHOUT extracting anything to disk. All the §26.4 caps are enforced
/// here before a single byte of the target entry is inflated.
fn read_conversations_bytes(
    archive_path: &Path,
    limits: &ImportLimits,
) -> Result<Vec<u8>, ImportError> {
    let mut file = std::fs::File::open(archive_path).map_err(|_| ImportError::Io)?;

    // 1 — magic bytes (before the ZIP reader touches it).
    let mut magic = [0u8; 4];
    let read = read_prefix(&mut file, &mut magic).map_err(|_| ImportError::Io)?;
    if !has_zip_magic(&magic[..read]) {
        return Err(ImportError::NotAnArchive);
    }
    file.rewind().map_err(|_| ImportError::Io)?;

    let mut archive = ZipArchive::new(file).map_err(|_| ImportError::MalformedArchive)?;

    // 3 — file-count cap (before reading any entry metadata deeply).
    if archive.len() > limits.max_entries {
        return Err(ImportError::TooManyEntries);
    }

    // Metadata pass: validate every entry name + symlink flag (fail closed on any
    // unsafe entry), sum reported sizes (honest-header bomb pre-check), and locate
    // the conversations entry — all without inflating anything.
    let mut reported_total: u64 = 0;
    let mut target: Option<usize> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| ImportError::MalformedArchive)?;
        let name = entry.name().to_string();
        if !is_safe_entry_name(&name) || entry.is_symlink() {
            return Err(ImportError::UnsafeEntry);
        }
        reported_total = reported_total.saturating_add(entry.size());
        if reported_total > limits.max_total_decompressed {
            return Err(ImportError::DecompressedTooLarge);
        }
        if target.is_none() && !entry.is_dir() && basename(&name) == CONVERSATIONS_ENTRY {
            target = Some(index);
        }
    }

    let target = target.ok_or(ImportError::NoConversations)?;

    // 4b — inflate ONLY the target entry, bounding actual bytes read (lying-header
    // defense). No other entry is ever decompressed.
    let entry = archive
        .by_index(target)
        .map_err(|_| ImportError::MalformedArchive)?;
    read_entry_capped(entry, limits.max_total_decompressed)
}

/// Read up to `buf.len()` bytes, tolerating a short archive (fewer than 4 bytes).
fn read_prefix<R: Read>(reader: &mut R, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

/// The final `/`- or `\`-separated component of an entry name.
fn basename(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

// ---- Conversation parsing (shape only — never message text) ----------------

/// The parse of `conversations.json` into shape-only source records + the
/// per-conversation counts the import screen shows.
#[derive(Debug, Default)]
struct ConversationParse {
    records: Vec<SourceRecord>,
    imported: usize,
    skipped: usize,
    failed: usize,
}

/// Turn the decoded `conversations.json` into [`SourceRecord`]s. NEVER reads a
/// message's `text`/`content` — only `sender` (turn kind), the timestamp (UTC-day
/// bucket), and ids (session grouping + assistant dedup). `content: None` on
/// every record, so the extractor cannot count or retain any conversation text.
fn parse_conversations(bytes: &[u8]) -> Result<ConversationParse, ImportError> {
    let root: Value = serde_json::from_slice(bytes).map_err(|_| ImportError::MalformedJson)?;
    // Accept either a bare array or an object with a `conversations` array.
    let conversations = match &root {
        Value::Array(items) => items.as_slice(),
        Value::Object(map) => match map.get("conversations").and_then(Value::as_array) {
            Some(items) => items.as_slice(),
            None => return Err(ImportError::MalformedJson),
        },
        _ => return Err(ImportError::MalformedJson),
    };

    let mut parse = ConversationParse::default();
    for (conv_index, conv) in conversations.iter().enumerate() {
        let Some(obj) = conv.as_object() else {
            // A non-object array element is a malformed entry — counted, never
            // partial-parsed.
            parse.failed += 1;
            continue;
        };
        let session_id = non_empty_str(conv, "uuid")
            .or_else(|| non_empty_str(conv, "name"))
            .map(str::to_string)
            .unwrap_or_else(|| format!("conversation:{conv_index}"));

        let messages = obj.get("chat_messages").and_then(Value::as_array);
        let before = parse.records.len();
        if let Some(messages) = messages {
            for (msg_index, message) in messages.iter().enumerate() {
                push_message_record(&mut parse.records, message, &session_id, msg_index);
            }
        }
        if parse.records.len() > before {
            parse.imported += 1;
        } else {
            // Present but empty / all-unparseable messages: skipped, not failed.
            parse.skipped += 1;
        }
    }
    Ok(parse)
}

/// Fold one chat message into a shape-only [`SourceRecord`], or skip it. Reads
/// only `sender` + `created_at` + the message id — never the message text.
fn push_message_record(
    out: &mut Vec<SourceRecord>,
    message: &Value,
    session_id: &str,
    msg_index: usize,
) {
    let Some(sender) = non_empty_str(message, "sender") else {
        return;
    };
    let kind = match sender {
        "human" => RecordKind::Prompt,
        "assistant" => RecordKind::Assistant,
        // Unknown sender (tool / system): skip rather than guess.
        _ => return,
    };
    let Some(timestamp_ms) = non_empty_str(message, "created_at").and_then(parse_rfc3339_ms) else {
        return;
    };
    // A UNIQUE dedup key per assistant message: the extractor collapses assistant
    // records by dedup_key (last-wins), so a shared/empty key would merge distinct
    // turns into one. Message uuid if present, else a synthetic per-message key.
    let dedup_key = non_empty_str(message, "uuid")
        .map(str::to_string)
        .unwrap_or_else(|| format!("{session_id}:{msg_index}:{timestamp_ms}"));

    out.push(SourceRecord {
        kind,
        session_id: session_id.to_string(),
        timestamp_ms,
        is_sidechain: false,
        dedup_key,
        model: None,
        usage: None,
        // §29: message text is NEVER read into the pipeline.
        content: None,
    });
}

/// A non-empty string field (mirrors the CLI `asString`: empty ⇒ absent).
fn non_empty_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

// ---- Aggregate → usage_summary events --------------------------------------

/// Build the day-aggregate `usage_summary` events from the extractor output,
/// stamped with the resolved subject/attribution and the `claude_export`
/// connector id. Mirrors the live connector's proven wire shape
/// (the `UsageSummaryPayload` in [`crate::sync::batch`]); one event per day, honesty gaps
/// riding the earliest day once. Content-addressed ids ⇒ a re-import of identical
/// data dedups.
fn build_import_events(
    out: &ExtractOutput,
    identity: &LocalIdentity,
    extra_gaps: &[HonestyGap],
) -> Vec<NewEvent> {
    use std::collections::BTreeSet;

    let days: BTreeSet<&str> = out.records.iter().map(|r| r.day.as_str()).collect();
    let all_gaps: Vec<Value> = out
        .gaps
        .iter()
        .chain(extra_gaps.iter())
        .map(gap_json)
        .collect();

    let subject = json!({
        "kind": identity.kind,
        "externalId": identity.external_id,
        "email": identity.email,
        "displayName": identity.display_name,
    });

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

        let digest = hex(&Sha256::digest(payload.to_string().as_bytes()));
        let event_id = format!(
            "{}|{}|{}|import|{}",
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

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Epoch ms for the UTC midnight of a `YYYY-MM-DD` day (the aggregate event's
/// representative `occurred_at`).
fn day_start_ms(day: &str) -> i64 {
    let y: i64 = day.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(1970);
    let m: u32 = day.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: u32 = day.get(8..10).and_then(|s| s.parse().ok()).unwrap_or(1);
    days_from_civil(y, m, d) * 86_400_000
}

/// (year, month, day) → days since the Unix epoch (Howard Hinnant's civil
/// algorithm) — the same formula the extractor + live connector use, so day
/// bucketing never disagrees across the pipeline.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (if m > 2 { m - 3 } else { m + 9 }) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse an RFC-3339 / ISO-8601 UTC timestamp to epoch ms, or `None`. Covers the
/// export's `created_at` format (`YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`); a value
/// it can't read skips the message (like the CLI's `Number.isNaN(Date.parse)`).
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

    let mut rest = &s[19..];
    let mut millis: i64 = 0;
    if let Some(stripped) = rest.strip_prefix('.') {
        let frac_len = stripped.chars().take_while(char::is_ascii_digit).count();
        let frac = &stripped[..frac_len];
        let ms_digits: String = frac.chars().take(3).collect();
        if !ms_digits.is_empty() {
            let scaled = format!("{ms_digits:0<3}");
            millis = scaled.parse().ok()?;
        }
        rest = &stripped[frac_len..];
    }

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

// ---- Temp-workspace RAII (verified cleanup) --------------------------------

/// A scoped temp directory removed on drop. The importer parses in memory and
/// writes nothing here in the happy path, but the guard exists so ANY future
/// disk spill is RAII-cleaned — and so the "no residue after import" guarantee is
/// mechanically testable (spec §11.3.2 "delete temporary extraction files").
struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    fn new(root: &Path) -> Result<Self, ImportError> {
        let unique = format!("revealyst-import-{}", uuid::Uuid::new_v4());
        let path = root.join(unique);
        std::fs::create_dir_all(&path).map_err(|_| ImportError::Io)?;
        Ok(TempWorkspace { path })
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        // Best-effort recursive removal; a failure here must never surface as an
        // import error (the OS reclaims temp on reboot regardless).
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

// ---- Public entry ----------------------------------------------------------

/// Import a Claude data export from `archive_path`: validate + parse it in
/// memory, privacy-gate the day-aggregates, and report the
/// `{imported, skipped, failed}` counts plus the validated projected events.
/// The projection is deliberately NOT enqueued into the shared sync queue (live
/// import→sync is gated on a connector-scoped-ingest ADR — see the module docs).
/// Temp scratch (if any) lives under the system temp dir and is cleaned before
/// return.
pub fn import_archive(
    store: &Store,
    ctx: &ConnectorContext,
    archive_path: &Path,
    now_ms: i64,
) -> Result<ImportOutcome, ImportError> {
    import_archive_with(
        store,
        ctx,
        archive_path,
        &ImportLimits::default(),
        &std::env::temp_dir(),
        now_ms,
    )
}

/// [`import_archive`] with injectable limits + temp root (for tests). The temp
/// root holds the scoped [`TempWorkspace`], removed before this returns.
///
/// The projected events are computed + privacy-validated but NOT enqueued (the
/// connection-scoped window-delete data-loss guard — module docs). `store` is
/// used only to record a content-free quarantine diagnostic on the fail-closed
/// path; nothing is written to the sync queue.
pub fn import_archive_with(
    store: &Store,
    ctx: &ConnectorContext,
    archive_path: &Path,
    limits: &ImportLimits,
    temp_root: &Path,
    now_ms: i64,
) -> Result<ImportOutcome, ImportError> {
    // A blocked policy is a HALT, not a drop: import nothing, surface it so the
    // user can retry once collection is allowed (spec §13.2/§20).
    if let PolicyResolution::Blocked(_) = ctx.policy {
        return Err(ImportError::PolicyBlocked);
    }

    // Scoped temp workspace — RAII-cleaned on every return path below.
    let _workspace = TempWorkspace::new(temp_root)?;

    // Validate + decompress conversations.json ENTIRELY in memory (no extraction).
    let bytes = read_conversations_bytes(archive_path, limits)?;
    let parse = parse_conversations(&bytes)?;

    let identity = resolve_local_identity(ctx);
    // A very wide window so no real day is filtered; the emitted events' days
    // (and thus the sync window) auto-pin to the days actually present.
    //
    // Follow-up (shared extractor, not fixed here): `peak_concurrency` in
    // `crate::extract` is O(sessions²) per day. A large single-day import (many
    // conversations sharing one UTC day) could be slow; the fix belongs in the
    // shared extractor (used by the live connector too), not in this importer.
    let out = extract(
        &parse.records,
        &ExtractOptions {
            subject_external_id: identity.external_id.clone(),
            connector_id: CONNECTOR_ID.to_string(),
            window_start: "0000-01-01".to_string(),
            window_end: "9999-12-31".to_string(),
        },
    );

    // Content-free honesty gaps layered onto the extractor's.
    let mut extra_gaps: Vec<HonestyGap> = Vec::new();
    if parse.skipped > 0 || parse.failed > 0 {
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(format!(
                "import drift: {} conversation(s) skipped (no usable messages), {} unreadable",
                parse.skipped, parse.failed
            )),
        });
    }
    if ctx.shared_device {
        extra_gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(
                "this computer is declared shared; imported activity is attributed to the device, not an individual (spec §10.3)".to_string(),
            ),
        });
    }

    // Step 1 — privacy gate (spec §16.3): every candidate must pass the validator.
    // Imports carry no token/model candidates today, so this is normally a no-op;
    // kept for parity + defense-in-depth (fail closed on any drift).
    let mut would_quarantine = 0usize;
    for candidate in &out.candidate_events {
        if validate(&candidate.payload, &ctx.policy).is_err() {
            would_quarantine += 1;
        }
    }
    if would_quarantine > 0 {
        store.record_diagnostic("candidate_quarantine", "import_projection_drift", now_ms)?;
        return Ok(ImportOutcome {
            imported: parse.imported,
            skipped: parse.skipped,
            failed: parse.failed,
            would_quarantine,
            halted: true,
            projected_events: Vec::new(),
        });
    }

    // Step 2 — PROJECT (do NOT enqueue). The validated day-aggregate events are
    // computed and returned, but they are deliberately never written to the
    // shared sync queue: the server's window-delete is connection-scoped, so
    // enqueuing an import that spans days the live connector also covers would
    // clobber those rows on sync (module docs). Live import→sync is gated on a
    // connector-scoped-ingest ADR; until then this is a pure, side-effect-free
    // projection the caller can inspect.
    let projected_events = build_import_events(&out, &identity, &extra_gaps);

    tracing::info!(
        component = "connector",
        connector = CONNECTOR_ID,
        imported = parse.imported,
        skipped = parse.skipped,
        failed = parse.failed,
        projected = projected_events.len(),
        "claude export import projected (not enqueued — live sync gated)"
    );

    Ok(ImportOutcome {
        imported: parse.imported,
        skipped: parse.skipped,
        failed: parse.failed,
        would_quarantine: 0,
        halted: false,
        projected_events,
    })
}

#[cfg(test)]
mod tests;
