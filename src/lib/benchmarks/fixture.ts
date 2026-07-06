import type { BenchmarkSource, BenchmarkSummary } from "./index";
import { BENCHMARK_NORMS, type BenchmarkNorm } from "./norms";

// Maps a 0..100 score to its percentile in the published distribution by
// piecewise-linear interpolation across the norm's percentile anchors. Below
// p10 we interpolate down to (score 0 → percentile 0); above p90 up to
// (score 100 → percentile 100). Result is clamped to 0..100.
function percentileFor(value: number, norm: BenchmarkNorm): number {
  const anchors: [number, number][] = [
    [0, 0],
    [10, norm.percentiles.p10],
    [25, norm.percentiles.p25],
    [50, norm.percentiles.p50],
    [75, norm.percentiles.p75],
    [90, norm.percentiles.p90],
    [100, 100],
  ];
  if (value <= anchors[0][1]) return 0;
  if (value >= anchors[anchors.length - 1][1]) return 100;
  for (let i = 0; i < anchors.length - 1; i++) {
    const [pLo, vLo] = anchors[i];
    const [pHi, vHi] = anchors[i + 1];
    if (value >= vLo && value <= vHi) {
      const span = vHi - vLo;
      const frac = span === 0 ? 0 : (value - vLo) / span;
      return Math.round((pLo + frac * (pHi - pLo)) * 100) / 100;
    }
  }
  return 100;
}

const NORMS_BY_SLUG = new Map(BENCHMARK_NORMS.map((n) => [n.slug, n]));

export const fixtureBenchmarkSource: BenchmarkSource = {
  forScores(scores) {
    const summaries: BenchmarkSummary[] = [];
    for (const { slug, value } of scores) {
      const norm = NORMS_BY_SLUG.get(slug);
      if (!norm) continue; // no published benchmark for this slug — omit, never invent
      summaries.push({
        slug: norm.slug,
        label: norm.label,
        orgValue: value,
        peerMedian: norm.peerMedian,
        percentile: value == null ? null : percentileFor(value, norm),
        source: norm.source,
      });
    }
    return summaries;
  },
};
