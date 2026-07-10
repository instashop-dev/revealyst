# 0020 — Spend Governance: `budgets` table, `forOrg.budgets` CRUD, and budget API routes

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Founder
- **Workstream:** W4-V (Spend Governance)

## Context

Spec V3 §9 promotes Spend Governance from "context" to a completed module, delivering
the "basic budget alerts" promised (and never shipped) in V2 §9. The module needs:

1. An admin-set org **monthly spend budget** with configurable alert thresholds.
2. **In-app threshold alerts** when observed month-to-date spend crosses a threshold.
3. A **spend drill-down** by tool and model, honestly distinguishing vendor-reported
   from derived/estimated cost.
4. Budget get/set **API routes**.

Item (1) is durable per-org config, so it needs a new org-scoped table — a
frozen-schema change (`src/db/schema.ts` + `drizzle/**`) requiring an ADR. Items (2)
and (3) are **computed on read** from the existing `spend_cents` /
`spend_cents_estimated` / `model_tokens` `metric_records` — no new ingestion, no
background job, no persisted alert or spend state. Item (4) touches the frozen
`src/contracts/api.ts`, also ADR-gated. Email delivery of alerts is deliberately **not**
built (the product has no email-sending capability, ADR 0004); alerts are in-app only.

## Decision

### New table `budgets` (frozen-schema change)

One row per org (`unique(org_id)`), cascade-deleted with the org:

- `id uuid pk`
- `org_id uuid not null → orgs(id) on delete cascade`
- `monthly_limit_cents integer not null` — USD cents, matching `metric_records.spend_cents`
- `alert_thresholds jsonb not null default [50, 80, 100]` — integer percent crossings
- `created_at`, `updated_at`
- `unique(org_id, id)` (D1a composite-FK anchor), `unique(org_id)` (one budget per org,
  the `set()` upsert target), `check(monthly_limit_cents > 0)`

Migration: `drizzle/0021_budgets.sql` (offline `drizzle-kit generate`). The `budgets`
table is registered in the tenant-isolation sweep (`tests/tenant-isolation.test.ts`
`SCOPED_READS` entry `budgets.get` + a non-vacuous B-org seed row), satisfying the
completeness tripwire.

### `forOrg.budgets` repository methods (additive to the frozen public API)

- `budgets.get()` — the org's single budget row (or undefined), `eq(orgId)`-guarded.
- `budgets.set({ monthlyLimitCents, alertThresholds? })` — upsert on `budgets_org_uq`.
- `budgets.clear()` — delete the org's budget (governance off), idempotent.

All org-scoped like every existing method; no existing signatures changed.

### API routes (additive to frozen `src/contracts/api.ts`)

- `GET /api/budget` (`budgetGet`) — budget config + month-to-date spend
  (vendor-reported and derived kept **separate**, never blended) + computed alert.
- `PUT /api/budget` (`budgetSet`) — create/replace the budget; thresholds default when
  omitted.

Both are **admin-only** and gated by the default free-band paywall (budget data is org
data behind the paywall; no `allowOverFreeBand` opt-out — a blocked org has no dashboard
either). The spend and crossed threshold in the GET response are derived at read
time, never stored. The dashboard budget banner is likewise **admin-only** (the budget
limit is admin-configured governance, not shown to line members); the read is skipped
for non-admins.

## Honesty rules (invariant b)

- **The budget threshold is measured against vendor-reported spend (`spend_cents`)
  only.** Derived (`spend_cents_estimated`) cost is shown alongside, labeled, and
  **never summed into the threshold** — because it can OVERLAP the authoritative
  figure: the Anthropic cost report's `spend_cents` already includes the Claude Code
  API usage that `spend_cents_estimated` separately estimates
  (`src/connectors/anthropic/normalize.ts`), so blending would double-count and could
  fire a fabricated "over budget" alert. Vendor-reported spend across *different*
  vendors is additive (each vendor's own billed cost) and summed normally. The
  trade-off: an org whose only spend signal is a derived estimate (e.g.
  `claude_code_local` local logs) won't trip the budget — the honest limitation of not
  having authoritative spend for that tool, preferred over a possibly-double-counted
  false alarm.
- No connected vendor reports **per-model spend** today, so the model drill-down is by
  **token volume** (from `model_tokens`), explicitly not a dollar split — the gap is
  surfaced, never estimated into a fabricated per-model cost.
- Alerts are described as **observed-burn** threshold crossings over day-grain,
  restate-able vendor data — never marketed as a "before overspend" guarantee (§9).
- Zero spend crosses no positive threshold, so a no-data org raises no alert (no floor).

## Contracts affected

- `src/db/schema.ts` + `drizzle/0021_budgets.sql` — new org-scoped table (additive).
- `src/db/org-scope.ts` public API — additive `budgets` methods only.
- `src/contracts/api.ts` — additive `budgetGet` / `budgetSet` route contracts.

## Workstreams to re-sync

None. All changes are additive; no workstream built against the absence of these.

## Consequences

- Spend Governance ships as a compute-on-read module: the only persisted state is the
  budget config, so there is no alert-acknowledgement table to reconcile and no
  recompute job. Alerts recompute every dashboard/`/spend` load.
- A future dollar-true per-model breakdown (or Copilot AI-credit → cents conversion)
  would extend the drill-down, not this table.
- Migration `0021` may collide with a parallel W4 workstream's migration number; the
  orchestrator resolves numbering at merge time.
