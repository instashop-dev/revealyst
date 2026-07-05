import {
  lowestAttribution,
  type AttributionLevel,
} from "../../src/contracts/attribution";
import {
  scoreComponentBreakdownSchema,
  scoreComponentsSchema,
  type ScoreComponentBreakdown,
} from "../../src/contracts/scores";

// W1-S reference score evaluator — a deterministic stand-in that keeps the
// E2E's score step runnable before W1-F's engine merges to main (rule 3).
// It evaluates the frozen scoreComponentsSchema vocabulary exactly as the
// contract documents (closed aggregations, linear 0..100 normalization,
// weighted sum, LOWEST-attribution propagation) and self-validates its
// breakdown against the frozen zod shape. tests/harness/seams.ts swaps in
// the real engine when W1-F lands.

export type ScoredRecord = {
  metricKey: string;
  day: string;
  dim: string;
  value: number;
  attribution: AttributionLevel;
};

export type ScoreEvaluation = {
  value: number;
  components: ScoreComponentBreakdown;
  attribution: AttributionLevel;
};

type MetricSource = { metric: string; aggregation: string };

function inclusiveDays(period: { start: string; end: string }): number {
  const ms =
    Date.parse(`${period.end}T00:00:00Z`) -
    Date.parse(`${period.start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function evaluateScore(
  componentsRaw: unknown,
  records: ScoredRecord[],
  period: { start: string; end: string },
): ScoreEvaluation {
  const components = scoreComponentsSchema.parse(componentsRaw);
  const days = inclusiveDays(period);
  const usedAttributions: AttributionLevel[] = [];

  function aggregate(source: MetricSource): number {
    const rows = records.filter((r) => r.metricKey === source.metric);
    usedAttributions.push(...rows.map((r) => r.attribution));
    switch (source.aggregation) {
      case "sum":
        return rows.reduce((s, r) => s + r.value, 0);
      case "avg_per_day":
        return rows.reduce((s, r) => s + r.value, 0) / days;
      case "active_days":
        return new Set(rows.map((r) => r.day)).size;
      case "distinct_dims":
        return new Set(rows.map((r) => r.dim)).size;
      default:
        throw new Error(`unknown aggregation '${source.aggregation}'`);
    }
  }

  const breakdown: ScoreComponentBreakdown = {};
  let value = 0;
  for (const c of components) {
    const raw =
      "ratio" in c
        ? ratio(aggregate(c.ratio.numerator), aggregate(c.ratio.denominator))
        : aggregate(c);
    const span = c.normalization.max - c.normalization.min;
    const normalized = clamp(((raw - c.normalization.min) / span) * 100, 0, 100);
    const contribution = normalized * c.weight;
    breakdown[c.key] = { raw, normalized, weight: c.weight, contribution };
    value += contribution;
  }

  if (usedAttributions.length === 0) {
    throw new Error(
      "no metric records fed any component — refusing to emit a score from nothing (invariant b)",
    );
  }

  return {
    value: clamp(value, 0, 100),
    components: scoreComponentBreakdownSchema.parse(breakdown),
    attribution: lowestAttribution(usedAttributions),
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Rates are computed, never stored; an empty denominator is an honest 0. */
const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
