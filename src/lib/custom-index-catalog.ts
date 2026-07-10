import { CANONICAL_METRICS } from "../contracts/metrics";
import {
  scoreAggregationSchema,
  type ScoreAggregation,
} from "../contracts/scores";
import { METRIC_REFERENCE } from "./metrics-glossary";

// The builder's component-picker vocabulary, derived from the FROZEN contracts
// (CANONICAL_METRICS + the closed aggregation enum) so the UI can only ever
// offer what the engine accepts — never a free-text formula (tripwire). Plain
// data; safe to pass from a server component into the client builder.

export type MetricOption = {
  key: string;
  name: string;
  plain: string;
  /** "model"/"feature" metrics carry a dim — the only ones distinct_dims is
   * meaningful for. null = no dimension. */
  dimKind: "model" | "feature" | null;
};

/** Every catalog metric as a picker option, alphabetized by display name. */
export const METRIC_OPTIONS: MetricOption[] = Object.entries(CANONICAL_METRICS)
  .map(([key, entry]) => ({
    key,
    name: METRIC_REFERENCE[key]?.name ?? key,
    plain: METRIC_REFERENCE[key]?.plain ?? "",
    dimKind: entry.dimKind,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export type AggregationOption = {
  value: ScoreAggregation;
  label: string;
  hint: string;
};

const AGGREGATION_LABELS: Record<ScoreAggregation, { label: string; hint: string }> = {
  sum: { label: "Sum over the period", hint: "Adds up every value in the window." },
  avg_per_day: {
    label: "Average per day",
    hint: "Sum divided by the number of days in the window.",
  },
  active_days: {
    label: "Active days",
    hint: "Count of distinct days that had at least one row.",
  },
  distinct_dims: {
    label: "Distinct values",
    hint: "Count of distinct models or features seen (needs a dimensioned metric).",
  },
};

/** Aggregation options, enumerated from the frozen schema so a new aggregation
 * can't be added to the vocabulary without surfacing here (the map above is
 * keyed exhaustively by the enum, so an addition is a type error). */
export const AGGREGATION_OPTIONS: AggregationOption[] =
  scoreAggregationSchema.options.map((value) => ({
    value,
    label: AGGREGATION_LABELS[value].label,
    hint: AGGREGATION_LABELS[value].hint,
  }));
