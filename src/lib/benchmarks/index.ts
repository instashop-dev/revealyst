import { fixtureBenchmarkSource } from "./fixture";

/** One score's position against the published benchmark distribution. */
export type BenchmarkSummary = {
  slug: string;
  label: string;
  /** The org's score, or null when it has no score yet. */
  orgValue: number | null;
  peerMedian: number;
  /** 0..100 percentile of orgValue in the published distribution; null when
   * the org has no score. Never fabricated — absence stays absent. */
  percentile: number | null;
  source: string;
};

/** The swap seam: today a local fixture of published norms; W2-I replaces the
 * impl returned here with the real seeded benchmark table. */
export interface BenchmarkSource {
  forScores(scores: { slug: string; value: number | null }[]): BenchmarkSummary[];
}

export function resolveBenchmarkSource(): BenchmarkSource {
  return fixtureBenchmarkSource;
}
