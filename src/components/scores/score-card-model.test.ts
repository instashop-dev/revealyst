import { describe, expect, it } from "vitest";

import type { DashboardScore, DefinitionRow } from "../../lib/dashboard-read";
import { fromDashboardScore, fromPersonalScore, type PersonalScore } from "./score-card-model";

// Fixtures mirror fixtures/score-definitions/personal-presets.json (fluency
// v1: breadth/depth/effectiveness) and fixtures/score-results/personal-30d.json
// (fluency's real oracle: breadth + depth present, effectiveness OMITTED for
// want of suggestions_accepted/suggestions_offered rows — the both-sides
// ratio-honesty rule).

function definitionRow(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  const base = {
    id: "def-fluency-v1",
    orgId: null,
    slug: "fluency",
    version: 1,
    name: "AI Fluency Score",
    subjectLevel: "person",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    components: [
      {
        key: "breadth",
        metric: "feature_used",
        aggregation: "distinct_dims",
        weight: 0.33,
        normalization: { min: 0, max: 8 },
      },
      {
        key: "depth",
        metric: "active_day",
        aggregation: "active_days",
        weight: 0.33,
        normalization: { min: 0, max: 20 },
      },
      {
        key: "effectiveness",
        ratio: {
          numerator: { metric: "suggestions_accepted", aggregation: "sum" },
          denominator: { metric: "suggestions_offered", aggregation: "sum" },
        },
        weight: 0.34,
        normalization: { min: 0, max: 0.5 },
      },
    ],
  };
  return { ...base, ...overrides } as unknown as DefinitionRow;
}

const FLUENCY_V1 = definitionRow();
const FLUENCY_V2 = {
  ...FLUENCY_V1,
  id: "def-fluency-v2",
  version: 2,
  components: [
    {
      key: "breadth",
      metric: "feature_used",
      aggregation: "distinct_dims",
      weight: 1,
      normalization: { min: 0, max: 10 },
    },
  ],
} as unknown as DefinitionRow;

function dashboardScore(overrides: Partial<DashboardScore> = {}): DashboardScore {
  return {
    definitionSlug: "fluency",
    definitionVersion: 1,
    subjectLevel: "team",
    person: null,
    teamId: null,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    periodGrain: "month",
    value: 9.075,
    attribution: "person",
    components: {
      breadth: { raw: 1, normalized: 12.5, weight: 0.33, contribution: 4.125 },
      depth: { raw: 3, normalized: 15, weight: 0.33, contribution: 4.95 },
      // effectiveness intentionally absent — the both-sides ratio-honesty rule.
    },
    ...overrides,
  };
}

describe("fromDashboardScore", () => {
  it("omitted effectiveness renders as an omitted row (never a fabricated 0)", () => {
    const data = fromDashboardScore({
      slug: "fluency",
      score: dashboardScore(),
      definitions: [FLUENCY_V1],
    });

    expect(data.value).toBe(9.075);
    expect(data.componentRows).toHaveLength(3);
    const effectiveness = data.componentRows.find((r) => r.key === "effectiveness");
    expect(effectiveness?.omitted).toBe(true);
    expect(effectiveness?.raw).toBeUndefined();
    expect(effectiveness?.normalized).toBeUndefined();

    const breadth = data.componentRows.find((r) => r.key === "breadth");
    expect(breadth?.omitted).toBe(false);
    expect(breadth?.normalized).toBe(12.5);
  });

  it("null score renders value null and pulls componentRows from the latest active definition", () => {
    const data = fromDashboardScore({
      slug: "fluency",
      score: null,
      definitions: [FLUENCY_V1],
    });

    expect(data.value).toBeNull();
    expect(data.attribution).toBeNull();
    expect(data.componentRows).toHaveLength(3);
    expect(data.componentRows.every((r) => r.omitted)).toBe(true);
  });

  it("no matching definition at all yields an empty componentRows, not a throw", () => {
    const data = fromDashboardScore({
      slug: "adoption",
      score: null,
      definitions: [FLUENCY_V1],
    });

    expect(data.componentRows).toEqual([]);
  });

  it("picks the definition version matching the score row when two versions exist", () => {
    const scoreOnV1 = dashboardScore({ definitionVersion: 1 });
    const dataV1 = fromDashboardScore({
      slug: "fluency",
      score: scoreOnV1,
      definitions: [FLUENCY_V1, FLUENCY_V2],
    });
    expect(dataV1.componentRows.map((r) => r.key)).toEqual(["breadth", "depth", "effectiveness"]);

    const scoreOnV2 = dashboardScore({
      definitionVersion: 2,
      components: { breadth: { raw: 5, normalized: 50, weight: 1, contribution: 50 } },
    });
    const dataV2 = fromDashboardScore({
      slug: "fluency",
      score: scoreOnV2,
      definitions: [FLUENCY_V1, FLUENCY_V2],
    });
    expect(dataV2.componentRows.map((r) => r.key)).toEqual(["breadth"]);
  });

  it("sets methodologyHref from the slug's anchor", () => {
    const data = fromDashboardScore({ slug: "adoption", score: null, definitions: [] });
    expect(data.methodologyHref).toBe("/methodology#adoption");
  });

  it("passes through delta and footer untouched", () => {
    const delta = { kind: "first" as const };
    const data = fromDashboardScore({
      slug: "fluency",
      score: dashboardScore(),
      definitions: [FLUENCY_V1],
      delta,
      footer: "footer-node",
    });
    expect(data.delta).toBe(delta);
    expect(data.footer).toBe("footer-node");
  });
});

describe("fromPersonalScore", () => {
  function personalScore(overrides: Partial<PersonalScore> = {}): PersonalScore {
    return {
      definitionSlug: "fluency",
      definitionVersion: 1,
      value: 9.075,
      attribution: "person",
      components: {
        breadth: { raw: 1, normalized: 12.5, weight: 0.33, contribution: 4.125 },
        depth: { raw: 3, normalized: 15, weight: 0.33, contribution: 4.95 },
      },
      ...overrides,
    };
  }

  it("narrows the untyped components record the same way as the dashboard shape", () => {
    const data = fromPersonalScore({
      slug: "fluency",
      score: personalScore(),
      definitions: [FLUENCY_V1],
    });

    expect(data.value).toBe(9.075);
    const effectiveness = data.componentRows.find((r) => r.key === "effectiveness");
    expect(effectiveness?.omitted).toBe(true);
    const breadth = data.componentRows.find((r) => r.key === "breadth");
    expect(breadth?.normalized).toBe(12.5);
  });

  it("a malformed components record alongside a real value yields an empty breakdown, never throws, never a self-contradictory all-omitted row set", () => {
    const data = fromPersonalScore({
      slug: "fluency",
      score: personalScore({ components: { breadth: { normalized: "not-a-number" } } }),
      definitions: [FLUENCY_V1],
    });

    expect(data.value).toBe(9.075);
    expect(data.componentRows).toEqual([]);
  });

  it("null score renders the computing state", () => {
    const data = fromPersonalScore({
      slug: "adoption",
      score: null,
      definitions: [FLUENCY_V1],
    });
    expect(data.value).toBeNull();
    expect(data.attribution).toBeNull();
  });
});
