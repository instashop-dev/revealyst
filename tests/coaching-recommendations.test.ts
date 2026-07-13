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

  it("no fabricated 'time saved' / productivity claims (Group C refusal list) — titles AND bodies", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(/time saved|hours saved|productivity gain|roi/i.test(rec.title), `${rec.id} title`).toBe(false);
      expect(/time saved|hours saved|productivity gain|roi/i.test(rec.body), `${rec.id} body`).toBe(false);
    }
  });

  it("same-signal component pairs share a signalGroup (the deriveAttention dedupe key)", () => {
    // adoption.active_days and fluency.depth read the same 0–20 `active_day`
    // count; adoption.tool_coverage and fluency.breadth read the same
    // `feature_used` breadth — the glossary's own misconception notes say each
    // pair "always move together", so each pair must dedupe to one slot.
    const group = (slug: string, key: string) =>
      COACHING_RECOMMENDATIONS.find(
        (r) => r.slug === slug && r.componentKey === key,
      )?.signalGroup;
    expect(group("adoption", "active_days")).toBe(group("fluency", "depth"));
    expect(group("adoption", "tool_coverage")).toBe(group("fluency", "breadth"));
    // The remaining components measure genuinely distinct signals.
    const distinct = [
      group("fluency", "effectiveness"),
      group("efficiency", "output_per_spend"),
      group("efficiency", "engagement_per_spend"),
    ];
    expect(new Set(distinct).size).toBe(3);
    expect(distinct).not.toContain(group("adoption", "active_days"));
    expect(distinct).not.toContain(group("adoption", "tool_coverage"));
  });
});

describe("W5-E optimization metadata (§8.2 catalog columns)", () => {
  const IMPACT = new Set(["high", "medium", "low"]);
  const DIFFICULTY = new Set(["low", "medium", "high"]);
  const CONFIDENCE = new Set(["high", "medium", "low"]);
  const ACTION_TYPES = new Set(["link-out", "in-product-setting", "vendor-deep-link"]);

  it("every entry carries impact/difficulty/confidence from the closed vocabularies", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(IMPACT.has(rec.impact), `${rec.id} impact`).toBe(true);
      expect(DIFFICULTY.has(rec.difficulty), `${rec.id} difficulty`).toBe(true);
      expect(CONFIDENCE.has(rec.confidence), `${rec.id} confidence`).toBe(true);
    }
  });

  it("actionType is exactly the §8.2 three-value suggested-action taxonomy", () => {
    for (const rec of COACHING_RECOMMENDATIONS) {
      expect(ACTION_TYPES.has(rec.actionType), `${rec.id} actionType`).toBe(true);
    }
    // All three action shapes are exercised across the seven entries — the
    // catalog isn't collapsed to one value.
    expect(new Set(COACHING_RECOMMENDATIONS.map((r) => r.actionType))).toEqual(
      ACTION_TYPES,
    );
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
