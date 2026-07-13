import { describe, expect, it } from "vitest";
import { segmentFor, SEGMENT_THRESHOLDS_V1 } from "../src/scoring/segment";

// W2-I segmentation: honesty rules mirror evaluate.ts's ratio-component
// absence handling — missing score input never gets a fabricated segment.
//
// W5-A (ADR 0027): the fixture-integrated `segmentTeams` suite was removed
// alongside the app-dead `segmentTeams` org-read helper (its only live consumer
// was scripts/calibrate-scores.ts, now retired). The pure `segmentFor`
// classifier below is the surviving, unit-tested segmentation vocabulary.

describe("segmentFor (pure, boundary values)", () => {
  it("returns null when either input is absent — never a fabricated segment", () => {
    expect(segmentFor(null, null)).toBeNull();
    expect(segmentFor(null, 80)).toBeNull();
    expect(segmentFor(80, null)).toBeNull();
  });

  it("high fluency (>= threshold) is 'ai_native' regardless of adoption", () => {
    expect(segmentFor(10, 90)).toBe("ai_native");
    expect(segmentFor(0, SEGMENT_THRESHOLDS_V1.powerUserMaxFluency)).toBe(
      "ai_native",
    );
  });

  it("low adoption (< threshold) is 'skeptic' when fluency isn't high enough for ai_native", () => {
    expect(segmentFor(10, 40)).toBe("skeptic");
    expect(segmentFor(SEGMENT_THRESHOLDS_V1.skepticMaxAdoption - 1, 0)).toBe(
      "skeptic",
    );
  });

  it("high adoption or moderately-high fluency (with mid adoption) is 'power_user'", () => {
    expect(segmentFor(70, 40)).toBe("power_user"); // adoption clears the power-user floor
    expect(segmentFor(30, 60)).toBe("power_user"); // fluency alone clears the casual ceiling
  });

  it("mid adoption and low-mid fluency is 'casual'", () => {
    expect(segmentFor(30, 30)).toBe("casual");
  });
});
