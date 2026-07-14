import { describe, expect, it } from "vitest";
import {
  masteryBand,
  overallCapabilityBand,
} from "../src/lib/capability-glossary";

// W7-4 follow-up: the Growth-Journey band helper. It must stay null while
// mastery is only DIRECTIONAL (the honest gate — a directional band is a
// shakier headline than the modeled maturity level), and surface the strongest
// MEASURED capability's band once measured mastery exists (OTel/P8).

describe("masteryBand", () => {
  it("maps mastery to positive-first bands", () => {
    expect(masteryBand(0.9)).toBe("Established");
    expect(masteryBand(0.6)).toBe("Building");
    expect(masteryBand(0.3)).toBe("Developing");
    expect(masteryBand(0.05)).toBe("Getting started");
  });
});

describe("overallCapabilityBand", () => {
  it("returns null when there is no MEASURED capability (directional only)", () => {
    expect(
      overallCapabilityBand([
        { mastery: 0.9, confidenceTier: "directional" },
        { mastery: 0.8, confidenceTier: "directional" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty profile", () => {
    expect(overallCapabilityBand([])).toBeNull();
  });

  it("uses the strongest MEASURED capability once measured mastery exists", () => {
    expect(
      overallCapabilityBand([
        { mastery: 0.95, confidenceTier: "directional" }, // ignored — not measured
        { mastery: 0.62, confidenceTier: "measured" },
        { mastery: 0.4, confidenceTier: "measured" },
      ]),
    ).toBe("Building"); // 0.62 → Building (the top measured one)
  });
});
