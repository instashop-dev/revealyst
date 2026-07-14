import { describe, expect, it } from "vitest";
import {
  computeUtility,
  UTILITY_WEIGHTS,
  type CatalogRecommendation,
} from "../src/lib/recommendation-catalog";
import { deriveAttention, type ComponentDetailRow } from "../src/lib/score-insights";

// W7-3: the deterministic utility ranker. The permanent output-equivalence
// guard (uniform metadata reduces to weakest-first), term-by-term weighting,
// stage-1 eligibility (role / tool / prerequisite fails-closed), fatigue, and
// determinism.

const SIGNALS: CatalogRecommendation["requiredSignals"] = {
  comparators: [
    { kind: "measured" },
    { kind: "normalized-below", value: 40 },
    { kind: "min-weight", value: 0.2 },
  ],
};

function rec(over: Partial<CatalogRecommendation> = {}): CatalogRecommendation {
  return {
    id: "r",
    slug: "adoption",
    componentKey: "active_days",
    signalGroup: "active-days",
    title: "T",
    body: "B",
    requiredSignals: SIGNALS,
    applicableRoles: [],
    applicableTools: [],
    targetCapabilities: [],
    benefit: "medium",
    difficulty: "medium",
    confidence: "medium",
    learningResources: [],
    relatedWorkflows: [],
    insightKind: "adoption",
    suggestedActionType: "link-out",
    version: 1,
    ...over,
  };
}

function componentRow(key: string, normalized: number, weight = 0.5): ComponentDetailRow {
  return {
    key,
    label: key,
    kind: "plain",
    omitted: false,
    normalized,
    weight,
    calcSimple: `calc ${key}`,
  };
}

const base = {
  connections: [],
  gaps: [],
  sharedAccountCount: 0,
  scoreDrops: [],
};

describe("computeUtility — term weighting", () => {
  const ctx = { normalized: 20, roleToolFit: 0.5, novelty: 1, fatiguePenalty: 0 };

  it("positive terms sum to 0.90 (the §7 formula; penalties subtract on top)", () => {
    const sum =
      UTILITY_WEIGHTS.capabilityGap +
      UTILITY_WEIGHTS.benefit +
      UTILITY_WEIGHTS.confidence +
      UTILITY_WEIGHTS.roleToolFit +
      UTILITY_WEIGHTS.novelty;
    expect(sum).toBeCloseTo(0.9);
  });

  it("higher benefit raises utility at equal gap", () => {
    const high = computeUtility(rec({ benefit: "high" }), ctx);
    const low = computeUtility(rec({ benefit: "low" }), ctx);
    expect(high).toBeGreaterThan(low);
  });

  it("higher difficulty lowers utility at equal gap", () => {
    const hard = computeUtility(rec({ difficulty: "high" }), ctx);
    const easy = computeUtility(rec({ difficulty: "low" }), ctx);
    expect(easy).toBeGreaterThan(hard);
  });

  it("a bigger capability gap dominates", () => {
    const weak = computeUtility(rec(), { ...ctx, normalized: 5 });
    const strong = computeUtility(rec(), { ...ctx, normalized: 35 });
    expect(weak).toBeGreaterThan(strong);
  });
});

describe("output-equivalence guard (uniform metadata → weakest-first)", () => {
  it("with medium/medium/medium and no eligibility/fatigue, order is weakest-first", () => {
    // Two recs, identical medium metadata, distinct signal groups so neither is
    // deduped: active_days (weak 10) and tool_coverage (30). Weakest first.
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        {
          slug: "adoption",
          components: [
            componentRow("active_days", 10),
            componentRow("tool_coverage", 30),
          ],
        },
      ],
      recommendations: [
        rec({ id: "a", componentKey: "active_days", signalGroup: "active-days", title: "Active days" }),
        rec({ id: "t", componentKey: "tool_coverage", signalGroup: "feature-breadth", title: "Tool coverage" }),
      ],
    });
    const recs = items.filter((i) => i.kind === "recommendation");
    expect(recs.map((r) => r.title)).toEqual(["Active days", "Tool coverage"]);
  });
});

describe("stage-1 eligibility", () => {
  const scoreComponents = [
    { slug: "adoption" as const, components: [componentRow("active_days", 10)] },
  ];

  it("prerequisite gate fails CLOSED: unmet prereq excludes the rec", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [rec({ id: "a", targetCapabilities: ["capB"] })],
      capabilityPrereqs: new Map([["capB", ["capA"]]]),
      masteredCapabilities: new Set(), // capA not mastered → excluded
    });
    expect(items.filter((i) => i.kind === "recommendation")).toHaveLength(0);
  });

  it("prerequisite gate passes once the prereq is mastered", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [rec({ id: "a", targetCapabilities: ["capB"] })],
      capabilityPrereqs: new Map([["capB", ["capA"]]]),
      masteredCapabilities: new Set(["capA"]),
    });
    expect(items.filter((i) => i.kind === "recommendation")).toHaveLength(1);
  });

  it("role gate excludes a role-scoped rec that doesn't match", () => {
    const excluded = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [rec({ id: "a", applicableRoles: ["backend"] })],
      personRoles: new Set(["frontend"]),
    });
    expect(excluded.filter((i) => i.kind === "recommendation")).toHaveLength(0);
    const included = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [rec({ id: "a", applicableRoles: ["backend"] })],
      personRoles: new Set(["backend"]),
    });
    expect(included.filter((i) => i.kind === "recommendation")).toHaveLength(1);
  });

  it("tool gate excludes a tool-scoped rec whose tool isn't connected", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [rec({ id: "a", applicableTools: ["cursor"] })],
      connectedTools: new Set(["openai"]),
    });
    expect(items.filter((i) => i.kind === "recommendation")).toHaveLength(0);
  });

  it("omitting eligibility context leaves a scoped rec eligible (backward-compatible)", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents,
      recommendations: [
        rec({ id: "a", applicableRoles: ["backend"], targetCapabilities: ["capB"] }),
      ],
      // no personRoles / capabilityPrereqs → no gating
    });
    expect(items.filter((i) => i.kind === "recommendation")).toHaveLength(1);
  });
});

describe("fatigue + determinism", () => {
  it("a tried rec ranks below an equal fresh rec", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        {
          slug: "adoption",
          components: [componentRow("active_days", 10), componentRow("tool_coverage", 10)],
        },
      ],
      recommendations: [
        rec({ id: "fresh", componentKey: "active_days", signalGroup: "active-days", title: "Fresh" }),
        rec({ id: "tried", componentKey: "tool_coverage", signalGroup: "feature-breadth", title: "Tried" }),
      ],
      fatigueRecIds: new Set(["tried"]),
    });
    const recs = items.filter((i) => i.kind === "recommendation");
    // Equal gap (both 10), but "tried" carries the fatigue penalty → below.
    expect(recs[0].title).toBe("Fresh");
  });

  it("is deterministic: two runs produce byte-identical output", () => {
    const input = {
      ...base,
      scoreComponents: [
        { slug: "fluency" as const, components: [componentRow("depth", 10, 0.33), componentRow("effectiveness", 20, 0.34)] },
      ],
      recommendations: [
        rec({ id: "d", slug: "fluency", componentKey: "depth", signalGroup: "active-days", benefit: "high" as const, title: "Depth" }),
        rec({ id: "e", slug: "fluency", componentKey: "effectiveness", signalGroup: "effectiveness", confidence: "low" as const, title: "Eff" }),
      ],
    };
    expect(deriveAttention(input)).toEqual(deriveAttention(input));
  });
});
