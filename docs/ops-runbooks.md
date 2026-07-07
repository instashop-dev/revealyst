# Ops runbooks (W3-O)

Operational procedures for the deployed Worker + Neon stack. Steps marked
**[founder]** need console/account access and are executed by a human; the
rest is scripted or already wired. Companion docs: [infra.md](infra.md)
(provisioning), ADR 0005/0006 (poller lifecycle), `src/lib/credentials.ts`
(envelope encryption).

**Drill status: written, not yet rehearsed.** Per the W3-O kickoff decision,
the live drills (Neon restore, KEK rotation) are documented here and deferred
to founder execution; record the evidence table (§6) when run.

---

## 1. Neon backup / restore

Neon's storage keeps a continuous **history** of the project (WAL-based);
"backup" is a retention setting, and "restore" is either point-in-time
recovery (PITR) to a new branch or promoting such a branch to production.
There is nothing app-side to run — the drill is Neon-console work + one
Hyperdrive/connection-string update.

### Configure retention — [founder], once
1. Neon console → project → **Settings → Storage** (history retention).
2. Set retention to **7 days minimum** (Launch plan allows up to 30; pick
   the longest the plan supports — this bounds the worst-case RPO for
   anything short of account loss).
3. Record the chosen window in §6.

### Restore drill (PITR to a branch) — [founder]
1. Neon console → **Branches → Create branch** → "from a past time" →
   pick a timestamp a few minutes back. Name it `drill-restore-<date>`.
2. Copy the branch's **pooled** connection string; verify data:
   `DATABASE_URL=<branch-url> npx tsx scripts/calibrate-scores.ts <org-id>`
   or a psql spot-check (`select count(*) from metric_records`).
3. Tear the branch down after the check (branches bill storage).
4. Record wall-time-to-usable-branch in §6 — that is our measured RTO.

### Real recovery (production is corrupted / bad migration)
1. **Stop writes:** disable the Worker's cron triggers (Cloudflare dash →
   Worker → Triggers) or deploy with the queue consumer paused. The poller
   is resumable by design (idempotent upserts; backfill chains re-cover
   windows), so a pause loses nothing.
2. PITR-branch to the last-known-good timestamp (as in the drill).
3. Point production at the branch: either promote it (Neon "restore" /
   branch promote) or update the **Hyperdrive** origin
   (`npx wrangler hyperdrive update revealyst-neon --connection-string=…`)
   and the `DATABASE_URL` repo secret, then run the Deploy workflow.
4. Re-enable triggers. Dropped queue messages are self-healing: the next
   cron tick re-dispatches due work; a backfill hole re-fills on the next
   chain pass (ADR 0006).
5. **RPO note:** anything ingested after the restore point re-ingests on
   the next poll for vendors whose API retention covers the gap (Anthropic
   ~1 year; see docs/connector-facts.md). Agent-pushed data
   (`claude_code` local agent) in the gap is lost unless the agent re-sends.

## 2. Secrets / KEK rotation

Two secret classes: **Worker secrets** (auth, DB URL, OAuth, KEKs — synced
from repo secrets by the Deploy workflow) and **per-connection vendor
credentials** (AES-256-GCM envelope in Postgres; never in env). Rotating a
plain Worker secret = update the repo secret → run Deploy. The KEK is the
only one with a procedure:

### KEK rotation (rotation = DEK rewrap only; ciphertext untouched)
1. **[founder]** Mint a new KEK with a **new version label**:
   `echo "v<N+1>:$(openssl rand -base64 32)"`.
2. **[founder]** Repo secrets: set `CREDENTIAL_KEK_PREVIOUS` = the old
   `CREDENTIAL_KEK_CURRENT` value, set `CREDENTIAL_KEK_CURRENT` = the new
   `v<N+1>:…` value. Run the **Deploy** workflow (syncs both to the Worker
   — new writes now wrap under v<N+1>; reads fall back to previous).
3. Run the sweep (idempotent, resumable — safe to re-run):
   `DATABASE_URL=<prod-pooled-url> CREDENTIAL_KEK_CURRENT=<new> CREDENTIAL_KEK_PREVIOUS=<old> npm run rotate:kek`
   Wait for **"rotation complete"**. Any org failure → fix, re-run; do NOT
   proceed while stragglers remain (their rows still need the old KEK).
4. **[founder]** Delete the `CREDENTIAL_KEK_PREVIOUS` **repo** secret and
   re-run Deploy — the workflow explicitly deletes the Worker-side secret
   when the repo secret is absent (deploy.yml), so the retired KEK can't
   decrypt anything ever again.
5. Verify: `connection_credentials.kek_version` is uniformly `v<N+1>`
   (`select distinct kek_version from connection_credentials`), and a
   "Sync now" poll succeeds (proves decrypt-with-current works end-to-end).

**Failure mode to respect:** dropping the previous KEK before step 3
completes bricks every not-yet-rewrapped credential (loud
`kekForVersion` error, but unrecoverable without the old KEK value —
users would re-enter keys). The order above is load-bearing.

### Agent device tokens
Rotate per connection from the UI/API (`POST
/api/connections/:id/agent-token`) — re-issuing overwrites the stored
secret; the old token dies instantly. No fleet-wide procedure needed.

## 3. Queue / Worker load sanity

Wired-in load model (CI-enforced, `tests/connector-framework.test.ts`
"wall-time budget"):
- Per-message call ceiling `MAX_CALLS_PER_MESSAGE = 16` ×
  `EXPECTED_CALL_LATENCY_MS = 2 s` + 10 s overhead ≤
  `WALL_TIME_BUDGET_MS = 60 s`; chunk sizing keeps every vendor's
  worst-case backfill chunk under the ceiling. Known limitation (ADR 0006):
  the model covers vendor latency only — the DB half is batched (≤500-row
  multi-row upserts) but not modeled.
- **Fan-out is batched**: cron dispatch and the nightly score recompute
  both flush through `sendInBatches` (`src/poller/queue.ts`, chunk of 100)
  — ceil(n/100) round-trips per tick, never one `send()` per connection.
  A fan-out-at-scale test guards the shape.
- **Backpressure**: vendor 429/5xx → `RetryableConnectorError` → queue
  redelivery with exponential backoff (30 s → 1 h cap), `max_retries: 10`;
  a rate-limited connection is stamped `last_polled_at` so the 5-min
  dispatcher stops piling duplicates (ADR 0006).
- **Dead-letter queue**: after the 10th retry a message lands in
  `revealyst-poll-dlq`; the Worker consumes it, logs the full body at
  error level, and acks. A drop is visible in Workers Logs, never silent.

Manual load sanity at a gate: watch one cron tick in the Cloudflare dash
(Worker → Logs) — the scheduled invocation should finish in seconds
(batched sends), consumer invocations well under 30 s CPU. Queue depth
(dash → Queues → revealyst-poll) should return to ~0 between ticks;
sustained growth = consumer starvation → check vendor outage (retry
storms) before scaling `max_batch_size`.

## 4. Uptime monitoring

- **Endpoint:** `GET /api/health` (unauthenticated, no tenant data):
  `200 {ok, db, heartbeatAgeSeconds, heartbeatFresh}` when healthy; `503`
  when the DB is unreachable **or** the heartbeat is stale
  (>15 min = 3 missed cron ticks). A persistent `db:"ok"` 503 = the
  poller pipeline is stuck (cron → queue → consumer), not the DB.
- **[founder]** Point an external monitor (UptimeRobot / Better Stack /
  Cloudflare Health Checks) at
  `https://revealyst.thapi.workers.dev/api/health`, interval ≥ 60 s,
  alert on 2 consecutive failures. Cold-start note: only a **brand-new
  environment** (empty `poll_heartbeats` table) legitimately 503s until its
  first cron tick (≤ 5 min); ordinary redeploys keep their heartbeat
  history and stay green.
- **Workers Logs** are enabled (`observability` in wrangler.jsonc): filter
  on `[queue]` (retries) and `[dlq]` (dead-lettered messages); `[audit]`
  (best-effort audit-write failures) lands with the audit-log PR
  (ADR 0010). **[founder]** add a Logs alert on any `[dlq]` occurrence —
  dead-letters should be rare enough to page on.
- Known hardening gaps (accepted for V1, revisit post-launch): no
  app-level rate limit on `/api/health` (mitigate at the Cloudflare edge
  if abused — it opens a DB connection per hit); `poll_heartbeats` has no
  `observed_at` index and no retention (tracked follow-up task — the
  health query degrades only at long horizon).

## 5. Poller rate-limit / error-budget review (W3-O finding)

Reviewed 2026-07-07 against ADR 0005/0006. Verdict: **sound for V1**; no
code change required beyond the batching fix (PR #80) and DLQ (PR #81).

What exists (see §3 for the mechanics): per-message exponential backoff
honoring vendor `Retry-After`, permanent-vs-retryable classification at
the vendor phase, post-vendor errors retried (transient DB) with
deterministic bugs surfacing as repeated failed runs, self-heal dispatch
(errored connections stay candidates), per-vendor call spacing in every
client (250–300 ms, sized to documented limits), pagination runaway
guards, and per-run/per-connection error records that the dashboard reads.

What deliberately does NOT exist (accepted):
- **No formal error budget / circuit breaker** ("N failures in M minutes →
  stop"). The implicit form — backoff + `transient` stamp + `max_retries`
  + one visibly-failed run per interval on a dead credential — bounds cost
  to ~1 failed vendor call per connection per poll interval, which is
  acceptable at V1 fleet size. Revisit when connection count × vendor
  strictness makes a stuck-key retry loop materially costly.
- **No per-org fairness scheduling.** A mass onboarding's backfill chains
  share the single queue with steady-state polls; chain serialization (one
  chunk per message) keeps any one org from monopolizing a consumer.

**Erratum:** several `src/poller/**` comments cite "ADR 0003" for the
retry/lifecycle policy; the actual decisions live in **ADR 0005/0006**
(0003 is score-oracle coverage). Corrected in the non-frozen files in this
PR; `src/db/org-scope.ts` carries the same misattribution in comments but
is frozen — fix it in the next PR that legitimately touches that file
with an ADR.

## 6. Drill evidence (fill when executed)

| Drill | Date | Executed by | Result / measured | Notes |
|---|---|---|---|---|
| Neon retention configured | | founder | window: | |
| Neon PITR restore drill | | founder | RTO: | branch: |
| KEK rotation (sandbox or prod) | | founder | rows rewrapped: | version: → |
| External monitor live | | founder | provider / interval: | |
| DLQ alert configured | | founder | | |
