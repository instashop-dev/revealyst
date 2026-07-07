/**
 * Placeholder published-benchmark seeds for the org-level benchmark panel.
 *
 * These are the "org vs. published benchmarks" numbers (§8 L4) — a small set of
 * peer medians + percentile anchors sourced from public data. They live here as
 * a local W2-L constant so the dashboard can render a benchmark panel before
 * W2-I's seeded benchmark table exists (rule 2: build against a local fixture,
 * not another workstream's branch). When W2-I lands, swap the fixture source in
 * `resolveBenchmarkSource()` — the interface and every call site stay unchanged.
 *
 * Scores are 0..100. Percentile anchors map an org's score to where it sits in
 * the published distribution.
 */
export type BenchmarkNorm = {
  slug: string;
  label: string;
  peerMedian: number;
  /** Score value at each published percentile (monotonic, 0..100). */
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  source: string;
};

export const BENCHMARK_NORMS_VERSION = 0;

export const BENCHMARK_NORMS: BenchmarkNorm[] = [
  // Provenance honesty (invariant b, score-definitions.md): these curves are
  // MODELED estimates from public commentary, not verified published data —
  // the source strings must say so until a founder verifies primary sources
  // (docs/launch/benchmark-post-data-needs.md) and the panel switches to
  // verified benchmark rows.
  {
    slug: "adoption",
    label: "AI Adoption",
    peerMedian: 52,
    percentiles: { p10: 20, p25: 38, p50: 52, p75: 68, p90: 82 },
    source:
      "Revealyst modeled estimate (unverified) — from public Worklytics / Section AI-adoption commentary",
  },
  {
    slug: "fluency",
    label: "AI Fluency",
    peerMedian: 49,
    percentiles: { p10: 18, p25: 34, p50: 49, p75: 65, p90: 80 },
    source:
      "Revealyst modeled estimate (unverified) — from public Copilot acceptance-rate commentary",
  },
  {
    slug: "efficiency",
    label: "AI Efficiency",
    peerMedian: 45,
    percentiles: { p10: 15, p25: 30, p50: 45, p75: 62, p90: 78 },
    source: "Revealyst modeled estimate (unverified)",
  },
];
