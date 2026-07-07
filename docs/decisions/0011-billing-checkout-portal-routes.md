# 0011 — billing checkout + portal API routes (additive)

- **Status:** Proposed
- **Date:** 2026-07-07
- **Deciders:** Founder (W3-M PR3 kickoff — approved plan, Plan B)

## Context
W3-M PR3 adds the two things the merged subscriptions machinery (ADR 0009) still
lacks: a way to **start** a Team subscription (Paddle Checkout overlay) and a way
to **manage** one (Paddle hosted customer portal). Both need a small server API
the frontend calls:

1. `POST /api/billing/checkout` — creates a Paddle **transaction server-side**
   with `custom_data.org_id` bound from the session, then returns its
   `transactionId` for the overlay. This is the fix for the attribution gap the
   PR2 adversarial review flagged: because the transaction (and its `org_id`) is
   created with the Paddle **API key** on the server, a client cannot name
   another org — it only receives an opaque `transactionId`.
2. `GET /api/billing/portal` — creates a fresh authenticated Paddle customer
   portal session and returns its links (invoices, payment method, cancel).

`src/contracts/api.ts` is a frozen path and these are frontend-facing typed
routes (the `agentIngest` convention keeps such routes in the registry so W1-S's
contract tests can bind to them), so the two additions require this ADR in the
same PR (rule 1 / CI `frozen-contracts`). ADR 0009 already anticipated them.

## Decision
Purely **additive** — two new entries in `apiRoutes`, no existing shape changed.

### 1. `billingCheckout` — `POST /api/billing/checkout`
- Request: **none** (`request: null`). The org is taken from the session
  (`appContext().org`), never from the body — the whole point of the
  server-transaction approach. Admin-only (`handleApi({ adminOnly: true })`);
  409 if the org already has any non-canceled subscription (active/trialing/
  past_due/paused — a paused sub is resumable, so a second checkout would
  double-bill); only a fully canceled org may re-subscribe.
- Response: `{ transactionId, clientToken, environment }` — the opaque Paddle
  transaction id plus the **client-side** token + environment the browser needs
  to open the overlay (`Paddle.Setup` / `Paddle.Checkout.open`). The server API
  key is never sent to the client.

### 2. `billingPortal` — `GET /api/billing/portal`
- Request: **none**. Resolves the caller org's stored Paddle `customer_id`
  (`subscriptionsForOrg(...).current().subscription`); 404 if the org has no
  subscription. Admin-only.
- Response: `{ overviewUrl, cancelUrl, updatePaymentUrl }` from a **freshly
  created** portal session (`POST /customers/{id}/portal-sessions`, passing the
  org's subscription id for the deep links). Paddle portal sessions are
  temporary, unguessable, and auto-expiring, so they are generated per request
  and **never stored or cached**.

### 3. Paddle configuration (env, not schema)
New Worker secrets / `.dev.vars` values, resolved per request (never
module-cached — Workers rule): `PADDLE_ENVIRONMENT` (`sandbox`|`production`,
selects the API base), `PADDLE_API_KEY` (server-only), `PADDLE_CLIENT_TOKEN`
(client-safe), `PADDLE_PRICE_ID`, `PADDLE_DISCOUNT_ID` (FOUNDER). The client
config resolver exposes only the client-safe values; the server resolver adds
the API key and is used only in route handlers.

## Contracts affected
- `src/contracts/api.ts` — two additive route entries (`billingCheckout`,
  `billingPortal`). No frozen `tracked_user`, schema, org-scope, or credential
  change. The Paddle API client (`src/lib/paddle.ts`) and orchestration
  (`src/lib/billing.ts`) are new non-frozen modules; the routes are new files.

## Workstreams to re-sync
- **W3-M PR4 (paywall):** reads the same `subscriptionsForOrg(...).current()`
  entitlement the billing page shows; the upgrade CTA it gates on links here.
- **W3-M PR5 (metering):** reuses `src/lib/paddle.ts`'s config + API client to
  report `quantity` (the frozen `tracked_user` count) to Paddle.
- **W3-N (compliance):** the checkout collects payment via Paddle as MoR; the
  ToS/DPA prose should reference this flow, not invent another.

## Consequences
- The initial checkout `quantity` is seeded from the org's current
  `tracked_user` count (min 1); PR5's metering keeps it in sync each cycle. The
  billed primitive is unchanged — this only sets the starting seat count.
- `custom_data.org_id` is authoritative only because it is set server-side under
  the API key; the PR2 webhook still validates the id + org existence as
  defense-in-depth.
- Portal sessions are never persisted, so there is no stale-link surface and no
  new table — the `subscriptions.paddle_customer_id` from PR2 is the only stored
  input.
- Richer billing UI (per-invoice list in-app, seat history) is a future PR, not
  a widening of these two routes.
