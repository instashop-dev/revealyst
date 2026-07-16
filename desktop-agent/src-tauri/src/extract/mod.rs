//! Local feature extractor — shape + counts ONLY (spec §7; plan T3.4).
//!
//! The extractor turns already-parsed source records (the connector, T5.1, does
//! the file parsing and hands records in) into two things:
//!
//! 1. A **day-aggregate** — the existing canonical metric keys + the 24-slot
//!    UTC-hour histogram + peak concurrency — computed by a pure Rust port of
//!    the CLI reference summarizer (`packages/revealyst-agent/src/summarize.ts`).
//!    A byte-for-byte golden-parity test pins it to the CLI's known-truth
//!    fixture outputs (rule 2).
//! 2. **Candidate queue events** whose payloads carry ONLY currently-allowlisted
//!    `sent: true` fields (the model id + the four token counts + the two
//!    reserved privacy flags). They flow through T3.3's `validate_and_enqueue`
//!    and pass the validator **by construction** — every key is `is_allowed &&
//!    is_sent`, every value a bounded scalar.
//!
//! ## D-DA-5 boundary (shape + counts only)
//!
//! This is the FIRST slice of spec §7 built *without* prompt-text
//! classification. The `LocalPromptFeatures` classifier half —
//! `taskCategory` / `workflowType` / `complexityBand` and the prompt-structure
//! booleans (`hasContext`, …) — is **absent**: no field of the extractor's
//! output carries them, and no code path reads prompt text to infer them. That
//! half is BLOCKED pending decision D-DA-5 (task T5.2). The extractor may
//! briefly hold prompt-like content in-process to derive char/word COUNTS
//! ([`counts::count_text`]), but the content is dropped the instant it is
//! counted — it is never stored in any output type and never enqueued
//! (spec §7.2). No output type has a content/text/prompt field, so a leak is
//! structurally impossible.
//!
//! ## Allowlist-first (law 3)
//!
//! The char/word counts and the shape counts ([`DayCounts`]) are derived and
//! returned for future use, but they are NOT enqueued: `promptCharacterCount`
//! and friends are not yet on `src/lib/agent-collection-schema.ts`. Only the
//! model + token-count keys are `sent: true` today, so only those become
//! candidate events. Adding a new sent key is T5.2 (gated on D-DA-5), out of
//! scope here — the extractor never invents a wire field.

pub mod counts;

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::json;

use crate::store::queue::NewEvent;

/// The kind of a parsed source record — mirrors the CLI parser's `ParsedEvent`
/// discriminant (`packages/revealyst-agent/src/parse.ts`), the privacy line
/// where denylisted fields were already never read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordKind {
    /// A model reply carrying usage numbers + a model id.
    Assistant,
    /// A human prompt turn.
    Prompt,
    /// Non-prompt activity (tool result, attachment, system line, sidechain).
    Activity,
}

/// Token counts for one assistant turn (mirrors the CLI `UsageNumbers`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UsageNumbers {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

/// One already-parsed source record handed to the extractor by the connector
/// (T5.1). This is a bounded struct the connector POPULATES from a parsed
/// vendor line — the extractor never reads files itself.
///
/// `content` is the OPTIONAL in-process prompt-like text the connector already
/// has in hand. The extractor streams over it to derive char/word counts and
/// then drops it (spec §7.2, D-DA-5): it is never stored in any output and
/// never enqueued. `None` means "shape only" — the extractor still counts
/// everything derivable from the record's structure.
#[derive(Debug, Clone)]
pub struct SourceRecord {
    pub kind: RecordKind,
    pub session_id: String,
    /// When the underlying activity occurred (epoch ms, UTC).
    pub timestamp_ms: i64,
    pub is_sidechain: bool,
    /// Dedup key for streamed assistant lines (requestId ?? message.id ?? uuid
    /// ?? synthetic) — last-wins collapse, as the final streamed line restates
    /// cumulative usage.
    pub dedup_key: String,
    /// Model id (assistant records only). Sanitized defensively before use.
    pub model: Option<String>,
    /// Token counts (assistant records only).
    pub usage: Option<UsageNumbers>,
    /// In-process only: prompt-like text, counted then dropped. Never stored,
    /// never forwarded.
    pub content: Option<String>,
}

/// Caller context for one extraction pass.
#[derive(Debug, Clone)]
pub struct ExtractOptions {
    /// Stable subject identity (e.g. the paired person's external id). Enters
    /// only the bounded, deterministic `event_id` (a routing key the server
    /// dedups on) / subject identity — never a content payload field.
    pub subject_external_id: String,
    /// Owning connector id (e.g. `claude_code`).
    pub connector_id: String,
    /// Inclusive UTC calendar-day window (`YYYY-MM-DD`); records outside are
    /// ignored (no silent backfill leak).
    pub window_start: String,
    pub window_end: String,
}

/// The canonical metric keys the summarizer emits — identical set to the CLI's
/// `AgentMetricKey`. Serializes to the same snake_case wire strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricKey {
    ActiveDay,
    Sessions,
    Prompts,
    TokensInput,
    TokensOutput,
    TokensCacheRead,
    TokensCacheWrite,
    SpendCentsEstimated,
    ModelRequests,
    ModelTokens,
}

impl MetricKey {
    /// The canonical snake_case wire key (same string as the serde form and the
    /// CLI's `AgentMetricKey`).
    pub fn as_str(&self) -> &'static str {
        match self {
            MetricKey::ActiveDay => "active_day",
            MetricKey::Sessions => "sessions",
            MetricKey::Prompts => "prompts",
            MetricKey::TokensInput => "tokens_input",
            MetricKey::TokensOutput => "tokens_output",
            MetricKey::TokensCacheRead => "tokens_cache_read",
            MetricKey::TokensCacheWrite => "tokens_cache_write",
            MetricKey::SpendCentsEstimated => "spend_cents_estimated",
            MetricKey::ModelRequests => "model_requests",
            MetricKey::ModelTokens => "model_tokens",
        }
    }
}

/// One day-aggregate metric record (mirrors the CLI `MetricRecordInput` minus
/// the caller-supplied subject/attribution, which are stamped downstream).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricRecord {
    pub metric_key: MetricKey,
    /// UTC calendar day, `YYYY-MM-DD`.
    pub day: String,
    /// `""` or `"model=<id>"`.
    pub dim: String,
    pub value: f64,
}

/// One day's sub-daily signal — the 24-slot UTC-hour histogram + real
/// peak-concurrency (mirrors the CLI `SubjectDaySignalInput`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DaySignal {
    pub day: String,
    /// Event counts per UTC hour, 24 slots.
    pub hours: [u32; 24],
    /// Max number of session intervals overlapping at any instant.
    pub peak_concurrency: u32,
    pub source_granularity: &'static str,
}

/// One day's shape + counts features (the D-DA-5 counts half of
/// `LocalPromptFeatures`). NUMBERS ONLY — the classifier fields
/// (`taskCategory` / `workflowType` / `complexityBand` / `has*`) are absent by
/// design. Returned for future use (T5.2); NOT enqueued today (its keys are not
/// yet on the collection allowlist).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct DayCounts {
    pub day: String,
    /// Summed character count of prompt content seen this day (streamed, then
    /// the content was dropped).
    pub prompt_character_count: u64,
    /// Summed word count of prompt content seen this day.
    pub prompt_word_count: u64,
    /// Deduped assistant turns this day.
    pub assistant_turn_count: u64,
    /// Non-prompt activity records this day (tool results, attachments, …).
    pub tool_activity_count: u64,
}

/// The kind of an honesty gap — the same closed set the CLI emits (mirrors the
/// frozen `HonestyGap["kind"]` union in `packages/revealyst-agent/src/types.ts`
/// / `src/contracts`). Serializes to the same snake_case wire strings so T5.1
/// can route these straight into `AgentIngestRequest.gaps[]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GapKind {
    OauthActorsMissing,
    TelemetryOnlyUsersInTotals,
    SharedKeyNotPersonLevel,
    ServiceAccountsUnresolved,
    SubDailyUnavailable,
    SyncWindowIncomplete,
    Other,
}

/// A single honesty disclosure attached to a day-aggregate (mirrors the CLI
/// `HonestyGap`). Invariant-(b): a claim surface must carry its own caveats — a
/// spend ESTIMATE ships with the "list prices, not invoices" disclosure, never
/// silently as if it were exact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HonestyGap {
    pub kind: GapKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The extractor's full output.
#[derive(Debug, Clone, Default)]
pub struct ExtractOutput {
    /// Day-aggregate metric records (CLI summarize parity). This is the internal
    /// aggregate; it rides the `AgentIngestRequest` wire shape wired by
    /// T4.1/T5.1, NOT the per-field queue payload.
    pub records: Vec<MetricRecord>,
    /// Per-day sub-daily signals.
    pub signals: Vec<DaySignal>,
    /// Per-day shape + counts features (classifier fields absent — D-DA-5).
    pub counts: Vec<DayCounts>,
    /// Candidate queue events: payloads restricted to allowlisted `sent: true`
    /// keys. Pass `validate_and_enqueue` by construction.
    pub candidate_events: Vec<NewEvent>,
    /// Honesty disclosures for the aggregate (mirrors the CLI `summarize` gaps).
    /// T5.1 routes these into `AgentIngestRequest.gaps[]` — the spend-estimate
    /// disclosure must never be dropped between the extractor and the wire, or
    /// the server would present an estimate as if it were an exact figure.
    pub gaps: Vec<HonestyGap>,
}

// ---- Pricing (list-price spend estimate; port of prices.ts) -----------------

/// Cents per 1M tokens for one model tier (mirrors the CLI `ModelRates`).
#[derive(Clone, Copy)]
struct ModelRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

const OPUS: ModelRates = ModelRates {
    input: 1_500.0,
    output: 7_500.0,
    cache_write: 1_875.0,
    cache_read: 150.0,
};
const SONNET: ModelRates = ModelRates {
    input: 300.0,
    output: 1_500.0,
    cache_write: 375.0,
    cache_read: 30.0,
};
const HAIKU: ModelRates = ModelRates {
    input: 100.0,
    output: 500.0,
    cache_write: 125.0,
    cache_read: 10.0,
};

/// Ordered substring table — first match wins; unknown models fall back to the
/// most expensive tier (estimates err high). Identical to the CLI `RATE_TABLE`.
const RATE_TABLE: [(&str, ModelRates); 5] = [
    ("opus", OPUS),
    ("fable", OPUS),
    ("mythos", OPUS),
    ("sonnet", SONNET),
    ("haiku", HAIKU),
];

/// Returns the model's rates plus whether it was a KNOWN tier. Unknown models
/// fall back to the most expensive tier (estimates err high) and set
/// `known = false`, so the caller can disclose the high-defaulted estimate —
/// mirrors the CLI `ratesForModel` `{ rates, known }`.
fn rates_for_model(model: &str) -> (ModelRates, bool) {
    let lower = model.to_lowercase();
    for (needle, rates) in RATE_TABLE {
        if lower.contains(needle) {
            return (rates, true);
        }
    }
    (OPUS, false)
}

fn estimate_cents(rates: ModelRates, usage: UsageNumbers) -> f64 {
    (usage.input as f64 * rates.input
        + usage.output as f64 * rates.output
        + usage.cache_write as f64 * rates.cache_write
        + usage.cache_read as f64 * rates.cache_read)
        / 1_000_000.0
}

// ---- UTC calendar helpers (no chrono dependency) ----------------------------

/// Days since the Unix epoch → (year, month, day), civil calendar
/// (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Epoch ms → `YYYY-MM-DD` (UTC). One formatter, so day-window pinning and
/// aggregation bucket identically (mirrors the CLI's `utcDay`).
fn utc_day(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Epoch ms → hour-of-day (UTC), 0..=23.
fn utc_hour(ms: i64) -> usize {
    let sod = ms.div_euclid(1000).rem_euclid(86_400);
    (sod / 3_600) as usize
}

/// Epoch ms floored to UTC midnight — the representative instant for a
/// day-aggregate event's `occurred_at`.
fn day_start_ms(ms: i64) -> i64 {
    ms.div_euclid(86_400_000) * 86_400_000
}

// ---- Aggregation ------------------------------------------------------------

#[derive(Default)]
struct DayAgg {
    day_start_ms: i64,
    usage: UsageNumbers,
    spend_cents: f64,
    prompts: u64,
    assistant_turns: u64,
    tool_activity: u64,
    prompt_chars: u64,
    prompt_words: u64,
    /// Human sessions only (isSidechain:false) — the §5 sessions metric.
    human_sessions: BTreeSet<String>,
    /// Every session's active interval this day (incl. sidechains) — feeds true
    /// concurrency.
    session_intervals: BTreeMap<String, (i64, i64)>,
    model_requests: BTreeMap<String, u64>,
    model_tokens: BTreeMap<String, u64>,
    /// Per-model summed usage — feeds the allowlisted candidate payloads.
    model_usage: BTreeMap<String, UsageNumbers>,
    hours: [u32; 24],
}

/// Peak simultaneous sessions: the max number of inclusive `[min,max]`
/// intervals overlapping at any instant (which always occurs at some interval's
/// start). Real temporal overlap, not an hourly bucket count — identical to the
/// CLI `peakConcurrency`.
fn peak_concurrency(intervals: &[(i64, i64)]) -> u32 {
    let mut peak = 0u32;
    for &(a_min, _) in intervals {
        let mut count = 0u32;
        for &(b_min, b_max) in intervals {
            if b_min <= a_min && a_min <= b_max {
                count += 1;
            }
        }
        if count > peak {
            peak = count;
        }
    }
    peak
}

/// Fold one deduped source event into its day-aggregate. Out-of-window events
/// are ignored (no silent backfill leak). Prompt-like content is streamed for a
/// char/word count and then dropped — never stored (spec §7.2, D-DA-5). Models
/// that miss the price table are recorded in `unknown_models` so the caller can
/// disclose the high-defaulted spend estimate (mirrors the CLI's `unknownModels`
/// set).
fn accumulate(
    days: &mut BTreeMap<String, DayAgg>,
    unknown_models: &mut BTreeSet<String>,
    opts: &ExtractOptions,
    event: &SourceRecord,
) {
    let day = utc_day(event.timestamp_ms);
    if !(opts.window_start.as_str()..=opts.window_end.as_str()).contains(&day.as_str()) {
        return;
    }
    let agg = days.entry(day).or_default();
    agg.day_start_ms = day_start_ms(event.timestamp_ms);

    agg.hours[utc_hour(event.timestamp_ms)] += 1;
    if !event.is_sidechain {
        agg.human_sessions.insert(event.session_id.clone());
    }
    agg.session_intervals
        .entry(event.session_id.clone())
        .and_modify(|iv| {
            iv.0 = iv.0.min(event.timestamp_ms);
            iv.1 = iv.1.max(event.timestamp_ms);
        })
        .or_insert((event.timestamp_ms, event.timestamp_ms));

    match event.kind {
        RecordKind::Prompt => {
            agg.prompts += 1;
            if let Some(text) = event.content.as_deref() {
                let tc = counts::count_text(text);
                agg.prompt_chars += tc.character_count;
                agg.prompt_words += tc.word_count;
            }
        }
        RecordKind::Activity => {
            agg.tool_activity += 1;
        }
        RecordKind::Assistant => {
            agg.assistant_turns += 1;
            if let Some(usage) = event.usage {
                agg.usage.input += usage.input;
                agg.usage.output += usage.output;
                agg.usage.cache_read += usage.cache_read;
                agg.usage.cache_write += usage.cache_write;

                let model = counts::sanitize_model(event.model.as_deref());
                let (rates, known) = rates_for_model(&model);
                if !known {
                    unknown_models.insert(model.clone());
                }
                agg.spend_cents += estimate_cents(rates, usage);
                *agg.model_requests.entry(model.clone()).or_insert(0) += 1;
                *agg.model_tokens.entry(model.clone()).or_insert(0) += usage.input + usage.output;
                let mu = agg.model_usage.entry(model).or_default();
                mu.input += usage.input;
                mu.output += usage.output;
                mu.cache_read += usage.cache_read;
                mu.cache_write += usage.cache_write;
            }
        }
    }
}

/// Extract day-aggregates + candidate events from parsed source records. Pure
/// and deterministic over `records`; no I/O, no clock (the window comes from the
/// caller). Content is read only to count and is never retained.
pub fn extract(records: &[SourceRecord], opts: &ExtractOptions) -> ExtractOutput {
    // Pass 1 — collapse streamed assistant lines to ONE per dedup key,
    // last-wins (the final line carries cumulative usage). Non-assistant events
    // pass through unchanged, so histograms and session presence never
    // double-count a streamed turn.
    let mut assistant_by_key: BTreeMap<&str, &SourceRecord> = BTreeMap::new();
    let mut others: Vec<&SourceRecord> = Vec::new();
    for r in records {
        match r.kind {
            RecordKind::Assistant => {
                assistant_by_key.insert(r.dedup_key.as_str(), r); // last-wins
            }
            _ => others.push(r),
        }
    }

    let mut days: BTreeMap<String, DayAgg> = BTreeMap::new();
    let mut unknown_models: BTreeSet<String> = BTreeSet::new();
    for event in others {
        accumulate(&mut days, &mut unknown_models, opts, event);
    }
    for event in assistant_by_key.values().copied() {
        accumulate(&mut days, &mut unknown_models, opts, event);
    }

    // Emit in the CLI's deterministic order: days sorted (BTreeMap), the eight
    // flat metrics in a fixed order, then model dims sorted by model.
    let mut out = ExtractOutput::default();
    for (day, agg) in &days {
        let flat: [(MetricKey, f64); 8] = [
            (MetricKey::ActiveDay, 1.0),
            (MetricKey::Sessions, agg.human_sessions.len() as f64),
            (MetricKey::Prompts, agg.prompts as f64),
            (MetricKey::TokensInput, agg.usage.input as f64),
            (MetricKey::TokensOutput, agg.usage.output as f64),
            (MetricKey::TokensCacheRead, agg.usage.cache_read as f64),
            (MetricKey::TokensCacheWrite, agg.usage.cache_write as f64),
            (
                MetricKey::SpendCentsEstimated,
                (agg.spend_cents * 100.0).round() / 100.0,
            ),
        ];
        for (metric_key, value) in flat {
            out.records.push(MetricRecord {
                metric_key,
                day: day.clone(),
                dim: String::new(),
                value,
            });
        }
        for (model, count) in &agg.model_requests {
            out.records.push(MetricRecord {
                metric_key: MetricKey::ModelRequests,
                day: day.clone(),
                dim: format!("model={model}"),
                value: *count as f64,
            });
        }
        for (model, tokens) in &agg.model_tokens {
            out.records.push(MetricRecord {
                metric_key: MetricKey::ModelTokens,
                day: day.clone(),
                dim: format!("model={model}"),
                value: *tokens as f64,
            });
        }

        let intervals: Vec<(i64, i64)> = agg.session_intervals.values().copied().collect();
        out.signals.push(DaySignal {
            day: day.clone(),
            hours: agg.hours,
            peak_concurrency: peak_concurrency(&intervals),
            source_granularity: "event",
        });

        out.counts.push(DayCounts {
            day: day.clone(),
            prompt_character_count: agg.prompt_chars,
            prompt_word_count: agg.prompt_words,
            assistant_turn_count: agg.assistant_turns,
            tool_activity_count: agg.tool_activity,
        });

        // Candidate queue events — one per (day, model), payload restricted to
        // allowlisted `sent: true` keys. `model` is already sanitized to the
        // safe ASCII charset; the token counts are numbers; the reserved flags
        // are `false`. So each passes T3.3's validator by construction.
        for (model, usage) in &agg.model_usage {
            let event_id = format!(
                "{}|{}|{}|usage|model={}",
                opts.connector_id, opts.subject_external_id, day, model
            );
            let payload = json!({
                "model": model,
                "usage.input_tokens": usage.input,
                "usage.output_tokens": usage.output,
                "usage.cache_read_input_tokens": usage.cache_read,
                "usage.cache_creation_input_tokens": usage.cache_write,
                "rawPromptIncluded": false,
                "rawResponseIncluded": false,
            });
            out.candidate_events.push(NewEvent::analytics_only(
                event_id,
                opts.connector_id.clone(),
                "usage_summary",
                agg.day_start_ms,
                payload,
            ));
        }
    }

    // Honesty gaps (mirror `summarize.ts`): whenever a `spend_cents_estimated`
    // record is emitted (i.e. any day aggregated), ship its "estimate, not
    // invoice" disclosure — invariant-(b), the caveat travels WITH the claim.
    // Plus the unknown-model-defaulted-high warning when any model missed the
    // price table (up to five, sorted). T5.1 routes these into
    // `AgentIngestRequest.gaps[]`.
    if !days.is_empty() {
        out.gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some("spend_cents_estimated uses public list prices, not invoices".to_string()),
        });
    }
    if !unknown_models.is_empty() {
        let listed: Vec<&str> = unknown_models.iter().take(5).map(String::as_str).collect();
        out.gaps.push(HonestyGap {
            kind: GapKind::Other,
            detail: Some(format!(
                "unknown model rates defaulted high: {}",
                listed.join(", ")
            )),
        });
    }

    out
}

#[cfg(test)]
mod tests;
