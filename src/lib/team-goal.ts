import { z } from "zod";
import { SCORE_SLUGS, type ScoreSlug } from "./metrics-glossary";

// The closed set of metrics a manager may set a team goal against (TMD P1,
// ADR 0061). This is the contract the `team_goals.metric_slug` text column
// points to — a CLOSED union, never free-form (tripwire: no formula DSL;
// invariant b: never a fabricated/arbitrary metric).
//
// Today it is exactly the three score slugs (adoption / fluency / efficiency),
// so we reuse the single source of truth `SCORE_SLUGS` (src/lib/metrics-glossary.ts)
// rather than restating them — the goal metric list can never drift from the
// scoring engine's slugs. Storing it as plain text (not a pg enum) keeps a future
// capability-slug target additive: widen THIS array + guard, no enum migration.

export const TEAM_GOAL_METRICS: readonly ScoreSlug[] = SCORE_SLUGS;

export type TeamGoalMetric = ScoreSlug;

/** Zod schema for a team-goal metric — use at the API boundary (P1b setter). */
export const teamGoalMetricSchema = z.enum(
  TEAM_GOAL_METRICS as unknown as [TeamGoalMetric, ...TeamGoalMetric[]],
);

/** True iff `value` is a metric a team goal may target. */
export function isTeamGoalMetric(value: unknown): value is TeamGoalMetric {
  return (
    typeof value === "string" &&
    (TEAM_GOAL_METRICS as readonly string[]).includes(value)
  );
}
