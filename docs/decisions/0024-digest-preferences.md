# 0024 — Weekly digest: `digest_preferences` table, `forOrg.digestPreferences`, cron/queue send, and unauthenticated unsubscribe

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Founder
- **Workstream:** B2 (F2.2 Weekly digest)

## Context

Phase-2 F2.2 (ai-intelligence-implementation-plan.md §5) ships the retention/coaching
loop's delivery vehicle: a weekly email — trend vs past-self, personal best, 1–3
task-focused recommendations. Personal orgs get the full personal view; Team admins get
an aggregate-only lane (no named individuals). It is the one Phase-2 feature with real
infra:

1. Durable, per-person **delivery preferences** (opt-in state + one-click unsubscribe
   token + send-time idempotency key) — durable per-(org, user) config, so a new
   org-scoped table, a frozen-schema change requiring this ADR.
2. A **weekly cron + queue message kind + `process.ts` case** — the established
   non-frozen poller path (no new queue/consumer, so no `wrangler queues create` churn).
3. **Email assembly** over existing dashboard-view data + `sendEmail` (SES, ADR 0015) —
   the first *product/bulk* sender (Better Auth transactional was the only caller).
4. An **unauthenticated token unsubscribe route** — the share-links capability pattern
   (`getApiContext()`, org derived from the token row, never a session).

The budgets ADR (0020) noted "email delivery … is deliberately not built (the product
has no email-sending capability)". F2.2 is where that capability is first used for a
product message — under strict staleness/honesty and deliverability gating.

## Decision

### New table `digest_preferences` (frozen-schema change)

One row per `(org_id, user_id)`, cascade-deleted with the org AND the user:

- `id uuid pk`
- `org_id uuid not null → orgs(id) on delete cascade`
- `user_id text not null → user(id) on delete cascade`
- `digest_enabled boolean not null default true`
- `unsubscribe_token_hash text` — SHA-256 hash of the current one-click token; plaintext
  lives only in the email URL (mirrors `share_links`); rotated on each real send
- `last_sent_week text` — ISO week (e.g. `2026-W28`) of the last send; the idempotency key
- `created_at`, `updated_at`
- `unique(org_id, id)` (D1a composite-FK anchor), `unique(org_id, user_id)` (one pref per
  person per org, the opt-in/toggle upsert target), `index(unsubscribe_token_hash)`

Migration: `drizzle/0023_digest-preferences.sql` (offline `drizzle-kit generate`).
Registered in the tenant-isolation sweep (`tests/tenant-isolation.test.ts` `SCOPED_READS`
entry `digestPreferences.list` + a non-vacuous B-org seed) and in account-deletion's
`PURGE_EXEMPT_TABLES` (it cascades via `org_id`, like `budgets`) with the completeness
tripwire in `tests/account-deletion.test.ts`.

**Default-enabled decision.** Ship **default OFF for Team admins, default ON only for a
Personal org's owner** — least-surprise + deliverability safety (never bulk-email a team's
admins unprompted). The default is NOT a column default (it depends on org shape); it
lives in the sender: an ABSENT row resolves to on for a single-member org and off for a
multi-member org. Once a row exists it is the explicit truth; the Settings toggle writes
it.

### `forOrg.digestPreferences` repository methods (additive to the frozen public API)

- `list()` — every preference row for the org (admin surface + isolation sweep).
- `getForUser(userId)` — this user's row (or undefined).
- `setEnabled(userId, enabled)` — the Settings opt-in/out; upsert on `(org_id, user_id)`.
- `claimWeekAndRotateToken(userId, week)` — atomic compare-and-set of `last_sent_week`
  (+ a freshly-minted token hash) guarded on `digest_enabled = true` AND
  `last_sent_week IS DISTINCT FROM week`; returns the new plaintext token when the claim
  wins, else `null`. This is the at-least-once idempotency guarantee: the claim precedes
  `sendEmail`, so a redelivery or mid-send crash under-delivers (safe), never double-sends.

All org-scoped like every existing method; no existing signatures changed. Token helpers
(`generateUnsubscribeToken`/`hashUnsubscribeToken`) and the pre-scope resolver
(`resolveDigestUnsubscribe`, org derived from the token row) live in the non-frozen
`src/db/digest-preferences.ts`, beside the org-scope module — the same split share-links
uses (capability read/write, not an ambient org-scoped read).

### Cron / queue (established non-frozen path)

- New cron `0 14 * * 1` (Monday 14:00 UTC — a humane send hour) in `wrangler.jsonc`.
- `src/worker.ts scheduled()` branch: enumerate orgs via `listOrgIds`, fan out
  `{ kind: "digest-weekly", orgId }` through `sendInBatches` on the EXISTING
  `revealyst-poll` queue (no new queue/consumer).
- `PollMessage` union gains `digest-weekly`; `process.ts` gains an exhaustive-switch case;
  `PollDeps` gains the SES `emailEnv` + `appOrigin`, threaded from the worker consumer the
  way `credentialEnv` already is.

### Unsubscribe route (unauthenticated, one-click)

`/api/digest/unsubscribe?token=…` (`getApiContext()`, no session). **GET is READ-ONLY**:
it verifies the token (`peekDigestUnsubscribe`) and renders a confirmation page whose
`<form method="post">` button performs the unsubscribe — mail-security gateways (Outlook
SafeLinks, Proofpoint) and inbox prefetchers GET every link on arrival, so a mutating GET
would silently mass-unsubscribe every recipient behind such a gateway. **POST is the sole
mutator** (`resolveDigestUnsubscribe`), serving both that confirm form and the RFC 8058
`List-Unsubscribe-Post` one-click. Emails carry `List-Unsubscribe: <url>` +
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`. `sendEmail` gains an additive optional
`headers` field passed into the SES v2 `Content.Simple.Headers` (email.ts is not frozen).

### Settings UI + API

A "Weekly digest" Card on `/settings` (admin-gated) + `digest-preferences-form.tsx` +
`PATCH /api/settings/digest` (`handleApi`, `adminOnly: true`, `allowOverFreeBand: true` —
managing your own notification preference must work over the free band; the digest content
is org data the org already has). The route uses its own local zod schema (not the frozen
`src/contracts/api.ts`).

## Honesty rules (invariant b / G5 / G7)

- **Staleness (G5).** Freshness comes from `connections.last_success_at` ONLY (never
  `score_results.computed_at`). `DIGEST_STALE_AFTER_DAYS = 7`: if NO usable connection has
  synced within it, the send is **suppressed entirely** (logged skip); if some channels are
  stale, the digest sends with an explicit per-channel "hasn't synced since <date>"
  annotation. Every digest carries a "data as of <date>" line.
- **Aggregate-only Team lane.** The Team-admin lane surfaces NO named individuals — it runs
  the same aggregate data (period-over-period counts, org/team-level score trend, generic
  coaching) as the dashboard's team surface. Deltas render `first`/`notComparable` honestly
  ("first week tracked"), never a fabricated 0%.
- **Copy discipline (G7).** All digest prose (subject, section headers, staleness
  annotations, footer) lives in a glossary-style constant module (`digest-copy.ts`);
  recommendations reuse the gated `deriveAttention`/`coaching-recommendations` engine. The
  subject is generic ("Your Revealyst weekly digest") so no metric value leaks to the inbox
  preview.

## Contracts affected

- `src/db/schema.ts` + `drizzle/0023_digest-preferences.sql` — new org-scoped table (additive).
- `src/db/org-scope.ts` public API — additive `digestPreferences` methods only.

## Workstreams to re-sync

None. All changes are additive; no workstream built against the absence of these.

## Consequences

- The digest is a compute-on-read email: the only persisted state is the per-person
  preference + last-sent week. There is no send log and no digest-content table; each send
  reads the org's dashboard-view data live.
- Rotating the unsubscribe token per send means only the most recent email's link is live —
  a prior week's link 404s. Accepted trade-off (low-sensitivity capability; more secure).
- A local-channel org that syncs less often than `DIGEST_STALE_AFTER_DAYS` is suppressed
  every week with only a console log — a "digest paused: data stale" surface on the
  Settings card is the planned fast-follow so the user can see why no email arrives.
- Migration `0023` / ADR `0024` are independent sequences claimed at build time; a parallel
  merge may shift either — re-checked before the PR.
