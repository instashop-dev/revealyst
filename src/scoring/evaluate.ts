import {
  lowestAttribution,
  type AttributionLevel,
} from "../contracts/attribution";
import type {
  ScoreAggregation,
  ScoreComponent,
  ScoreComponentBreakdown,
} from "../contracts/scores";
import { daysInPeriod, type Period } from "./periods";

// The W1-F evaluation core: a pure, deterministic function from (definition
// components, metric rows, period) to a score. Components are DATA with the
// closed aggregation vocabulary frozen in src/contracts/scores.ts — no DSL,
// no per-tenant expressions (tripwire). All I/O lives in recompute.ts.

/** One metric_records row, reduced to what evaluation needs. Callers have
 * already filtered rows to the subject set being scored. */
export type EngineRow = {
  subjectId: string;
  metricKey: string;
  day: string;
  dim: string;
  value: number;
  attribution: AttributionLevel;
};

export type EvaluationResult = {
  /** Weighted 0..100 score (weights sum to 1, each component clamped). */
  value: number;
  components: ScoreComponentBreakdown;
  /** Weakest attribution across every row any component consumed —
   * degraded inputs are surfaced, never laundered (frozen propagation rule). */
  attribution: AttributionLevel;
};

/** numeric(10,4) is the persisted precision; rounding here keeps the stored
 * value, the jsonb breakdown, and test expectations byte-identical. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function aggregate(
  rows: EngineRow[],
  aggregation: ScoreAggregation,
  period: Period,
): number {
  switch (aggregation) {
    case "sum":
      return rows.reduce((total, r) => total + r.value, 0);
    case "avg_per_day":
      return (
        rows.reduce((total, r) => total + r.value, 0) / daysInPeriod(period)
      );
    case "active_days":
      // Distinct days with a row, unioned across the subject set — a team
      // active on one day via two subjects is active one day, not two.
      return new Set(rows.map((r) => r.day)).size;
    case "distinct_dims":
      return new Set(rows.filter((r) => r.dim !== "").map((r) => r.dim)).size;
  }
}

function normalize(raw: number, min: number, max: number): number {
  if (max === min) {
    // Degenerate range frozen into a definition version; clamp rather than
    // divide by zero so evaluation stays total.
    return raw >= max ? 100 : 0;
  }
  const fraction = (raw - min) / (max - min);
  return Math.min(Math.max(fraction, 0), 1) * 100;
}

/** Metric keys a component reads (1 for a plain source, 2 for a ratio). */
export function componentMetricKeys(component: ScoreComponent): string[] {
  if ("metric" in component) {
    return [component.metric];
  }
  return [
    component.ratio.numerator.metric,
    component.ratio.denominator.metric,
  ];
}

/**
 * Evaluates one definition for one subject set over one period.
 *
 * `rowsByMetric` maps metric key → the subject set's rows within the period.
 * Returns null when no component consumed any row: a subject with zero
 * signal gets no score row at all — absence of data is never scored as 0.
 */
export function evaluateDefinition(
  components: ScoreComponent[],
  rowsByMetric: ReadonlyMap<string, EngineRow[]>,
  period: Period,
): EvaluationResult | null {
  const breakdown: ScoreComponentBreakdown = {};
  const consumed: AttributionLevel[] = [];
  let value = 0;

  for (const component of components) {
    let raw: number;
    if ("metric" in component) {
      const rows = rowsByMetric.get(component.metric) ?? [];
      raw = aggregate(rows, component.aggregation, period);
      consumed.push(...rows.map((r) => r.attribution));
    } else {
      const numeratorRows =
        rowsByMetric.get(component.ratio.numerator.metric) ?? [];
      const denominatorRows =
        rowsByMetric.get(component.ratio.denominator.metric) ?? [];
      const numerator = aggregate(
        numeratorRows,
        component.ratio.numerator.aggregation,
        period,
      );
      const denominator = aggregate(
        denominatorRows,
        component.ratio.denominator.aggregation,
        period,
      );
      // Zero (or absent) denominator → raw 0: an honest floor, never NaN.
      raw = denominator === 0 ? 0 : numerator / denominator;
      consumed.push(
        ...numeratorRows.map((r) => r.attribution),
        ...denominatorRows.map((r) => r.attribution),
      );
    }

    const normalized = round4(
      normalize(raw, component.normalization.min, component.normalization.max),
    );
    const contribution = round4(normalized * component.weight);
    breakdown[component.key] = {
      raw: round4(raw),
      normalized,
      weight: component.weight,
      contribution,
    };
    value += contribution;
  }

  if (consumed.length === 0) {
    return null;
  }

  return {
    value: round4(value),
    components: breakdown,
    attribution: lowestAttribution(consumed),
  };
}
