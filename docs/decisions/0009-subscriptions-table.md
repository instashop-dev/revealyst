# 0009 — `subscriptions` table + Paddle entitlement state (additive)

- **Status:** Proposed
- **Date:** 2026-07-07
- **Deciders:** Founder (W3-M kickoff — approved plan, "start execution")

## Context
W3-M's charter (execution plan, Wave 3 §W3-M) makes Paddle the Merchant of
Record for the **Team** plan: a self-serve checkout upgrades an org, and Paddle
webhooks (`subscription.created/updated/canceled`, `transaction.completed`)
drive the org's **entitlement state** so the app can enforce the paid tier.

That entitlement state has to be **durable and org-scoped** — the paywall
(≤5 free tracked users, upgrade at the 6th) and the metering job both read
"is this org on Team, and for how many seats." No table at the W0-C freeze
holds it: `orgs` has no plan/subscription concept, and the `tracked_user`
metering primitive ([`tracked-user.ts`](../../src/contracts/tracked-user.ts))
only counts billable people — it says nothing about whether the org has *paid*.

`src/db/schema.ts` and `drizzle/**` are frozen paths, so even this additive,
charter-mandated table requires an ADR in the same PR (rule 1 / CI
`frozen-contracts` job). The `tracked_user` definition itself is **not** touched
— W3-M consumes it verbatim; the billed quantity stays exactly `tracked_user`
(review invariant b).

## Decision
Purely **additive** — no existing shape is modified. `tracked_user` semantics,
`forOrg`'s public API, the credential shape, and every existing fixture are
untouched.

### 1. `subscription_status` enum
`pgEnum("subscription_status", [...])` mirroring Paddle's subscription statuses:
`active`, `trialing`, `past_due`, `paused`, `canceled`. Effective entitlement is
**derived**, not stored: an org is on Team iff it has a subscription row whose
status grants access (`active | trialing | past_due`); everything else (incl. no
row at all) is **Personal / free**. Personal mode never needs a row.

### 2. `subscriptions` (org-scoped, one row per Paddle subscription)
`migration 0015_subscriptions.sql`. One row per Paddle subscription.
- `id`, `org_id` (not null), `paddle_subscription_id` (**globally unique** — the
  idempotency key for webhook upserts), `paddle_customer_id`, `status`
  (`subscription_status`), `price_id` (the Paddle price the org is on),
  `quantity` (int — seats last reported / confirmed by Paddle),
  `current_period_start`, `current_period_end` (nullable timestamps),
  `canceled_at` (null = not canceled), `paddle_occurred_at`, `created_at`,
  `updated_at`.
- **Simple FK** `org_id → orgs(id)` on delete cascade — consistent with sibling
  tables that anchor directly to the tenant root (`benchmark_consent`,
  `poll_heartbeats`); the composite `(org_id, parent_id)` FK pattern is only for
  child tables anchoring to a non-`orgs` parent. Plus the `unique(org_id, id)`
  anchor every org-scoped table carries, and an `index(org_id)`.
- **`paddle_occurred_at` is the event-time ordering key, distinct from
  `updated_at` (row-write time).** Paddle does not guarantee webhook delivery
  order, so the handler stores each event's `occurred_at` and the upsert applies
  an event only when it is *newer* than the stored one — a stale `active`
  arriving after a `canceled` cannot re-grant access. Entitlement resolution
  orders on `paddle_occurred_at`, so a later metering `quantity` write (which
  bumps `updated_at`, not `paddle_occurred_at`) never reorders the entitlement.
- The global unique on `paddle_subscription_id` is what makes the webhook
  handler's `onConflict` upsert idempotent; no `(org_id, paddle_subscription_id)`
  composite unique is added (it would be redundant — the subscription id is
  already globally unique).

### 3. Access split — org-scoped reads vs. one capability-style webhook write
New module `src/db/subscriptions.ts` (schema zone), mirroring the
invite/share-link precedent (ADR 0004, ADR 0008) so `forOrg` is **not** widened:
- `subscriptionsForOrg(db, orgId)` — the org-scoped surface used by the paywall,
  dashboard, and metering job: `current()` (effective entitlement),
  `get()`/`list()`, `updateQuantity()`. Every read/write filters on `org_id`.
- `applyPaddleSubscriptionEvent(db, { orgId, occurredAt, ... })` — the **single
  controlled write entry point** for the webhook handler. It is *not*
  session-scoped (the webhook arrives unauthenticated from Paddle, exactly like
  invite-token acceptance / `resolveShareToken`), but it is **not ambient
  cross-org access** either. `orgId` is taken from the Paddle event's validated
  custom-data passthrough (set at checkout), and the upsert is keyed on
  `paddle_subscription_id` with a two-part `ON CONFLICT … WHERE` guard:
  1. **`occurred_at` newer than stored** — out-of-order/duplicate deliveries
     converge (a stale event is a no-op), so entitlement can't flap.
  2. **`org_id` equals the passthrough** — a mismatched-passthrough event can
     never overwrite another org's row (defense-in-depth; `org_id` is never
     updated). When the guard skips, the stored row is returned unchanged.
  This is the third capability-style exception after invites (0004) and share
  tokens (0008); it is documented here so the tenant-isolation story stays "no
  *ambient* cross-org read/write," not "never."

### 4. Tenant-isolation sweep
`subscriptions` carries `org_id`, so `tests/tenant-isolation.test.ts`'s
completeness tripwire requires a `SCOPED_READS` entry — added via the factory
(`subscriptionsForOrg(db, orgA).list()`), exactly as invites/share-links are.

## Contracts affected
- `src/db/schema.ts` + `drizzle/0015_subscriptions.sql` — one new enum, one new
  table.
- New module `src/db/subscriptions.ts` (schema zone; org-scoped factory + the
  one controlled webhook-write entry point).
- `src/db/org-scope.ts`, `src/contracts/tracked-user.ts`, `src/lib/credentials.ts`,
  existing fixture shapes: **untouched**. New billing API routes
  (checkout/webhook/entitlement/portal) are **additions** to `src/contracts/api.ts`
  landing in later W3-M PRs, not a change to any frozen route.

## Workstreams to re-sync
- **W3-M (this chain):** PRs 2–5 (webhook, checkout, paywall, metering) build
  against this shape. The metering job reports `quantity = tracked_user` count
  (frozen W0-C) into this row's `quantity`; `contract-guardian` verifies the
  reported count equals the frozen definition.
- **W3-N (compliance):** entitlement/billing state is customer PII-adjacent data
  processed by Paddle as MoR — noted so the DPIA/ToS content references this
  table's shape rather than inventing another.
- **W3-O (hardening):** the webhook signature check + the `applyPaddleSubscription
  Event` capability write are attack surface for the security-review pass.

## Consequences
- **Pricing pivot recorded (deliberate, founder-approved).** The provisioned
  Paddle price is a **$2.00/user/mo list** + a **FOUNDER 50% recurring discount**
  (→ $1.00 effective for early adopters, sunset 2026-08-31). This diverges from
  the execution plan's *$3–5 list* example, but honors the invariant the plan
  actually froze: founder pricing is a **Paddle discount**, never a second list
  price. Price/product/discount IDs live in env config (sandbox + production
  pairs), never hard-coded, so the number is tunable without a schema change.
- Effective plan is **derived from status**, so there is no `plan` column to keep
  in sync with Paddle — one less thing that can drift. `past_due` still grants
  access (dunning grace); hard loss of access is `canceled`/`paused`.
- The webhook write is the third capability-token-style exception; like the other
  two it is a controlled, non-ambient entry point with a minimal surface, kept
  out of `forOrg` so the org-scoped query contract is not widened.
- Historical/canceled subscriptions are retained as rows (status transitions,
  `canceled_at`), giving an audit trail without a separate events table. Richer
  billing history (per-transaction ledger, invoices mirror) is a future ADR, not
  a widening of this one.
- **`subscription_status` is a closed enum** matching Paddle Billing's current
  subscription statuses. If Paddle introduces a new status, an unmapped value
  would fail the insert — so the **PR2 webhook handler owns status
  normalization/validation** (map/reject-and-log an unknown status rather than
  let it crash the write). Growing the enum later is an ADR, like every other
  frozen enum.
