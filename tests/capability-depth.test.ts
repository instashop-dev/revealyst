import { describe, expect, it } from "vitest";
import {
  deriveDepthSpread,
  masteryBasisPoints,
} from "../src/lib/capability-depth";

// TMD P3 tail (T3.3) — the PURE depth/spread derivation. Team MEAN mastery +
// population STANDARD DEVIATION from the count-only sufficient statistics, with
// the honesty rule that an empty/absent cohort yields null (never a fabricated
// 0 mean).

/** Build the sufficient statistics the reducer stores, from raw mastery values —
 * the same math `mastery.masteryStats()` runs, so this doubles as its spec. */
function statsOf(masteries: number[]): { sumBp: number; sumSqBp: number } {
  let sumBp = 0;
  let sumSqBp = 0;
  for (const m of masteries) {
    const bp = masteryBasisPoints(m);
    sumBp += bp;
    sumSqBp += bp * bp;
  }
  return { sumBp, sumSqBp };
}

describe("deriveDepthSpread", () => {
  it("mean is the arithmetic mean of mastery; spread 0 when everyone is equal", () => {
    const { sumBp, sumSqBp } = statsOf([0.6, 0.6, 0.6]);
    expect(deriveDepthSpread(sumBp, sumSqBp, 3)).toEqual({
      mean: 0.6,
      spread: 0,
    });
  });

  it("computes the population standard deviation", () => {
    // {0.4, 0.8}: mean 0.6, deviations ±0.2 → population stddev 0.2.
    const { sumBp, sumSqBp } = statsOf([0.4, 0.8]);
    expect(deriveDepthSpread(sumBp, sumSqBp, 2)).toEqual({
      mean: 0.6,
      spread: 0.2,
    });
  });

  it("handles a spread of mixed values (round4)", () => {
    const values = [0.2, 0.5, 0.5, 0.8];
    const { sumBp, sumSqBp } = statsOf(values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length; // 0.5
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const out = deriveDepthSpread(sumBp, sumSqBp, values.length);
    expect(out).not.toBeNull();
    expect(out!.mean).toBeCloseTo(mean, 4);
    expect(out!.spread).toBeCloseTo(Math.sqrt(variance), 4);
  });

  it("returns null for an empty cohort (never a fabricated 0 mean)", () => {
    expect(deriveDepthSpread(0, 0, 0)).toBeNull();
  });

  it("returns null when the stats are absent (backfilled history rows)", () => {
    expect(deriveDepthSpread(null, null, 5)).toBeNull();
    expect(deriveDepthSpread(1000, null, 5)).toBeNull();
  });

  it("never returns a negative spread from floating-point noise", () => {
    // All-equal values can produce a tiny negative variance before clamping.
    const { sumBp, sumSqBp } = statsOf([0.3333, 0.3333, 0.3333]);
    const out = deriveDepthSpread(sumBp, sumSqBp, 3);
    expect(out!.spread).toBeGreaterThanOrEqual(0);
  });
});

describe("masteryBasisPoints", () => {
  it("scales the round4 mastery to an exact integer", () => {
    expect(masteryBasisPoints(0.6)).toBe(6000);
    expect(masteryBasisPoints(0.1234)).toBe(1234);
    expect(masteryBasisPoints(1)).toBe(10000);
    expect(masteryBasisPoints(0)).toBe(0);
  });
});
