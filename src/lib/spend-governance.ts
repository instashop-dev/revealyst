import type { forOrg } from "../db/org-scope";
import { vendorLabel } from "./vendor-labels";

// Spend Governance core (W4-V, ADR 0020). Pure aggregation + threshold logic
// over the org-scoped repository (`forOrg`) — never `createDb`, never a raw
// table. Two honesty invariants govern every number here (review invariant b):
//  - spend_cents is vendor-reported; spend_cents_estimated is derived. The
//    budget THRESHOLD is measured against vendor-reported spend only — derived
//    is shown alongside but never summed in, because it can OVERLAP the billed
//    figure (Anthropic's cost report already includes the Claude Code usage the
//    estimate separately models — see readMonthToDateSpend), so blending would
//    double-count. Each drill-down row carries the two separately and labels them.
//  - no connected vendor reports per-MODEL spend today, so the model drill-down
//    is by token volume (vendor-reported), explicitly NOT a dollar split. The
//    absence is surfaced as a gap, never estimated into a fabricated cost.

type OrgScope = ReturnType<typeof forOrg>;
export type BudgetRow = NonNullable<Awaited<ReturnType<OrgScope["budgets"]["get"]>>>;

// Structural minimums the pure aggregators need — satisfied by metric_records
// rows and connection rows, but decoupled from their full types so the logic
// is unit-testable without a DB.
type SpendRow = { connectionId: string; value: number };
type ModelRow = { dim: string; value: number };
type ConnectionMeta = { id: string; vendor: string; displayName: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Default percent-of-budget crossings that raise an in-app alert. Single source
 * of truth for the UI fallback (before a budget is saved) — the DB column
 * default in src/db/schema.ts mirrors this literal (schema can't import lib
 * code without a circular dependency; keep the two in sync).
 */
export const DEFAULT_ALERT_THRESHOLDS = [50, 80, 100];

/** The UTC calendar day the month-to-date window is anchored on. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The UTC month-to-date window for a given "today" (YYYY-MM-DD): first calendar
 * day of that month through today, inclusive. This is the window observed spend
 * is summed over for the budget — a record dated in a prior month never counts,
 * and on the 1st the window is a single day.
 */
export function monthToDateWindow(today: string): { from: string; to: string } {
  if (!DAY_RE.test(today)) {
    throw new Error(`monthToDateWindow expects YYYY-MM-DD, got "${today}"`);
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * Budget + observed month-to-date spend — the ONE core the alert, the API, and
 * the /spend view all build on, so the definition of "observed spend" lives in
 * a single place. Vendor-reported (spend_cents) and derived
 * (spend_cents_estimated) are summed SEPARATELY and never blended for the
 * threshold: derived estimates can OVERLAP authoritative figures (the Anthropic
 * cost report's spend_cents already includes the Claude Code API usage that
 * spend_cents_estimated separately estimates — src/connectors/anthropic/
 * normalize.ts), so adding them would double-count. The budget threshold is
 * measured against vendor-reported spend only (see readBudgetAlert /
 * readSpendGovernance); derived spend is surfaced alongside, labeled, and never
 * added to the threshold (invariant b). The raw rows are returned so the
 * drill-down can group them without re-querying. One Promise.all (depth 1).
 */
export async function readMonthToDateSpend(scope: OrgScope, today: string) {
  const window = monthToDateWindow(today);
  const [budget, reportedRows, estimatedRows] = await Promise.all([
    scope.budgets.get(),
    scope.metrics.records({ metricKey: "spend_cents", ...window }),
    scope.metrics.records({ metricKey: "spend_cents_estimated", ...window }),
  ]);
  return {
    budget,
    window,
    reportedRows,
    estimatedRows,
    reportedCents: sumValues(reportedRows),
    estimatedCents: sumValues(estimatedRows),
  };
}

/**
 * The budget alert for a budget vs. vendor-reported month-to-date spend, or
 * null when there is no budget or nothing is crossed. Measured against
 * vendor-reported cents only — see readMonthToDateSpend for why derived spend
 * is never blended in.
 */
export function budgetAlertFor(
  budget: { monthlyLimitCents: number; alertThresholds: number[] } | undefined,
  reportedCents: number,
): BudgetAlert | null {
  if (!budget) return null;
  return evaluateBudgetAlert({
    monthlyLimitCents: budget.monthlyLimitCents,
    alertThresholds: budget.alertThresholds,
    spentCents: reportedCents,
  });
}

function sumValues(rows: Array<{ value: number }>): number {
  return rows.reduce((total, row) => total + row.value, 0);
}

/** The alert state for one budget vs. observed month-to-date spend. */
export type BudgetAlert = {
  /** Highest configured threshold percent the observed spend has crossed. */
  crossedThreshold: number;
  /** Observed spend as a percent of the monthly limit (unrounded). */
  pctUsed: number;
  /** At or over 100% of budget. */
  overBudget: boolean;
};

/**
 * Evaluates the in-app budget alert: the HIGHEST configured threshold that
 * vendor-reported month-to-date spend has crossed, or null when nothing is
 * crossed (incl. the honest no-spend case: 0 spend crosses no positive
 * threshold, so no alert). A threshold is crossed at `>=` so an exact 50%/100%
 * boundary fires. Never floors or fabricates — a non-positive limit yields no
 * alert.
 */
export function evaluateBudgetAlert(input: {
  monthlyLimitCents: number;
  alertThresholds: number[];
  spentCents: number;
}): BudgetAlert | null {
  const { monthlyLimitCents, alertThresholds, spentCents } = input;
  if (monthlyLimitCents <= 0) return null;
  const pctUsed = (spentCents / monthlyLimitCents) * 100;
  let crossed: number | null = null;
  for (const threshold of alertThresholds) {
    if (pctUsed >= threshold && (crossed === null || threshold > crossed)) {
      crossed = threshold;
    }
  }
  if (crossed === null) return null;
  return { crossedThreshold: crossed, pctUsed, overBudget: pctUsed >= 100 };
}

/** Per-tool spend, billed and derived kept separate (honesty by shape). */
export type ToolSpend = {
  connectionId: string;
  vendor: string;
  vendorLabel: string;
  displayName: string;
  /** vendor-reported cost (spend_cents). */
  reportedCents: number;
  /** derived/estimated cost (spend_cents_estimated). */
  estimatedCents: number;
};

/**
 * Groups spend by connection (tool). `reportedRows` come from spend_cents
 * (vendor-reported), `estimatedRows` from spend_cents_estimated (derived) —
 * they are summed per connection but stay in separate fields so the UI can
 * label each. Connections with any spend are included; sorted by total spend
 * descending. A connection id with spend but no matching connection row (e.g. a
 * since-deleted connection) is still shown, labeled by its raw vendor if known.
 */
export function summarizeSpendByTool(
  reportedRows: SpendRow[],
  estimatedRows: SpendRow[],
  connections: ConnectionMeta[],
): ToolSpend[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  const acc = new Map<string, ToolSpend>();
  const ensure = (connectionId: string): ToolSpend => {
    let row = acc.get(connectionId);
    if (!row) {
      const conn = byId.get(connectionId);
      row = {
        connectionId,
        vendor: conn?.vendor ?? "unknown",
        vendorLabel: conn ? vendorLabel(conn.vendor) : "Unknown tool",
        displayName: conn?.displayName ?? "Removed connection",
        reportedCents: 0,
        estimatedCents: 0,
      };
      acc.set(connectionId, row);
    }
    return row;
  };
  for (const r of reportedRows) ensure(r.connectionId).reportedCents += r.value;
  for (const r of estimatedRows) ensure(r.connectionId).estimatedCents += r.value;
  return [...acc.values()].sort(
    (a, b) =>
      b.reportedCents + b.estimatedCents - (a.reportedCents + a.estimatedCents),
  );
}

/**
 * Per-model TOKEN volume (vendor-reported), NOT spend. Derived from the
 * model_tokens metric's `dim` ("model=<id>"). Rows with a non-model dim are
 * ignored. Sorted by token volume descending. Consumers must label this as
 * token volume and surface that per-model cost is not vendor-reported — never
 * present these as a dollar breakdown (invariant b).
 */
export type ModelVolume = { model: string; tokens: number; sharePct: number };

export function summarizeModelVolume(modelTokenRows: ModelRow[]): ModelVolume[] {
  const byModel = new Map<string, number>();
  for (const r of modelTokenRows) {
    if (!r.dim.startsWith("model=")) continue;
    const model = r.dim.slice("model=".length) || "(unspecified)";
    byModel.set(model, (byModel.get(model) ?? 0) + r.value);
  }
  const total = [...byModel.values()].reduce((sum, v) => sum + v, 0);
  return [...byModel.entries()]
    .map(([model, tokens]) => ({
      model,
      tokens,
      sharePct: total > 0 ? (tokens / total) * 100 : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** The composed spend-governance view for the /spend page. */
export type SpendGovernanceView = {
  budget: BudgetRow | undefined;
  window: { from: string; to: string };
  /** vendor-reported spend (spend_cents) — what the budget is measured against. */
  reportedCents: number;
  /** derived/estimated spend (spend_cents_estimated) — shown, never summed in. */
  estimatedCents: number;
  alert: BudgetAlert | null;
  byTool: ToolSpend[];
  byModel: ModelVolume[];
};

/**
 * Reads the full spend-governance view for one org over the month-to-date
 * window. Every read goes through the org-scoped repository. The shared
 * month-to-date core, the model-token read, and the connection list all fire
 * concurrently (the core starts its own queries before awaiting), so the whole
 * view is round-trip depth 1. `today` is caller-supplied (YYYY-MM-DD, UTC) so
 * the window is deterministic and testable.
 */
export async function readSpendGovernance(
  scope: OrgScope,
  today: string,
): Promise<SpendGovernanceView> {
  const window = monthToDateWindow(today);
  const [mtd, modelTokenRows, connections] = await Promise.all([
    readMonthToDateSpend(scope, today),
    scope.metrics.records({ metricKey: "model_tokens", ...window }),
    scope.connections.list(),
  ]);

  return {
    budget: mtd.budget,
    window: mtd.window,
    reportedCents: mtd.reportedCents,
    estimatedCents: mtd.estimatedCents,
    alert: budgetAlertFor(mtd.budget, mtd.reportedCents),
    byTool: summarizeSpendByTool(mtd.reportedRows, mtd.estimatedRows, connections),
    byModel: summarizeModelVolume(modelTokenRows),
  };
}

/**
 * The lean month-to-date alert read for the dashboard banner: budget +
 * vendor-reported spend + computed alert only (no tool/model breakdown). Kept
 * separate from the full view so the hot dashboard path stays a shallow parallel
 * read. Returns null when no budget is set OR no threshold is crossed — the
 * banner renders nothing rather than an empty shell.
 */
export type BudgetAlertSummary = {
  alert: BudgetAlert;
  /** vendor-reported spend the threshold was measured against. */
  reportedCents: number;
  monthlyLimitCents: number;
};

export async function readBudgetAlert(
  scope: OrgScope,
  today: string,
): Promise<BudgetAlertSummary | null> {
  const { budget, reportedCents } = await readMonthToDateSpend(scope, today);
  const alert = budgetAlertFor(budget, reportedCents);
  if (!budget || !alert) return null;
  return { alert, reportedCents, monthlyLimitCents: budget.monthlyLimitCents };
}

/**
 * The role-gated dashboard read: the budget limit is admin-configured
 * governance data (like /billing), so members never see the banner — and for
 * them the DB read is skipped entirely, not fetched-then-hidden. The ONE gate
 * both dashboard views (TeamOverview and PersonalSelfView) call, so they can't
 * drift: a personal-kind org can have an invited member (org-of-one machinery
 * is identical to Team), so the personal view needs this gate exactly as much
 * as the team view does.
 */
export async function readBudgetAlertForRole(
  scope: OrgScope,
  role: "admin" | "member",
  today: string,
): Promise<BudgetAlertSummary | null> {
  if (role !== "admin") return null;
  return readBudgetAlert(scope, today);
}
