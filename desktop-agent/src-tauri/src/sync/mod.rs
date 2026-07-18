//! The sync engine (spec §14; Desktop Agent plan T4.1).
//!
//! Drains the encrypted queue ([`crate::store`]) into day-aggregate batches and
//! uploads them to the EXISTING `POST /api/agent/ingest` endpoint (D-DA-3 — no
//! new per-event endpoint). It owns spec §14's client concerns: batch caps +
//! gzip ([`batch`]), the retry taxonomy + backoff ([`retry`]), bisect-splitting
//! on 413/422, single-in-flight upload, and crash-safe receipt idempotency.
//!
//! ## What this module does NOT do
//!
//! - It does not run a live timer/loop. Collection (collect → extract →
//!   validate → enqueue) is T3.4/T5.1; there is nothing to sync until M5 wires
//!   a connector, so [`crate::run`] deliberately does not start a loop yet. The
//!   engine is exposed as callable ([`SyncEngine::sync`]/[`SyncEngine::sync_once`])
//!   and fully unit-tested against a mock transport.
//! - It never computes team/capability scores (that is the backend's job) and
//!   never reads raw content — the queue is already Analytics-Only by shape.
//!
//! ## Crash-safe idempotency (spec §14.1 / §15)
//!
//! At-least-once delivery with SERVER-side idempotency (never claim
//! exactly-once). The server dedups on the frozen metric natural keys + the
//! delete-then-upsert window ("a push is authoritative for its window"), so
//! re-sending an identical batch after a mid-sync crash cannot double-count.
//! On the client the ordering mirrors queue-before-checkpoint:
//!
//! 1. Events are durable in the queue FIRST (guaranteed by
//!    [`crate::store::Store::enqueue_and_checkpoint`], upstream of here).
//! 2. On a confirmed 2xx: record an `upload_receipt`, THEN `purge_events`.
//! 3. A crash between the 2xx and the receipt → on restart the same events are
//!    still queued → the deterministic, content-addressed `batch_id` recurs →
//!    the batch is re-sent → the server dedups (safe duplicate, never loss).
//! 4. A crash between the receipt and the purge → on restart the receipt is
//!    found → the batch is purged WITHOUT re-uploading.
//!
//! The one ordering that could lose data — purging before a confirmed 2xx — is
//! structurally impossible: `purge_events` runs only in the `Accepted` arm.

pub mod batch;
pub mod retry;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::state::StateInputs;
use crate::store::queue::now_ms;
use crate::store::{Store, StoreError};

use batch::{
    build_request, distinct_day_count, prepare_batch, split_events_by_day,
    wire_source_for_connector, MAX_COMPRESSED_BYTES, MAX_EVENTS_PER_BATCH, SUMMARIZER_VERSION,
};
use retry::{classify_status, HttpDisposition, RetryPolicy};

/// Per-request upload timeout (spec §14.3).
pub const REQUEST_TIMEOUT_SECS: u64 = 10;

// --- Transport seam (mockable in tests, reqwest in production) --------------

/// A transport-layer failure — always network-class (the server was never
/// reached), so all three retry with backoff and, on exhaustion, resolve to
/// `offline`. Kept as three variants for honest logging only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportError {
    Timeout,
    ConnectionReset,
    Network,
}

/// One ingest POST. Deliberately NOT `Debug`/`Serialize`: `bearer` is the
/// device token and must never be formatted into a log line (spec §23.1).
pub struct TransportRequest<'a> {
    pub url: &'a str,
    pub bearer: &'a str,
    pub gzip_body: &'a [u8],
}

/// A server response the engine classifies via [`classify_status`].
#[derive(Debug, Clone)]
pub struct TransportResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The HTTP seam. Static-dispatched (`SyncEngine<T>`) so a mock injects scripted
/// responses without a network and the native async fn needs no `dyn` support.
#[allow(async_fn_in_trait)]
pub trait IngestTransport {
    async fn post(
        &self,
        request: TransportRequest<'_>,
    ) -> Result<TransportResponse, TransportError>;
}

/// Production transport over a reused rustls `reqwest::Client` (connection
/// pooling for a long-lived desktop process). Never exercised by unit tests
/// (no network on the Windows dev machine) — CI compiles it.
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Self {
        ReqwestTransport {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl IngestTransport for ReqwestTransport {
    async fn post(
        &self,
        request: TransportRequest<'_>,
    ) -> Result<TransportResponse, TransportError> {
        let result = self
            .client
            .post(request.url)
            .header("Authorization", format!("Bearer {}", request.bearer))
            .header("Content-Type", "application/json")
            .header("Content-Encoding", "gzip")
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .body(request.gzip_body.to_vec())
            .send()
            .await;

        match result {
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response
                    .bytes()
                    .await
                    .map(|b| b.to_vec())
                    .unwrap_or_default();
                Ok(TransportResponse { status, body })
            }
            Err(error) if error.is_timeout() => Err(TransportError::Timeout),
            Err(error) if error.is_connect() => Err(TransportError::ConnectionReset),
            Err(_) => Err(TransportError::Network),
        }
    }
}

// --- Outcome + state mapping ------------------------------------------------

/// The result of a sync attempt, mapped onto the spec §20 state machine by
/// [`SyncOutcome::apply`]. Deliberately never fabricates `Healthy` — that is
/// only returned when a batch actually uploaded (or the queue was empty).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncOutcome {
    /// A batch uploaded and was accepted (or nothing needed sending after a
    /// receipt short-circuit). Clears the sync-owned problem flags.
    Healthy,
    /// The queue was empty — nothing to do. No problem, no fabricated success.
    Idle,
    /// A sync was already in flight; this call did nothing (single-in-flight,
    /// spec §14.3). Leaves state untouched.
    Busy,
    /// The server was unreachable; events remain queued for the next attempt.
    Offline,
    /// The device was revoked (401) or paused (403) — re-authentication needed.
    AuthenticationRequired,
    /// The server was reachable but rejected/failed the batch (exhausted
    /// transient retries, a fatal 400/409, or a quarantined poison event).
    /// Events remain queued unless individually quarantined.
    Degraded,
}

impl SyncOutcome {
    fn rank(self) -> u8 {
        match self {
            SyncOutcome::Idle | SyncOutcome::Busy | SyncOutcome::Healthy => 0,
            SyncOutcome::Degraded => 1,
            SyncOutcome::Offline => 2,
            SyncOutcome::AuthenticationRequired => 3,
        }
    }

    /// Keep the more severe of two outcomes (used while draining split chunks).
    fn worsen(self, other: SyncOutcome) -> SyncOutcome {
        if other.rank() > self.rank() {
            other
        } else {
            self
        }
    }

    /// Fold this outcome into the state-machine inputs. Sync owns three condition
    /// flags, with two different lifetimes:
    ///
    /// - `offline` / `authentication_required` are FRESH per attempt — each
    ///   outcome sets exactly the relevant one and clears the other.
    /// - `degraded` is STICKY (M1): it flags a real drop — a quarantined poison
    ///   event, or a dropped undecodable batch — whose only visible trace is this
    ///   flag. It is set by `Degraded` and cleared ONLY by a genuinely successful
    ///   `Healthy` sync. An `Idle` cycle (empty queue) must NOT clear it, or a
    ///   permanent data drop's only signal would vanish the moment the queue
    ///   empties.
    ///
    /// `Idle`/`Busy` make no upload attempt, so they leave every flag standing.
    /// Other flags (`paused`, `policy_blocked`, …) belong to other subsystems and
    /// are never touched here.
    pub fn apply(&self, inputs: &mut StateInputs) {
        match self {
            // No upload attempt — never clear a standing condition (esp. a
            // sticky `degraded`, M1).
            SyncOutcome::Idle | SyncOutcome::Busy => {}
            SyncOutcome::Healthy => {
                // The only thing that clears the sticky drop signal.
                inputs.offline = false;
                inputs.authentication_required = false;
                inputs.degraded = false;
            }
            SyncOutcome::Offline => {
                inputs.offline = true;
                inputs.authentication_required = false;
                // `degraded` is sticky — left as-is.
            }
            SyncOutcome::AuthenticationRequired => {
                inputs.authentication_required = true;
                inputs.offline = false;
            }
            SyncOutcome::Degraded => {
                inputs.degraded = true;
                inputs.offline = false;
                inputs.authentication_required = false;
            }
        }
    }
}

/// The result of uploading ONE prepared batch (before split handling).
enum UploadResult {
    Accepted,
    SplitBisect,
    AuthRequired,
    Offline,
    Degraded,
}

// --- The engine -------------------------------------------------------------

/// The sync engine. Generic over the transport so tests inject a mock. Holds no
/// `Store` — the caller passes it in, keeping the engine store-agnostic and the
/// single-in-flight guard local to the engine instance (one per installation).
pub struct SyncEngine<T: IngestTransport> {
    transport: T,
    retry: RetryPolicy,
    ingest_url: String,
    agent_version: String,
    in_flight: AtomicBool,
    /// Token rotation (T7.2, ADR 0058). `refresh_url` empty → rotation disabled
    /// (the test/injection path), so `sync()` sends the device token directly.
    refresh_url: String,
    /// In-memory access-token cache (never persisted, never logged).
    access_cache: crate::token::AccessTokenCache,
}

impl SyncEngine<ReqwestTransport> {
    /// Production engine: reqwest transport, shipped retry policy, ingest +
    /// refresh URLs derived from the configured app origin (env override, else
    /// the shipped default — see [`crate::auth::app_origin`]).
    pub fn new() -> Self {
        let origin = crate::auth::app_origin();
        SyncEngine {
            transport: ReqwestTransport::new(),
            retry: RetryPolicy::production(),
            ingest_url: format!("{origin}/api/agent/ingest"),
            agent_version: crate::agent_version().to_string(),
            in_flight: AtomicBool::new(false),
            refresh_url: format!("{origin}/api/desktop/auth/refresh"),
            access_cache: crate::token::AccessTokenCache::new(),
        }
    }
}

impl Default for SyncEngine<ReqwestTransport> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: IngestTransport> SyncEngine<T> {
    /// Test/injection constructor.
    #[cfg(test)]
    pub fn with_transport(
        transport: T,
        retry: RetryPolicy,
        ingest_url: String,
        agent_version: String,
    ) -> Self {
        SyncEngine {
            transport,
            retry,
            ingest_url,
            agent_version,
            in_flight: AtomicBool::new(false),
            // Tests drive `sync_once` with an explicit bearer and never exercise
            // refresh; an empty refresh_url keeps rotation out of their path.
            refresh_url: String::new(),
            access_cache: crate::token::AccessTokenCache::new(),
        }
    }

    /// Production entry: read the device token from the OS keychain and drain
    /// one flush cycle. No token stored → `authentication_required` (not signed
    /// in). The token is read here and passed by reference; it is never logged.
    pub async fn sync(&self, store: &Store) -> Result<SyncOutcome, StoreError> {
        let device_token = match crate::secrets::get_token() {
            Ok(Some(token)) => token,
            Ok(None) => return Ok(SyncOutcome::AuthenticationRequired),
            Err(_) => return Ok(SyncOutcome::AuthenticationRequired),
        };
        // Token rotation (T7.2, ADR 0058): send a short-lived access token when
        // we can mint one, falling back to the device token if `/refresh` is
        // unavailable (old/not-configured server, or offline). The device token
        // itself never leaves the keychain except to hit `/refresh`.
        let bearer = crate::token::bearer_for(
            &self.access_cache,
            &crate::token::ReqwestRefreshTransport,
            &self.refresh_url,
            &device_token,
            crate::store::queue::now_ms(),
        )
        .await;
        self.sync_once(store, &bearer).await
    }

    /// Drain one flush cycle: dequeue up to [`MAX_EVENTS_PER_BATCH`], build a
    /// day-aggregate batch, and upload it (with retry + bisect-split). A live
    /// loop (M5) calls this repeatedly until the queue is empty; here it is the
    /// unit of work. Enforces single-in-flight per installation.
    pub async fn sync_once(&self, store: &Store, bearer: &str) -> Result<SyncOutcome, StoreError> {
        let Some(_guard) = InFlightGuard::acquire(&self.in_flight) else {
            return Ok(SyncOutcome::Busy);
        };

        let events = store.dequeue_batch(MAX_EVENTS_PER_BATCH)?;
        if events.is_empty() {
            return Ok(SyncOutcome::Idle);
        }

        // Group the drained events by their local `connector_id` so every
        // uploaded batch is SINGLE-SOURCE (ADR 0060). The server composes one
        // `source_connector` per batch and window-deletes only that source's
        // rows, so a `claude_export` import can no longer clobber the live
        // `claude_code` connector's overlapping days (D-DA-8). Groups are
        // formed in first-seen order for a deterministic upload sequence; each
        // group carries a disjoint set of events (a day may appear in two
        // groups from two sources — that is exactly the point, and the two
        // land as distinct source rows).
        // Seed at Healthy: every group is non-empty (one per connector_id with
        // ≥1 event), so `flush` never returns Idle here — it returns Healthy on
        // a clean upload and worsens only on a real problem.
        let mut worst = SyncOutcome::Healthy;
        for (connector_id, group) in group_by_connector(events) {
            let source = wire_source_for_connector(&connector_id);
            let outcome = self.flush(store, bearer, source, group).await?;
            worst = worst.worsen(outcome);
            // A revoked/paused device or a dead network stops the whole cycle;
            // the remaining groups stay queued for the next attempt.
            if matches!(
                outcome,
                SyncOutcome::AuthenticationRequired | SyncOutcome::Offline
            ) {
                break;
            }
        }
        tracing::info!(
            component = "sync",
            outcome = outcome_code(worst),
            "flush cycle complete"
        );
        Ok(worst)
    }

    /// Upload `events`, DAY-splitting on oversize / 413 / 422 so every sub-batch
    /// covers a disjoint set of whole days (P0 — see the `batch` module's
    /// day-window-authoritative invariant). Returns the most severe outcome
    /// across all chunks. Uses an explicit work stack rather than async recursion
    /// (which would need boxing).
    async fn flush(
        &self,
        store: &Store,
        bearer: &str,
        source: &str,
        events: Vec<crate::store::queue::PendingEvent>,
    ) -> Result<SyncOutcome, StoreError> {
        let mut worst = SyncOutcome::Healthy;
        let mut stack: Vec<Vec<crate::store::queue::PendingEvent>> = vec![events];

        while let Some(chunk) = stack.pop() {
            if chunk.is_empty() {
                continue;
            }

            let request = build_request(&self.agent_version, SUMMARIZER_VERSION, source, &chunk);

            // M2: never upload a batch with nothing to persist. Such a body would
            // either delete-then-upsert-nothing (an empty summary with a real
            // day → data loss) or carry `window.start = ""` (all-undecodable → a
            // poison 400 retried forever). Skip the POST and purge the events so
            // the queue can't wedge. If the batch carried gaps (events were
            // skipped/undecodable), that is a real drop — surface it as degraded.
            if request.records.is_empty() && request.signals.is_empty() {
                let ids: Vec<i64> = chunk.iter().map(|e| e.id).collect();
                store.purge_events(&ids)?;
                if !request.gaps.is_empty() {
                    tracing::warn!(
                        component = "sync",
                        error_code = "empty_batch_dropped",
                        "dropped a batch with no persistable rows (skipped/undecodable events)"
                    );
                    worst = worst.worsen(SyncOutcome::Degraded);
                }
                continue;
            }

            let prepared = prepare_batch(request, &chunk)?;

            // Proactive size cap (spec §14.3): a body over 1 MB compressed is
            // DAY-split before upload (never count-split — that overlaps
            // windows). A single day too big to fit is sent whole (can't be split
            // without corrupting the window); Phase 1 never reaches this.
            if prepared.gzip_body.len() > MAX_COMPRESSED_BYTES {
                if distinct_day_count(&chunk) > 1 {
                    let (left, right) = split_events_by_day(chunk);
                    stack.push(left);
                    stack.push(right);
                    continue;
                }
                tracing::warn!(
                    component = "sync",
                    error_code = "oversized_single_day",
                    "sending a single day that exceeds the size cap whole (cannot split without overlapping windows)"
                );
            }

            // Crash-safe short-circuit: a receipt for this exact batch means a
            // prior run already uploaded it (crash after 2xx, before purge) —
            // purge without re-sending.
            if store.has_receipt(&prepared.batch_id)? {
                store.purge_events(&prepared.event_ids)?;
                continue;
            }

            match self.upload(bearer, &prepared.gzip_body).await {
                UploadResult::Accepted => {
                    // Receipt BEFORE purge (queue-before-receipt ordering). A 2xx
                    // is authoritative for the submitted window regardless of the
                    // reported counts — trust it and purge every sent event
                    // (server idempotency covers anything re-sent). This is the
                    // honest handling of "partial acceptance": the endpoint is
                    // transactional, so a 2xx accepted the whole batch.
                    store.record_receipt(
                        &prepared.batch_id,
                        prepared.event_ids.len() as i64,
                        "accepted",
                        now_ms(),
                    )?;
                    store.purge_events(&prepared.event_ids)?;
                }
                UploadResult::SplitBisect => {
                    if distinct_day_count(&chunk) > 1 {
                        // Bisect on a DAY boundary so the halves keep disjoint
                        // windows (P0).
                        let (left, right) = split_events_by_day(chunk);
                        stack.push(left);
                        stack.push(right);
                    } else {
                        // A SINGLE day the server rejects (413/422) cannot be
                        // split without overlapping windows. Quarantine the whole
                        // day so it never wedges the queue behind a poison pill,
                        // and mark degraded. Loud, never silent. (Phase 1: a day
                        // is ~one event.)
                        tracing::warn!(
                            component = "sync",
                            error_code = "day_quarantined",
                            "dropping a single day the server rejected (413/422)"
                        );
                        store.purge_events(&prepared.event_ids)?;
                        worst = worst.worsen(SyncOutcome::Degraded);
                    }
                }
                UploadResult::AuthRequired => {
                    // Revoked/paused: stop the whole cycle immediately; leave all
                    // remaining events queued for after re-auth.
                    return Ok(SyncOutcome::AuthenticationRequired);
                }
                UploadResult::Offline => {
                    // Network is down: stop; leave everything queued.
                    return Ok(SyncOutcome::Offline);
                }
                UploadResult::Degraded => {
                    // Fatal/exhausted for this chunk; leave it queued, keep
                    // draining the others, and remember the degradation.
                    worst = worst.worsen(SyncOutcome::Degraded);
                }
            }
        }

        Ok(worst)
    }

    /// Upload ONE prepared body with the retry taxonomy + backoff. Network-class
    /// failures exhaust to `Offline`; transient HTTP failures (408/425/429/5xx)
    /// exhaust to `Degraded`; 413/422 → `SplitBisect`; 401/403 → `AuthRequired`;
    /// 400/409/other → `Degraded`; 2xx → `Accepted`.
    async fn upload(&self, bearer: &str, gzip_body: &[u8]) -> UploadResult {
        let mut attempt: u32 = 1;
        loop {
            let request = TransportRequest {
                url: &self.ingest_url,
                bearer,
                gzip_body,
            };
            match self.transport.post(request).await {
                // Any transport error is network-class (server never reached) →
                // retry, then exhaust to Offline.
                Err(_) => {
                    if attempt >= self.retry.max_attempts {
                        return UploadResult::Offline;
                    }
                    self.backoff(attempt).await;
                    attempt += 1;
                }
                Ok(response) => match classify_status(response.status) {
                    HttpDisposition::Success => return UploadResult::Accepted,
                    HttpDisposition::SplitBisect => return UploadResult::SplitBisect,
                    HttpDisposition::AuthFailure => return UploadResult::AuthRequired,
                    HttpDisposition::Fatal => return UploadResult::Degraded,
                    HttpDisposition::RetryTransient => {
                        if attempt >= self.retry.max_attempts {
                            return UploadResult::Degraded;
                        }
                        self.backoff(attempt).await;
                        attempt += 1;
                    }
                },
            }
        }
    }

    /// Sleep the full-jitter backoff for `attempt` (no-op at zero delay).
    async fn backoff(&self, attempt: u32) {
        let delay = self.retry.delay_for(attempt, rand01());
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

/// A uniform in `[0, 1)` from the OS CSPRNG (53-bit mantissa) for full-jitter
/// backoff. Injected as a plain `f64` into the pure schedule so the policy stays
/// testable; only the live engine draws real randomness here.
fn rand01() -> f64 {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).expect("OS CSPRNG must be available");
    let value = u64::from_le_bytes(bytes);
    // Top 53 bits → an exact double in [0, 1).
    ((value >> 11) as f64) / ((1u64 << 53) as f64)
}

/// Partition drained events into single-source groups by their local
/// `connector_id`, preserving both first-seen group order AND FIFO event order
/// within each group (ADR 0060). Every uploaded batch must be single-source so
/// the server can scope its window-delete to that source; mixing two sources in
/// one batch would let one source's restatement delete the other's rows.
fn group_by_connector(
    events: Vec<crate::store::queue::PendingEvent>,
) -> Vec<(String, Vec<crate::store::queue::PendingEvent>)> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, Vec<crate::store::queue::PendingEvent>> =
        std::collections::HashMap::new();
    for event in events {
        let key = event.connector_id.clone();
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(event);
    }
    order
        .into_iter()
        .map(|key| {
            let group = groups.remove(&key).unwrap_or_default();
            (key, group)
        })
        .collect()
}

/// Stable, non-secret log code for an outcome.
fn outcome_code(outcome: SyncOutcome) -> &'static str {
    match outcome {
        SyncOutcome::Healthy => "healthy",
        SyncOutcome::Idle => "idle",
        SyncOutcome::Busy => "busy",
        SyncOutcome::Offline => "offline",
        SyncOutcome::AuthenticationRequired => "authentication_required",
        SyncOutcome::Degraded => "degraded",
    }
}

/// RAII single-in-flight guard: at most one upload cycle per installation
/// (spec §14.3). Held across await points; `&AtomicBool` is Send+Sync.
struct InFlightGuard<'a>(&'a AtomicBool);

impl<'a> InFlightGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        match flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => Some(InFlightGuard(flag)),
            Err(_) => None,
        }
    }
}

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{resolve_state, AgentState};
    use crate::store::crypto::{DbKey, KEY_LEN};
    use crate::store::queue::NewEvent;
    use crate::store::{Store, DB_FILE_NAME};
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    fn key() -> DbKey {
        DbKey::from_bytes([7u8; KEY_LEN])
    }

    /// A `usage_summary` queue event carrying one person-day of records.
    fn summary_event(event_id: &str, day: &str, prompts: i64) -> NewEvent {
        NewEvent::analytics_only(
            event_id,
            "claude_code",
            batch::USAGE_SUMMARY_EVENT_TYPE,
            0,
            json!({
                "subject": { "kind": "person", "externalId": "user-abc" },
                "day": day,
                "records": [
                    { "metricKey": "prompts", "value": prompts, "attribution": "person" }
                ]
            }),
        )
    }

    /// A scripted, no-network transport that records every (decompressed) body
    /// it is handed, in call order, and replies from a fixed queue.
    struct MockTransport {
        replies: Mutex<VecDeque<Result<TransportResponse, TransportError>>>,
        bodies: Mutex<Vec<serde_json::Value>>,
    }

    impl MockTransport {
        fn new(replies: Vec<Result<TransportResponse, TransportError>>) -> Self {
            MockTransport {
                replies: Mutex::new(replies.into_iter().collect()),
                bodies: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> usize {
            self.bodies.lock().unwrap().len()
        }

        fn body(&self, index: usize) -> serde_json::Value {
            self.bodies.lock().unwrap()[index].clone()
        }
    }

    impl IngestTransport for MockTransport {
        async fn post(
            &self,
            request: TransportRequest<'_>,
        ) -> Result<TransportResponse, TransportError> {
            use flate2::read::GzDecoder;
            use std::io::Read;
            let mut decoder = GzDecoder::new(request.gzip_body);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out).expect("mock body is gzip");
            let value: serde_json::Value = serde_json::from_slice(&out).expect("mock body is JSON");
            self.bodies.lock().unwrap().push(value);

            self.replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("mock transport ran out of scripted replies")
        }
    }

    fn accepted(records: i64) -> Result<TransportResponse, TransportError> {
        Ok(TransportResponse {
            status: 200,
            body: format!("{{\"ok\":true,\"subjects\":1,\"records\":{records},\"signals\":0}}")
                .into_bytes(),
        })
    }

    fn status(code: u16) -> Result<TransportResponse, TransportError> {
        Ok(TransportResponse {
            status: code,
            body: Vec::new(),
        })
    }

    fn net_error() -> Result<TransportResponse, TransportError> {
        Err(TransportError::Network)
    }

    fn engine(mock: MockTransport, max_attempts: u32) -> SyncEngine<MockTransport> {
        SyncEngine::with_transport(
            mock,
            RetryPolicy::no_delay(max_attempts),
            "https://app.example.test/api/agent/ingest".to_string(),
            "0.1.0".to_string(),
        )
    }

    /// A `usage_summary` event for a NAMED subject on `day` (one prompts record).
    fn summary_event_for(event_id: &str, subject: &str, day: &str) -> NewEvent {
        NewEvent::analytics_only(
            event_id,
            "claude_code",
            batch::USAGE_SUMMARY_EVENT_TYPE,
            0,
            json!({
                "subject": { "kind": "person", "externalId": subject },
                "day": day,
                "records": [
                    { "metricKey": "prompts", "value": 1, "attribution": "person" }
                ]
            }),
        )
    }

    /// An event the batch builder cannot decode into a summary (unknown type),
    /// so it carries nothing persistable.
    fn undecodable_event(event_id: &str) -> NewEvent {
        NewEvent::analytics_only(event_id, "claude_code", "some_future_type", 0, json!({}))
    }

    /// A transport that FAITHFULLY SIMULATES the server's destructive ingest:
    /// each accepted POST runs `deleteWindow(start..=end)` (removes every stored
    /// row whose day is in that inclusive range) then upserts the batch's rows —
    /// "a push is authoritative for its window". This is what makes the P0
    /// data-loss hazard observable: with an overlapping-window (count) split, a
    /// later push's window-delete erases an earlier push's rows; with a
    /// day-disjoint split it cannot. `statuses` is a scripted status sequence
    /// (extra calls default to 200).
    /// A natural key persisted server-side: `(subject_externalId, metricKey)`.
    type NaturalKey = (String, String);
    /// The simulated server store: day -> set of natural keys currently present.
    type DayRows = std::collections::BTreeMap<String, std::collections::BTreeSet<NaturalKey>>;

    struct SimTransport {
        statuses: Mutex<VecDeque<u16>>,
        rows: Mutex<DayRows>,
        calls: Mutex<usize>,
    }

    impl SimTransport {
        fn new(statuses: Vec<u16>) -> Self {
            SimTransport {
                statuses: Mutex::new(statuses.into_iter().collect()),
                rows: Mutex::new(DayRows::new()),
                calls: Mutex::new(0),
            }
        }

        #[allow(dead_code)] // SimTransport mirror of MockTransport::calls; kept for symmetry
        fn calls(&self) -> usize {
            *self.calls.lock().unwrap()
        }

        /// Every persisted `(day, subject)` tuple — the ground truth to assert no
        /// day's data was lost.
        fn persisted(&self) -> std::collections::BTreeSet<(String, String)> {
            let rows = self.rows.lock().unwrap();
            let mut out = std::collections::BTreeSet::new();
            for (day, keys) in rows.iter() {
                for (subject, _metric) in keys {
                    out.insert((day.clone(), subject.clone()));
                }
            }
            out
        }
    }

    impl IngestTransport for SimTransport {
        async fn post(
            &self,
            request: TransportRequest<'_>,
        ) -> Result<TransportResponse, TransportError> {
            use flate2::read::GzDecoder;
            use std::io::Read;
            *self.calls.lock().unwrap() += 1;

            let mut decoder = GzDecoder::new(request.gzip_body);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out).expect("sim body is gzip");
            let body: batch::IngestRequest =
                serde_json::from_slice(&out).expect("sim body is a valid IngestRequest");

            let code = self.statuses.lock().unwrap().pop_front().unwrap_or(200);

            if (200..300).contains(&code) {
                let mut rows = self.rows.lock().unwrap();
                // deleteWindow(start..=end): remove every stored day in range.
                let start = body.window.start.clone();
                let end = body.window.end.clone();
                let doomed: Vec<String> = rows
                    .keys()
                    .filter(|d| **d >= start && **d <= end)
                    .cloned()
                    .collect();
                for day in doomed {
                    rows.remove(&day);
                }
                // upsert the batch's rows.
                for record in &body.records {
                    rows.entry(record.day.clone()).or_default().insert((
                        record.subject.external_id.clone(),
                        record.metric_key.clone(),
                    ));
                }
            }

            Ok(TransportResponse {
                status: code,
                body: Vec::new(),
            })
        }
    }

    fn engine_sim(sim: SimTransport, max_attempts: u32) -> SyncEngine<SimTransport> {
        SyncEngine::with_transport(
            sim,
            RetryPolicy::no_delay(max_attempts),
            "https://app.example.test/api/agent/ingest".to_string(),
            "0.1.0".to_string(),
        )
    }

    fn enrolled_state(outcome: SyncOutcome) -> AgentState {
        let mut inputs = StateInputs {
            enrolled: true,
            ..StateInputs::default()
        };
        outcome.apply(&mut inputs);
        resolve_state(&inputs)
    }

    /// ADR 0060 / D-DA-8: a flush cycle carrying events from TWO local
    /// connectors uploads TWO single-source batches — one tagged
    /// `claude-code-local`, one tagged `claude-export` — so the server scopes
    /// each window-delete to its own source and the export cannot clobber the
    /// live connector's overlapping days.
    #[tokio::test]
    async fn mixed_sources_upload_as_separate_single_source_batches() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[summary_event("live-1", "2026-07-15", 3)],
                "cp-live",
            )
            .unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_export",
                &[summary_event("exp-1", "2026-07-15", 9)],
                "cp-export",
            )
            .unwrap();

        let engine = engine(MockTransport::new(vec![accepted(1), accepted(1)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(store.pending_count().unwrap(), 0, "both batches purged");
        assert_eq!(engine.transport.calls(), 2, "one batch per source");

        // The two bodies carry DISTINCT sources (order = first-seen connector).
        let sources: std::collections::BTreeSet<String> = (0..2)
            .map(|i| {
                engine.transport.body(i)["source"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(
            sources,
            ["claude-code-local", "claude-export"]
                .into_iter()
                .map(String::from)
                .collect()
        );
    }

    #[tokio::test]
    async fn empty_queue_is_idle() {
        let store = Store::open_in_memory(key()).unwrap();
        let engine = engine(MockTransport::new(vec![]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();
        assert_eq!(outcome, SyncOutcome::Idle);
    }

    #[tokio::test]
    async fn successful_sync_purges_records_receipt_and_is_healthy() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event("e1", "2026-07-15", 3),
                    summary_event("e2", "2026-07-16", 4),
                ],
                "cp",
            )
            .unwrap();

        let engine = engine(MockTransport::new(vec![accepted(2)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(store.pending_count().unwrap(), 0, "sent events are purged");
        assert_eq!(engine.transport.calls(), 1);
        assert_eq!(enrolled_state(outcome), AgentState::Healthy);
    }

    /// Offline queueing (§26.2): a network error leaves the events queued and
    /// reports `offline`.
    #[tokio::test]
    async fn offline_queueing_keeps_events_and_reports_offline() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        // max_attempts = 3 → three network errors, then give up as offline.
        let engine = engine(
            MockTransport::new(vec![net_error(), net_error(), net_error()]),
            3,
        );
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Offline);
        assert_eq!(
            store.pending_count().unwrap(),
            1,
            "events stay queued offline"
        );
        assert_eq!(engine.transport.calls(), 3, "first attempt + two retries");
        assert_eq!(enrolled_state(outcome), AgentState::Offline);
    }

    /// Restart recovery (§26.2/§27.3): unsent events survive a process restart
    /// and re-send on the next run.
    #[tokio::test]
    async fn restart_recovery_resends_unsent_events() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-sync-restart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(DB_FILE_NAME);

        // Run 1: enqueue, then the network is down — nothing gets sent.
        {
            let store = Store::open_with_key(&path, key()).unwrap();
            store
                .enqueue_and_checkpoint(
                    "claude_code",
                    &[
                        summary_event("e1", "2026-07-15", 3),
                        summary_event("e2", "2026-07-16", 4),
                    ],
                    "cp",
                )
                .unwrap();
            let engine = engine(MockTransport::new(vec![net_error()]), 1);
            let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();
            assert_eq!(outcome, SyncOutcome::Offline);
            assert_eq!(store.pending_count().unwrap(), 2);
        }

        // Run 2: a fresh process (reopen the same file + key) re-sends them.
        {
            let store = Store::open_with_key(&path, key()).unwrap();
            assert_eq!(
                store.pending_count().unwrap(),
                2,
                "unsent events survived restart"
            );
            let engine = engine(MockTransport::new(vec![accepted(2)]), 3);
            let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();
            assert_eq!(outcome, SyncOutcome::Healthy);
            assert_eq!(store.pending_count().unwrap(), 0, "re-sent and purged");
            assert_eq!(engine.transport.calls(), 1);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Duplicate retry (§26.2): a resend after a transient failure carries the
    /// IDENTICAL body (same natural keys) — the server would dedup it.
    #[tokio::test]
    async fn duplicate_retry_sends_identical_natural_keys() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event("e1", "2026-07-15", 3),
                    summary_event("e2", "2026-07-16", 4),
                ],
                "cp",
            )
            .unwrap();

        // First attempt fails at the network; second succeeds.
        let engine = engine(MockTransport::new(vec![net_error(), accepted(2)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(engine.transport.calls(), 2);
        assert_eq!(
            engine.transport.body(0),
            engine.transport.body(1),
            "the resend must be byte-identical so the server dedups it"
        );
        assert_eq!(store.pending_count().unwrap(), 0);
    }

    /// Batch splitting (§26.2): a 413 bisects the batch and each half is retried
    /// and accepted.
    #[tokio::test]
    async fn batch_splitting_bisects_on_413() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event("e1", "2026-07-13", 1),
                    summary_event("e2", "2026-07-14", 2),
                    summary_event("e3", "2026-07-15", 3),
                    summary_event("e4", "2026-07-16", 4),
                ],
                "cp",
            )
            .unwrap();

        // Full batch → 413; the two halves → 200, 200.
        let engine = engine(
            MockTransport::new(vec![status(413), accepted(2), accepted(2)]),
            3,
        );
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(engine.transport.calls(), 3, "one full attempt + two halves");
        assert_eq!(
            store.pending_count().unwrap(),
            0,
            "every split half is accepted and purged"
        );
    }

    /// P0 REGRESSION (data loss): a multi-subject queue where one DAY straddles
    /// the count-midpoint, simulated against a server that deletes-window-then-
    /// upserts. A count-based split would give the two halves OVERLAPPING
    /// windows, and the later push's window-delete would erase the earlier's
    /// same-day rows. The day-based split keeps every day whole in ONE push, so
    /// NO day's data is lost. (This test loses `2026-01-03/X` under the old
    /// count split; it passes under the day split.)
    #[tokio::test]
    async fn day_split_never_loses_a_straddling_days_rows() {
        let store = Store::open_in_memory(key()).unwrap();
        // Queue order (row-id/FIFO) interleaves two subjects on 2026-01-03 across
        // the middle of the four events — the exact count-split hazard.
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event_for("e1", "P", "2026-01-01"),
                    summary_event_for("e2", "Q", "2026-01-03"),
                    summary_event_for("e3", "X", "2026-01-03"),
                    summary_event_for("e4", "R", "2026-01-05"),
                ],
                "cp",
            )
            .unwrap();

        // Full batch → 413 (forces a split); each resulting sub-batch → 200,
        // with the server applying delete-window-then-upsert on each.
        let engine = engine_sim(SimTransport::new(vec![413, 200, 200]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(store.pending_count().unwrap(), 0, "all events uploaded");

        // Ground truth: every (day, subject) survived — nothing clobbered.
        let expected: std::collections::BTreeSet<(String, String)> = [
            ("2026-01-01", "P"),
            ("2026-01-03", "Q"),
            ("2026-01-03", "X"),
            ("2026-01-05", "R"),
        ]
        .iter()
        .map(|(d, s)| (d.to_string(), s.to_string()))
        .collect();
        assert_eq!(
            engine.transport.persisted(),
            expected,
            "no day's data may be lost across the split (P0)"
        );
    }

    /// M2 (poison 400): a cycle whose events are ALL undecodable produces a body
    /// with no records and `window.start = ""`. It must be SKIPPED (never POSTed
    /// — the mock has no replies and would panic on any upload), the events
    /// purged so the queue can't wedge, and the drop surfaced as degraded.
    #[tokio::test]
    async fn all_undecodable_batch_is_skipped_not_posted() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[undecodable_event("e1"), undecodable_event("e2")],
                "cp",
            )
            .unwrap();

        let engine = engine(MockTransport::new(vec![]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Degraded, "the drop is surfaced");
        assert_eq!(engine.transport.calls(), 0, "an empty body is never POSTed");
        assert_eq!(
            store.pending_count().unwrap(),
            0,
            "the undecodable events are purged so the queue can't wedge"
        );
    }

    /// M1 (honesty): a quarantine's `degraded` signal must SURVIVE a subsequent
    /// empty-queue `Idle` cycle — otherwise a permanent data drop's only visible
    /// state vanishes the moment the queue empties.
    #[tokio::test]
    async fn quarantine_degraded_survives_a_later_idle_cycle() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        let mut inputs = StateInputs {
            enrolled: true,
            ..StateInputs::default()
        };

        // Cycle 1: the single day is rejected (422) → quarantined → Degraded.
        let engine1 = engine(MockTransport::new(vec![status(422)]), 3);
        let first = engine1.sync_once(&store, "rva1.tok").await.unwrap();
        assert_eq!(first, SyncOutcome::Degraded);
        first.apply(&mut inputs);
        assert!(inputs.degraded);
        assert_eq!(resolve_state(&inputs), AgentState::Degraded);

        // Cycle 2: the queue is now empty → Idle. The degraded flag must PERSIST
        // (only a real Healthy sync clears it).
        let engine2 = engine(MockTransport::new(vec![]), 3);
        let second = engine2.sync_once(&store, "rva1.tok").await.unwrap();
        assert_eq!(second, SyncOutcome::Idle);
        second.apply(&mut inputs);
        assert!(
            inputs.degraded,
            "an Idle cycle must not erase a standing quarantine's degraded signal"
        );
        assert_eq!(resolve_state(&inputs), AgentState::Degraded);
    }

    /// A single event the server keeps rejecting (413/422) is quarantined so it
    /// can't wedge the queue — dropped, degraded, never silent.
    #[tokio::test]
    async fn single_event_rejection_is_quarantined() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        let engine = engine(MockTransport::new(vec![status(422)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Degraded);
        assert_eq!(
            store.pending_count().unwrap(),
            0,
            "the poison event is quarantined"
        );
        assert_eq!(engine.transport.calls(), 1);
    }

    /// Token-auth failure (§26.2): 401 and 403 both stop syncing and require
    /// re-authentication; events stay queued.
    #[tokio::test]
    async fn auth_failures_map_to_authentication_required() {
        for code in [401u16, 403u16] {
            let store = Store::open_in_memory(key()).unwrap();
            store
                .enqueue_and_checkpoint(
                    "claude_code",
                    &[summary_event("e1", "2026-07-15", 3)],
                    "cp",
                )
                .unwrap();

            let engine = engine(MockTransport::new(vec![status(code)]), 3);
            let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

            assert_eq!(
                outcome,
                SyncOutcome::AuthenticationRequired,
                "HTTP {code} must map to authentication_required"
            );
            assert_eq!(
                store.pending_count().unwrap(),
                1,
                "events stay queued for after re-auth"
            );
            assert_eq!(enrolled_state(outcome), AgentState::AuthenticationRequired);
        }
    }

    /// Partial acceptance (§26.2/§27.3): the transactional endpoint returns 2xx
    /// for the whole batch; even if it reports FEWER records than were sent, the
    /// client trusts the 2xx and purges every sent event (server idempotency
    /// covers anything re-sent). No re-send loop, no data loss.
    #[tokio::test]
    async fn partial_acceptance_trusts_2xx_and_purges_all() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event("e1", "2026-07-14", 1),
                    summary_event("e2", "2026-07-15", 2),
                    summary_event("e3", "2026-07-16", 3),
                ],
                "cp",
            )
            .unwrap();

        // Server reports only 1 record accepted though 3 events were sent.
        let engine = engine(MockTransport::new(vec![accepted(1)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(
            store.pending_count().unwrap(),
            0,
            "a 2xx purges the whole submitted batch"
        );
        assert_eq!(engine.transport.calls(), 1);
    }

    /// Retryable HTTP (429/5xx) exhausts to `degraded` (reachable but unhappy),
    /// NOT `offline` (which is reserved for network loss), and leaves events
    /// queued.
    #[tokio::test]
    async fn transient_http_exhausts_to_degraded() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        let engine = engine(MockTransport::new(vec![status(503), status(503)]), 2);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Degraded);
        assert_eq!(
            store.pending_count().unwrap(),
            1,
            "left queued to retry later"
        );
        assert_eq!(engine.transport.calls(), 2);
        assert_eq!(enrolled_state(outcome), AgentState::Degraded);
    }

    /// A retryable status that then SUCCEEDS on retry resolves healthy — proves
    /// the transient path actually retries rather than giving up.
    #[tokio::test]
    async fn transient_http_then_success_is_healthy() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        let engine = engine(MockTransport::new(vec![status(429), accepted(1)]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(store.pending_count().unwrap(), 0);
        assert_eq!(engine.transport.calls(), 2);
    }

    /// A 400 is fatal: not retried, degraded, events left queued.
    #[tokio::test]
    async fn fatal_400_is_not_retried() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint("claude_code", &[summary_event("e1", "2026-07-15", 3)], "cp")
            .unwrap();

        let engine = engine(MockTransport::new(vec![status(400)]), 5);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Degraded);
        assert_eq!(engine.transport.calls(), 1, "a 400 is never retried");
        assert_eq!(store.pending_count().unwrap(), 1);
    }

    /// Crash-between-2xx-and-purge: on restart the receipt is found, so the
    /// batch is purged WITHOUT re-uploading (the mock has zero replies and must
    /// never be called).
    #[tokio::test]
    async fn existing_receipt_short_circuits_reupload() {
        let store = Store::open_in_memory(key()).unwrap();
        store
            .enqueue_and_checkpoint(
                "claude_code",
                &[
                    summary_event("e1", "2026-07-15", 3),
                    summary_event("e2", "2026-07-16", 4),
                ],
                "cp",
            )
            .unwrap();

        // Pre-record the receipt for exactly this queued set (as a prior,
        // crashed run would have).
        let queued = store.dequeue_batch(MAX_EVENTS_PER_BATCH).unwrap();
        let batch_id = batch::deterministic_batch_id(&queued);
        store
            .record_receipt(&batch_id, queued.len() as i64, "accepted", 1)
            .unwrap();

        // A transport with NO replies — if the engine tried to upload, the mock
        // would panic.
        let engine = engine(MockTransport::new(vec![]), 3);
        let outcome = engine.sync_once(&store, "rva1.tok").await.unwrap();

        assert_eq!(outcome, SyncOutcome::Healthy);
        assert_eq!(
            engine.transport.calls(),
            0,
            "a receipted batch is never re-uploaded"
        );
        assert_eq!(store.pending_count().unwrap(), 0, "it is purged instead");
    }

    /// Single-in-flight (§14.3): the guard is exposed via the outcome — a second
    /// concurrent entry would get `Busy`. Here we prove the guard resets after a
    /// completed cycle (a subsequent call is NOT `Busy`).
    #[tokio::test]
    async fn in_flight_guard_resets_after_a_cycle() {
        let store = Store::open_in_memory(key()).unwrap();
        let engine = engine(MockTransport::new(vec![]), 3);
        // Two sequential idle cycles both run (neither is spuriously Busy).
        assert_eq!(
            engine.sync_once(&store, "t").await.unwrap(),
            SyncOutcome::Idle
        );
        assert_eq!(
            engine.sync_once(&store, "t").await.unwrap(),
            SyncOutcome::Idle
        );
    }

    #[test]
    fn busy_outcome_leaves_state_untouched() {
        let mut inputs = StateInputs {
            enrolled: true,
            degraded: true,
            ..StateInputs::default()
        };
        SyncOutcome::Busy.apply(&mut inputs);
        assert!(
            inputs.degraded,
            "Busy must not clobber an existing condition"
        );
    }

    #[test]
    fn healthy_clears_stale_problem_flags() {
        let mut inputs = StateInputs {
            enrolled: true,
            offline: true,
            degraded: true,
            ..StateInputs::default()
        };
        SyncOutcome::Healthy.apply(&mut inputs);
        assert!(!inputs.offline);
        assert!(!inputs.degraded);
        assert_eq!(resolve_state(&inputs), AgentState::Healthy);
    }
}
