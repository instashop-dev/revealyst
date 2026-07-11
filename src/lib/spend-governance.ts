import type { forOrg } from "../db/org-scope";
import { addUtcDays } from "./raw-metric-delta";
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

// ─── Run-rate projection (F1.2 / M2) ───

/**
 * Straight-line month-end projection from vendor-reported month-to-date spend
 * (M2). DERIVED, not measured: it assumes the rest of the month spends at the
 * same daily rate as the month so far — surfaced with the "derived,
 * straight-line" confidence label, never presented as a bill. Returns null
 * when there is no reported spend yet (never projects a month-end figure from
 * nothing — G4 honest empty). Uses vendor-reported cents only; estimated spend
 * never feeds the projection (invariant b).
 */
export type SpendProjection = {
  /** Projected end-of-month vendor-reported spend, in cents. */
  projectedMonthEndCents: number;
  /** The reported month-to-date spend the projection extrapolates from. */
  reportedMtdCents: number;
  /** 1-based day of the month `today` falls on (days elapsed incl. today). */
  dayOfMonth: number;
  /** Total calendar days in `today`'s month. */
  daysInMonth: number;
};

export function projectMonthEndSpend(
  reportedMtdCents: number,
  today: string,
): SpendProjection | null {
  if (!DAY_RE.test(today)) {
    throw new Error(`projectMonthEndSpend expects YYYY-MM-DD, got "${today}"`);
  }
  if (reportedMtdCents <= 0) return null; // no reported spend → don't project
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)); // 1-based
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const projectedMonthEndCents = Math.round(
    (reportedMtdCents / dayOfMonth) * daysInMonth,
  );
  return { projectedMonthEndCents, reportedMtdCents, dayOfMonth, daysInMonth };
}

// ─── Cost-per-unit (F1.2 / M5) ───

/**
 * Org-level cost-per-unit from vendor-reported spend (M5). RATIO HONESTY: a
 * ratio needs real data on BOTH sides — if reported spend is zero (no billed
 * rows) OR the unit count is zero, the ratio is OMITTED (null), never floored
 * or divided-by-zero. Computed from vendor-reported cents only; estimated
 * spend never participates (invariant b). `units` is a summed count (active
 * subject-days, or prompt volume) for the same window as `reportedCents`.
 */
export type CostPerUnit = {
  reportedCents: number;
  units: number;
  /** Vendor-reported cents per unit (spend ÷ units). */
  centsPerUnit: number;
};

export function costPerUnit(
  reportedCents: number,
  units: number,
): CostPerUnit | null {
  if (reportedCents <= 0 || units <= 0) return null;
  return { reportedCents, units, centsPerUnit: reportedCents / units };
}

// ─── Model-mix trend (F1.2 / M7) ───

/** UTC Monday (YYYY-MM-DD) of the ISO week a day falls in. */
function isoWeekStart(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

type ModelTrendRow = { dim: string; day: string; value: number };

export type ModelWeekShare = { model: string; tokens: number; sharePct: number };
export type ModelWeekBucket = { weekStart: string; totalTokens: number; models: ModelWeekShare[] };

/** A per-model share shift between the first and last populated COMPLETE week
 * of the trend window — "Opus share 31% → 44%". Directional token-volume mix,
 * NOT a dollar split (Revealyst doesn't ingest a per-model dollar split). */
export type ModelShareShift = {
  model: string;
  firstWeekSharePct: number;
  lastWeekSharePct: number;
  /** lastWeekSharePct − firstWeekSharePct (percentage points). */
  shiftPct: number;
  totalTokens: number;
};

export type ModelMixTrend =
  | { available: false }
  | { available: true; weeks: ModelWeekBucket[]; shifts: ModelShareShift[] };

/**
 * Multi-window extension of `summarizeModelVolume` (M7): buckets model_tokens
 * rows into ISO weeks and reports, per model, the share shift between the
 * first and last populated COMPLETE week. Same honesty posture as
 * `summarizeModelVolume` — this is vendor-reported TOKEN volume, never a
 * per-model dollar split. Rows with a non-`model=` dim are ignored.
 *
 * COMPLETE WEEKS ONLY: a week counts only when the window covers ALL seVEN of
 * its days (weekStart ≥ window.from AND weekStart+6 ≤ window.to). Unless the
 * window happens to align on Monday–Sunday, its endpoint weeks are PARTIAL —
 * a lone Monday-morning request would otherwise read as that week's entire
 * mix ("opus 50% → 100%"), a fabricated shift from a one-day sample. Partial
 * leading/trailing weeks (and any stray rows outside the window) are dropped.
 * Fewer than two populated complete weeks → `available: false` (a "trend"
 * needs two full points; G4 honest empty). A model absent from a counted week
 * counts as 0% that week — that IS the shift the surface is meant to show,
 * not a gap.
 */
export function summarizeModelMixTrend(
  rows: ModelTrendRow[],
  window: { from: string; to: string },
): ModelMixTrend {
  const isCompleteWeek = (weekStart: string) =>
    weekStart >= window.from && addUtcDays(weekStart, 6) <= window.to;
  const byWeek = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.dim.startsWith("model=")) continue;
    if (r.day < window.from || r.day > window.to) continue;
    const week = isoWeekStart(r.day);
    if (!isCompleteWeek(week)) continue;
    const model = r.dim.slice("model=".length) || "(unspecified)";
    let models = byWeek.get(week);
    if (!models) {
      models = new Map();
      byWeek.set(week, models);
    }
    models.set(model, (models.get(model) ?? 0) + r.value);
  }
  const weekKeys = [...byWeek.keys()].sort();
  if (weekKeys.length < 2) return { available: false };

  const weeks: ModelWeekBucket[] = weekKeys.map((weekStart) => {
    const models = byWeek.get(weekStart)!;
    const totalTokens = [...models.values()].reduce((a, b) => a + b, 0);
    return {
      weekStart,
      totalTokens,
      models: [...models.entries()]
        .map(([model, tokens]) => ({
          model,
          tokens,
          sharePct: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens),
    };
  });

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const shareIn = (week: ModelWeekBucket, model: string) =>
    week.models.find((m) => m.model === model)?.sharePct ?? 0;
  const totalsByModel = new Map<string, number>();
  for (const week of weeks) {
    for (const m of week.models) {
      totalsByModel.set(m.model, (totalsByModel.get(m.model) ?? 0) + m.tokens);
    }
  }
  const shifts: ModelShareShift[] = [...totalsByModel.entries()]
    .map(([model, totalTokens]) => {
      const firstWeekSharePct = shareIn(first, model);
      const lastWeekSharePct = shareIn(last, model);
      return {
        model,
        firstWeekSharePct,
        lastWeekSharePct,
        shiftPct: lastWeekSharePct - firstWeekSharePct,
        totalTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return { available: true, weeks, shifts };
}

/** The trailing window the model-mix trend buckets into weeks. Eight weeks
 * gives enough points for a share-shift read without pulling unbounded
 * history. */
export const MODEL_TREND_DAYS = 56;

/** Trailing MODEL_TREND_DAYS window ending at YESTERDAY (today − 1): `today`
 * is a partial UTC day mid-ingestion and must not feed a trend endpoint. The
 * complete-week filter in summarizeModelMixTrend then drops any remaining
 * partial leading/trailing ISO weeks inside this window. */
export function modelTrendWindow(today: string): { from: string; to: string } {
  if (!DAY_RE.test(today)) {
    throw new Error(`modelTrendWindow expects YYYY-MM-DD, got "${today}"`);
  }
  const to = addUtcDays(today, -1);
  return { from: addUtcDays(to, -(MODEL_TREND_DAYS - 1)), to };
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
  /** M2: derived straight-line month-end projection, or null when there's no
   * reported spend to project from. */
  projection: SpendProjection | null;
  /** M5: vendor-reported cost per active subject-day, or null (ratio honesty:
   * either side missing → omitted). */
  costPerActiveDay: CostPerUnit | null;
  /** M5: vendor-reported cost per prompt, or null when either side is missing. */
  costPerPrompt: CostPerUnit | null;
  /** M7: model-mix share-shift trend over a trailing multi-week window. */
  modelMixTrend: ModelMixTrend;
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
  const trendWindow = modelTrendWindow(today);
  // One flat Promise.all (round-trip depth 1). The M5 unit denominators
  // (active_day, prompts) share the MTD window with reported spend so the
  // ratio's two sides cover the same period; the M7 trend pulls model_tokens
  // over a longer trailing window (a share SHIFT needs multiple weeks, which
  // the month-to-date window can't supply early in a month).
  const [mtd, modelTokenRows, connections, activeDayRows, promptRows, modelTrendRows] =
    await Promise.all([
      readMonthToDateSpend(scope, today),
      scope.metrics.records({ metricKey: "model_tokens", ...window }),
      scope.connections.list(),
      scope.metrics.records({ metricKey: "active_day", ...window }),
      scope.metrics.records({ metricKey: "prompts", ...window }),
      scope.metrics.records({ metricKey: "model_tokens", ...trendWindow }),
    ]);

  return {
    budget: mtd.budget,
    window: mtd.window,
    reportedCents: mtd.reportedCents,
    estimatedCents: mtd.estimatedCents,
    alert: budgetAlertFor(mtd.budget, mtd.reportedCents),
    byTool: summarizeSpendByTool(mtd.reportedRows, mtd.estimatedRows, connections),
    byModel: summarizeModelVolume(modelTokenRows),
    projection: projectMonthEndSpend(mtd.reportedCents, today),
    costPerActiveDay: costPerUnit(mtd.reportedCents, sumValues(activeDayRows)),
    costPerPrompt: costPerUnit(mtd.reportedCents, sumValues(promptRows)),
    modelMixTrend: summarizeModelMixTrend(modelTrendRows, trendWindow),
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
