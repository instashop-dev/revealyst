import { describe, expect, it } from "vitest";
import type { ScoreComponent } from "../src/contracts/scores";
import type { ScoreTrendPoint } from "../src/lib/dashboard-trends";
import { SCORE_SLUGS } from "../src/lib/metrics-glossary";
import {
  deriveAttention,
  deriveDelta,
  formatComponentDetail,
  formatDelta,
  interpretScore,
  personDelta,
} from "../src/lib/score-insights";

// Pure-function suite: no DB, no I/O.

function point(
  periodStart: string,
  periodEnd: string,
  value: number,
  periodGrain: ScoreTrendPoint["periodGrain"] = "week",
  definitionVersion = 1,
): ScoreTrendPoint {
  return { periodStart, periodEnd, value, periodGrain, definitionVersion };
}

describe("deriveDelta", () => {
  it("0 points → first", () => {
    expect(deriveDelta([])).toEqual({ kind: "first" });
  });

  it("1 point → first", () => {
    expect(deriveDelta([point("2026-06-01", "2026-06-30", 70)])).toEqual({ kind: "first" });
  });

  // Fixed-length (7-day, "week"-grain-like) windows so the day-span
  // comparability check agrees regardless of calendar month lengths.
  it("2 points, same grain (equal day-span) → delta", () => {
    const result = deriveDelta([
      point("2026-06-01", "2026-06-07", 70),
      point("2026-06-08", "2026-06-14", 80),
    ]);
    expect(result.kind).toBe("delta");
    if (result.kind === "delta") {
      expect(result.current).toBe(80);
      expect(result.previous).toBe(70);
      expect(result.delta).toBe(10);
      expect(result.previousPeriodLabel).toBeTruthy();
    }
  });

  it("n points uses only the last two, chronologically", () => {
    const result = deriveDelta([
      point("2026-05-04", "2026-05-10", 10),
      point("2026-05-11", "2026-05-17", 40),
      point("2026-05-18", "2026-05-24", 60),
      point("2026-05-25", "2026-05-31", 90),
    ]);
    expect(result).toMatchObject({ kind: "delta", current: 90, previous: 60, delta: 30 });
  });

  it("unsorted input is sorted before taking the last two", () => {
    const result = deriveDelta([
      point("2026-05-25", "2026-05-31", 90),
      point("2026-05-11", "2026-05-17", 40),
      point("2026-05-18", "2026-05-24", 60),
    ]);
    expect(result).toMatchObject({ kind: "delta", current: 90, previous: 60, delta: 30 });
  });

  it("grain mismatch → notComparable(\"grain\")", () => {
    const result = deriveDelta([
      point("2026-06-08", "2026-06-14", 50, "week"),
      point("2026-06-01", "2026-06-28", 60, "rolling_28d"),
    ]);
    expect(result).toEqual({ kind: "notComparable", reason: "grain" });
  });

  it("definition-version mismatch (same grain) → notComparable(\"definitionVersion\")", () => {
    const result = deriveDelta([
      point("2026-05-01", "2026-05-31", 50, "month", 1),
      point("2026-06-01", "2026-06-30", 60, "month", 2),
    ]);
    expect(result).toEqual({ kind: "notComparable", reason: "definitionVersion" });
  });

  it("different-length months, same grain and version → delta (exact comparison, not day-span)", () => {
    const result = deriveDelta([
      point("2026-04-01", "2026-04-30", 55, "month"), // 30-day month
      point("2026-05-01", "2026-05-31", 62, "month"), // 31-day month
    ]);
    expect(result.kind).toBe("delta");
    if (result.kind === "delta") {
      expect(result.current).toBe(62);
      expect(result.previous).toBe(55);
      expect(result.delta).toBe(7);
    }
  });
});

describe("personDelta", () => {
  type Row = {
    id: string;
    orgId: string;
    definitionId: string;
    subjectLevel: "person" | "team" | "org";
    personId: string | null;
    teamId: string | null;
    periodStart: string;
    periodEnd: string;
    periodGrain: "week" | "month" | "rolling_28d";
    value: number;
    attribution: "person" | "key_project" | "account";
    components: unknown;
    computedAt: Date;
  };
  function row(overrides: Partial<Row> & Pick<Row, "definitionId" | "subjectLevel" | "periodGrain" | "periodStart" | "periodEnd" | "value">): Row {
    return {
      id: "row-1",
      orgId: "org-1",
      personId: "person-1",
      teamId: null,
      attribution: "person",
      components: {},
      computedAt: new Date("2026-06-01T00:00:00.000Z"),
      ...overrides,
    };
  }
  type Def = {
    id: string;
    orgId: string | null;
    slug: string;
    version: number;
    name: string;
    subjectLevel: "person" | "team" | "org";
    components: unknown;
    status: "active" | "draft" | "retired";
    createdAt: Date;
  };
  function def(id: string, slug: string): Def {
    return {
      id,
      orgId: null,
      slug,
      version: 1,
      name: slug,
      subjectLevel: "person",
      components: [],
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }
  const defs: Def[] = [def("def-adoption-1", "adoption"), def("def-fluency-1", "fluency")];

  it("no prior row → null (never 0)", () => {
    const result = personDelta([], defs, "adoption", "month");
    expect(result).toBeNull();
    expect(result).not.toBe(0);
  });

  it("no matching definition/grain among prior rows → null", () => {
    const rows: Row[] = [
      row({
        definitionId: "def-fluency-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 55,
      }),
    ];
    expect(personDelta(rows, defs, "adoption", "month")).toBeNull();
  });

  it("returns the latest matching row's value", () => {
    const rows: Row[] = [
      row({
        definitionId: "def-adoption-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
        value: 40,
      }),
      row({
        definitionId: "def-adoption-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 65,
      }),
      // team-level row for the same definition/grain must not match.
      row({
        definitionId: "def-adoption-1",
        subjectLevel: "team",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 999,
      }),
    ];
    expect(personDelta(rows, defs, "adoption", "month")).toBe(65);
  });
});

describe("interpretScore", () => {
  it("bands at 0", () => {
    expect(interpretScore(0, "adoption").tone).toBe("low");
  });

  it("bands at the low/building boundary (39 vs 40)", () => {
    expect(interpretScore(39, "adoption").tone).toBe("low");
    expect(interpretScore(40, "adoption").tone).toBe("building");
  });

  it("bands at the building/strong boundary (69 vs 70)", () => {
    expect(interpretScore(69, "adoption").tone).toBe("building");
    expect(interpretScore(70, "adoption").tone).toBe("strong");
  });

  it("bands at 100", () => {
    expect(interpretScore(100, "adoption").tone).toBe("strong");
  });

  it("guidance is slug-specific — the same value reads differently per score", () => {
    const adoption = interpretScore(92, "adoption").guidance;
    const fluency = interpretScore(92, "fluency").guidance;
    const efficiency = interpretScore(92, "efficiency").guidance;
    expect(adoption).not.toBe(fluency);
    expect(fluency).not.toBe(efficiency);
    expect(adoption).not.toBe(efficiency);
  });

  it("efficiency guidance frames itself relative to spend, not usage alone", () => {
    expect(interpretScore(10, "efficiency").guidance).toMatch(/spend/i);
    expect(interpretScore(92, "efficiency").guidance).toMatch(/spend/i);
  });

  it("no guidance string references a layout element like 'the breakdown below'", () => {
    for (const slug of SCORE_SLUGS) {
      for (const v of [0, 39, 40, 69, 70, 100]) {
        expect(interpretScore(v, slug).guidance).not.toMatch(/breakdown below/i);
      }
    }
  });

  it("guidance text never states a benchmark/threshold as fact", () => {
    const banned = /industry (average|standard|benchmark)|top.quartile|percentile|typical (teams|orgs) score/i;
    for (const slug of SCORE_SLUGS) {
      for (const v of [0, 39, 40, 69, 70, 100]) {
        expect(banned.test(interpretScore(v, slug).guidance)).toBe(false);
      }
    }
  });
});

describe("formatDelta", () => {
  function delta(value: number, previousPeriodLabel = "May 1–31") {
    return {
      kind: "delta" as const,
      current: 0,
      previous: 0,
      delta: value,
      previousPeriodLabel,
    };
  }

  it("positive delta rounds and signs the text, direction 'up'", () => {
    const result = formatDelta(delta(6.4));
    expect(result).toMatchObject({ text: "+6", direction: "up" });
    expect(result.srText).toMatch(/increased by 6 points/i);
  });

  it("negative delta rounds and signs the text, direction 'down'", () => {
    const result = formatDelta(delta(-4.2));
    expect(result).toMatchObject({ text: "-4", direction: "down" });
    expect(result.srText).toMatch(/decreased by 4 points/i);
  });

  it("rounds to zero → direction 'none', text 'no change' (never a '+0' up-arrow)", () => {
    const result = formatDelta(delta(0.3));
    expect(result.direction).toBe("none");
    expect(result.text).toBe("no change");
    expect(result.text).not.toMatch(/^\+/);
  });

  it("srText is a full sentence mentioning the previous period", () => {
    expect(formatDelta(delta(6)).srText).toMatch(/previous period/i);
    expect(formatDelta(delta(0)).srText).toMatch(/previous period/i);
  });

  it("singular point for a 1-point delta", () => {
    expect(formatDelta(delta(1)).srText).toMatch(/1 point\b/);
    expect(formatDelta(delta(1)).srText).not.toMatch(/1 points/);
  });
});

describe("formatComponentDetail", () => {
  const components: ScoreComponent[] = [
    {
      key: "active_days",
      metric: "active_day",
      aggregation: "active_days",
      weight: 0.5,
      normalization: { min: 0, max: 20 },
    },
    {
      key: "tool_coverage",
      metric: "feature_used",
      aggregation: "distinct_dims",
      weight: 0.5,
      normalization: { min: 0, max: 6 },
    },
  ];

  it("marks a definition-present, breakdown-absent component as omitted with no raw/contribution", () => {
    const rows = formatComponentDetail(components, { active_days: { raw: 10, normalized: 50, weight: 0.5, contribution: 25 } });
    const coverage = rows.find((r) => r.key === "tool_coverage")!;
    expect(coverage.omitted).toBe(true);
    expect(coverage.raw).toBeUndefined();
    expect(coverage.normalized).toBeUndefined();
    expect(coverage.contribution).toBeUndefined();
    expect(coverage.weight).toBe(0.5);
    expect(coverage.calcSimple).toBeTruthy();

    const activeDays = rows.find((r) => r.key === "active_days")!;
    expect(activeDays.omitted).toBe(false);
    expect(activeDays.raw).toBe(10);
    expect(activeDays.contribution).toBe(25);
  });

  it("a null/undefined breakdown omits every component", () => {
    for (const breakdown of [null, undefined]) {
      const rows = formatComponentDetail(components, breakdown);
      expect(rows.every((r) => r.omitted)).toBe(true);
    }
  });

  it("tags each row with its component kind (plain vs ratio)", () => {
    const ratioComponent: ScoreComponent = {
      key: "effectiveness",
      ratio: {
        numerator: { metric: "suggestions_accepted", aggregation: "sum" },
        denominator: { metric: "suggestions_offered", aggregation: "sum" },
      },
      weight: 0.34,
      normalization: { min: 0, max: 0.5 },
    };
    const rows = formatComponentDetail([...components, ratioComponent], null);
    expect(rows.find((r) => r.key === "active_days")?.kind).toBe("plain");
    expect(rows.find((r) => r.key === "tool_coverage")?.kind).toBe("plain");
    expect(rows.find((r) => r.key === "effectiveness")?.kind).toBe("ratio");
  });
});

describe("deriveAttention", () => {
  it("empty input → []", () => {
    expect(
      deriveAttention({
        connections: [],
        gaps: [],
        sharedAccountCount: 0,
        scoreDrops: [],
      }),
    ).toEqual([]);
  });

  it("orders action items before info items", () => {
    const items = deriveAttention({
      connections: [{ id: "c1", label: "Cursor", status: "error" }],
      gaps: [{ kind: "sub_daily_unavailable" }],
      sharedAccountCount: 2,
      scoreDrops: [{ slug: "fluency", delta: -20 }],
    });
    expect(items[0].severity).toBe("action");
    const firstInfoIndex = items.findIndex((i) => i.severity === "info");
    const lastActionIndex = items.map((i) => i.severity).lastIndexOf("action");
    expect(lastActionIndex).toBeLessThan(firstInfoIndex);
  });

  it("an errored connection renders the caller-provided label, not a raw slug", () => {
    const items = deriveAttention({
      connections: [{ id: "c1", label: "GitHub Copilot", status: "error" }],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("action");
    expect(items[0].title).toBe("GitHub Copilot connection needs attention");
    expect(items[0].body).toContain("GitHub Copilot");
  });

  it("a paused connection renders as an info item, not action, and links to /connections", () => {
    const items = deriveAttention({
      connections: [{ id: "c1", label: "Cursor", status: "paused" }],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("info");
    expect(items[0].href).toBe("/connections");
    expect(items[0].body).toMatch(/Syncing is paused for Cursor/);
  });

  it("a score drop below the meaningful threshold is not surfaced", () => {
    const items = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [{ slug: "adoption", delta: -3 }],
    });
    expect(items).toEqual([]);
  });

  it("only the single largest same-grain drop is surfaced when several qualify", () => {
    const items = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [
        { slug: "adoption", delta: -12 },
        { slug: "fluency", delta: -25 },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/Fluency/);
    expect(items[0].body).toMatch(/previous period of the same kind/);
  });

  it("unresolvedSubjects > 0 produces an action item; omitted/0 produces none", () => {
    const withUnresolved = deriveAttention({
      connections: [],
      unresolvedSubjects: 3,
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(withUnresolved).toHaveLength(1);
    expect(withUnresolved[0].severity).toBe("action");
    expect(withUnresolved[0].body).toMatch(/aren't linked to a person yet/);
    expect(withUnresolved[0].body).toMatch(/Adoption, Fluency, and Efficiency can't compute/);

    const withoutUnresolved = deriveAttention({
      connections: [],
      unresolvedSubjects: 0,
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(withoutUnresolved).toEqual([]);
  });

  it("an exact repeat (same kind, same detail) is deduplicated", () => {
    const items = deriveAttention({
      connections: [],
      gaps: [
        { kind: "sub_daily_unavailable", detail: "Copilot" },
        { kind: "sub_daily_unavailable", detail: "Copilot" },
      ],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toHaveLength(1);
  });

  it("same kind, different detail: both are kept — no detail is silently dropped", () => {
    const items = deriveAttention({
      connections: [],
      gaps: [
        { kind: "sub_daily_unavailable", detail: "Copilot" },
        { kind: "sub_daily_unavailable", detail: "OpenAI" },
      ],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.body)).toEqual(
      expect.arrayContaining([expect.stringContaining("Copilot"), expect.stringContaining("OpenAI")]),
    );
  });
});
