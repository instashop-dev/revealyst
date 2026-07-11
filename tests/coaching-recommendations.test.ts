import { describe, expect, it } from "vitest";

import {
  COACHING_GUIDANCE_SUFFIX,
  COACHING_RECOMMENDATIONS,
  findCoachingRecommendation,
} from "../src/lib/coaching-recommendations";
import { SCORE_GLOSSARY, SCORE_SLUGS } from "../src/lib/metrics-glossary";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// Pure content suite for the F1.1 coaching map — no DB, no I/O. These are the
// adversarial content fact-check assertions (G7): every entry must map to a
// REAL preset component, stay task-focused, and never state an invented
// benchmark.

describe("COACHING_RECOMMENDATIONS", () => {
  it("has a sensible number of quality entries (6–12)", () => {
    expect(COACHING_RECOMMENDATIONS.length).toBeGreaterThanOrEqual(6);
    expect(COACHING_RECOMMENDATIONS.length).toBeLessThanOrEqual(12);
  });

  it("every id is unique", () => {
    const ids = COACHING_RECOMMENDATIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every (slug, componentKey) targets a LIVE preset component — no orphan keys", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect((SCORE_SLUGS as readonly string[])).toContain(rec.slug);
      const components = SCORE_GLOSSARY[rec.slug].components;
      expect(
        Object.keys(components),
        `${rec.id} → ${rec.slug}.${rec.componentKey}`,
      ).toContain(rec.componentKey);
    }
  });

  it("at most one recommendation per (slug, component) pattern", () => {
    const keys = COACHING_RECOMMENDATIONS.map((r) => `${r.slug}::${r.componentKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("no copy states an invented benchmark/threshold as fact (invariant b)", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(BANNED_PHRASING.test(rec.title), rec.id).toBe(false);
      expect(BANNED_PHRASING.test(rec.body), rec.id).toBe(false);
    }
    expect(BANNED_PHRASING.test(COACHING_GUIDANCE_SUFFIX)).toBe(false);
  });

  it("copy stays task-focused, never second-person/blaming (Kluger & DeNisi)", () => {
    // No "you"/"your" — guidance addresses the task and "people", never an
    // individual reader, so it can't read as a personal verdict.
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(/\byou\b|\byour\b/i.test(rec.title), `${rec.id} title`).toBe(false);
      expect(/\byou\b|\byour\b/i.test(rec.body), `${rec.id} body`).toBe(false);
    }
  });

  it("no fabricated 'time saved' / productivity claims (Group C refusal list)", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(/time saved|hours saved|productivity gain|roi/i.test(rec.body), rec.id).toBe(false);
    }
  });
});

describe("findCoachingRecommendation", () => {
  it("resolves a real (slug, component) pattern", () => {
    const rec = findCoachingRecommendation("adoption", "active_days");
    expect(rec?.id).toBe("adoption-active-days");
  });

  it("returns undefined for a component with no mapped guidance", () => {
    expect(findCoachingRecommendation("adoption", "no_such_component")).toBeUndefined();
  });

  it("is slug-scoped — a component key never leaks across scores", () => {
    // effectiveness only lives under fluency; asking for it under adoption is a
    // miss, not a wrong-slug hit.
    expect(findCoachingRecommendation("adoption", "effectiveness")).toBeUndefined();
    expect(findCoachingRecommendation("fluency", "effectiveness")?.id).toBe(
      "fluency-effectiveness",
    );
  });
});
