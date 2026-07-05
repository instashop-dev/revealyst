import { z } from "zod";

// Frozen W0-C score contracts. ScoreDefinition.components is DATA with a
// closed aggregation vocabulary — deliberately NOT a formula DSL, not
// per-tenant expressions, not a rules engine (tripwire; §8 non-goals).
// The engine that evaluates these lands in W1-F; the shapes freeze here so
// W1-F, W1-G, W2-H/I/L all build against the same contract.

/** Closed aggregation vocabulary. Growing it post-freeze requires an ADR. */
export const scoreAggregationSchema = z.enum([
  "sum", // Σ value over the period
  "avg_per_day", // Σ value / days in period
  "active_days", // count of days with a row (flag metrics)
  "distinct_dims", // count of distinct `dim` values seen
]);

/** Linear normalization of the raw aggregate into 0..100 (clamped). */
export const scoreNormalizationSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const metricSourceSchema = z.object({
  metric: z.string().min(1),
  aggregation: scoreAggregationSchema,
});

/** A ratio of two aggregates, e.g. suggestions_accepted / suggestions_offered.
 * Rates are always computed — never stored as metric rows. */
const ratioSourceSchema = z.object({
  ratio: z.object({
    numerator: metricSourceSchema,
    denominator: metricSourceSchema,
  }),
});

export const scoreComponentSchema = z
  .object({
    key: z.string().min(1),
    weight: z.number().gt(0).lte(1),
    normalization: scoreNormalizationSchema,
  })
  .and(z.union([metricSourceSchema, ratioSourceSchema]));

export const scoreComponentsSchema = z
  .array(scoreComponentSchema)
  .min(1)
  .refine(
    (components) => {
      const total = components.reduce((sum, c) => sum + c.weight, 0);
      return total > 0.99 && total < 1.01;
    },
    { message: "component weights must sum to 1" },
  )
  .refine(
    (components) =>
      new Set(components.map((c) => c.key)).size === components.length,
    { message: "component keys must be unique" },
  );

export type ScoreAggregation = z.infer<typeof scoreAggregationSchema>;
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const SCORE_SUBJECT_LEVELS = ["person", "team", "org"] as const;
export type ScoreSubjectLevel = (typeof SCORE_SUBJECT_LEVELS)[number];

export const PERIOD_GRAINS = ["week", "month", "rolling_28d"] as const;
export type PeriodGrain = (typeof PERIOD_GRAINS)[number];

/** The score_definitions row shape (frozen). */
export const scoreDefinitionSchema = z.object({
  slug: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  subjectLevel: z.enum(SCORE_SUBJECT_LEVELS),
  components: scoreComponentsSchema,
  status: z.enum(["draft", "active", "retired"]),
});
export type ScoreDefinitionInput = z.infer<typeof scoreDefinitionSchema>;

/** Per-component breakdown persisted on every score_results row. */
export const scoreComponentBreakdownSchema = z.record(
  z.string(),
  z.object({
    raw: z.number(),
    normalized: z.number().min(0).max(100),
    weight: z.number(),
    contribution: z.number(),
  }),
);
export type ScoreComponentBreakdown = z.infer<
  typeof scoreComponentBreakdownSchema
>;
