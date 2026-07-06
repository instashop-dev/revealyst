import { describe, expect, it } from "vitest";
import { resolveBenchmarkSource } from "./index";

// The benchmark panel is load-bearing (§8 L4) but must stay honest: an org
// with no score gets a null percentile, never an invented one, and a slug with
// no published norm is omitted rather than fabricated.
describe("fixtureBenchmarkSource", () => {
  const source = resolveBenchmarkSource();

  it("places an org score at its published percentile", () => {
    const [summary] = source.forScores([{ slug: "adoption", value: 47.5 }]);
    expect(summary.slug).toBe("adoption");
    expect(summary.orgValue).toBe(47.5);
    expect(summary.peerMedian).toBe(52);
    // 47.5 sits between the p25 (38) and p50 (52) anchors → ~42nd percentile.
    expect(summary.percentile).toBeCloseTo(41.96, 1);
    expect(summary.source).toMatch(/Worklytics/);
  });

  it("returns a null percentile for an org with no score", () => {
    const [summary] = source.forScores([{ slug: "fluency", value: null }]);
    expect(summary.orgValue).toBeNull();
    expect(summary.percentile).toBeNull();
  });

  it("clamps scores at or beyond the distribution ends", () => {
    const [low] = source.forScores([{ slug: "efficiency", value: 0 }]);
    const [high] = source.forScores([{ slug: "efficiency", value: 100 }]);
    expect(low.percentile).toBe(0);
    expect(high.percentile).toBe(100);
  });

  it("omits a slug with no published benchmark", () => {
    expect(source.forScores([{ slug: "made_up", value: 50 }])).toEqual([]);
  });
});
