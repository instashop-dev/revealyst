// W1-F scoring engine public surface. On-demand recompute (e.g. after a
// connector backfill completes) is either a direct `recomputeOrg` call or a
// `score-recompute` queue message — both run the same idempotent path.
export {
  evaluateDefinition,
  componentMetricKeys,
  type EngineRow,
  type EvaluationResult,
} from "./evaluate";
export {
  periodFor,
  daysInPeriod,
  previousDay,
  type Period,
} from "./periods";
export { recomputeOrg, type RecomputeSummary } from "./recompute";
