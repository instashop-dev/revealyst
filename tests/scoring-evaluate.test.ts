import { describe, expect, it } from "vitest";
import {
  scoreComponentsSchema,
  type ScoreComponent,
} from "../src/contracts/scores";
import {
  evaluateDefinition,
  type EngineRow,
} from "../src/scoring/evaluate";
import {
  daysInPeriod,
  periodFor,
  previousDay,
  type Period,
} from "../src/scoring/periods";

// Pure-engine unit suite: every aggregation in the closed vocabulary,
// normalization clamping, ratio edge cases, attribution propagation, and
// determinism — no DB, no fixtures, no I/O.

const JUNE: Period = {
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  periodGrain: "month",
};

function row(
  metricKey: string,
  day: string,
  value: number,
  overrides: Partial<Pick<EngineRow, "subjectId" | "dim" | "attribution">> = {},
): EngineRow {
  return {
    subjectId: overrides.subjectId ?? "subject-1",
    metricKey,
    day,
    dim: overrides.dim ?? "",
    value,
    attribution: overrides.attribution ?? "person",
  };
}

function byMetric(rows: EngineRow[]): Map<string, EngineRow[]> {
  const map = new Map<string, EngineRow[]>();
  for (const r of rows) {
    map.set(r.metricKey, [...(map.get(r.metricKey) ?? []), r]);
  }
  return map;
}

/** Parse through the frozen contract so a malformed test definition fails
 * loudly instead of testing something the contract would reject. */
function components(raw: unknown): ScoreComponent[] {
  return scoreComponentsSchema.parse(raw);
}

function single(
  aggregation: string,
  metric = "prompts",
  normalization = { min: 0, max: 100 },
): ScoreComponent[] {
  return components([
    { key: "c", weight: 1, normalization, metric, aggregation },
  ]);
}

describe("periods", () => {
  it("month covers the calendar month of the anchor", () => {
    expect(periodFor("month", "2026-06-15")).toEqual(JUNE);
    expect(periodFor("month", "2026-02-10")).toEqual({
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      periodGrain: "month",
    });
  });

  it("week is ISO Monday..Sunday", () => {
    // 2026-06-15 is a Monday.
    expect(periodFor("week", "2026-06-15")).toEqual({
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      periodGrain: "week",
    });
    expect(periodFor("week", "2026-06-21")).toEqual({
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      periodGrain: "week",
    });
  });

  it("rolling_28d ends at the anchor inclusive", () => {
    const p = periodFor("rolling_28d", "2026-06-15");
    expect(p).toEqual({
      periodStart: "2026-05-19",
      periodEnd: "2026-06-15",
      periodGrain: "rolling_28d",
    });
    expect(daysInPeriod(p)).toBe(28);
  });

  it("daysInPeriod is inclusive", () => {
    expect(daysInPeriod(JUNE)).toBe(30);
  });

  it("previousDay crosses month boundaries", () => {
    expect(previousDay("2026-07-01")).toBe("2026-06-30");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("rejects malformed days", () => {
    expect(() => periodFor("month", "June 2026")).toThrow(/invalid/);
  });
});

describe("aggregations", () => {
  it("sum totals values over the period", () => {
    const result = evaluateDefinition(
      single("sum"),
      byMetric([row("prompts", "2026-06-01", 30), row("prompts", "2026-06-02", 20)]),
      JUNE,
    );
    expect(result?.components.c).toEqual({
      raw: 50,
      normalized: 50,
      weight: 1,
      contribution: 50,
    });
    expect(result?.value).toBe(50);
  });

  it("avg_per_day divides by calendar days in the period, not active days", () => {
    const result = evaluateDefinition(
      single("avg_per_day", "prompts", { min: 0, max: 10 }),
      byMetric([row("prompts", "2026-06-01", 90)]),
      JUNE,
    );
    expect(result?.components.c.raw).toBe(3); // 90 / 30 days
  });

  it("active_days counts distinct days unioned across subjects", () => {
    const result = evaluateDefinition(
      single("active_days", "active_day", { min: 0, max: 10 }),
      byMetric([
        row("active_day", "2026-06-01", 1, { subjectId: "a" }),
        row("active_day", "2026-06-01", 1, { subjectId: "b" }), // same day, 2nd subject
        row("active_day", "2026-06-02", 1, { subjectId: "a" }),
      ]),
      JUNE,
    );
    expect(result?.components.c.raw).toBe(2);
  });

  it("distinct_dims counts distinct non-empty dims", () => {
    const result = evaluateDefinition(
      single("distinct_dims", "feature_used", { min: 0, max: 6 }),
      byMetric([
        row("feature_used", "2026-06-01", 1, { dim: "feature=mcp" }),
        row("feature_used", "2026-06-02", 1, { dim: "feature=mcp" }),
        row("feature_used", "2026-06-02", 1, { dim: "feature=chat_panel" }),
        row("feature_used", "2026-06-03", 1), // empty dim never counts
      ]),
      JUNE,
    );
    expect(result?.components.c.raw).toBe(2);
  });
});

describe("normalization", () => {
  it("clamps below min to 0 and above max to 100", () => {
    const under = evaluateDefinition(
      single("sum", "prompts", { min: 100, max: 200 }),
      byMetric([row("prompts", "2026-06-01", 50)]),
      JUNE,
    );
    expect(under?.components.c.normalized).toBe(0);

    const over = evaluateDefinition(
      single("sum", "prompts", { min: 0, max: 10 }),
      byMetric([row("prompts", "2026-06-01", 50)]),
      JUNE,
    );
    expect(over?.components.c.normalized).toBe(100);
    expect(over?.value).toBe(100);
  });

  it("weights split contributions and the value stays in 0..100", () => {
    const twoComponents = components([
      {
        key: "a",
        weight: 0.5,
        normalization: { min: 0, max: 100 },
        metric: "prompts",
        aggregation: "sum",
      },
      {
        key: "b",
        weight: 0.5,
        normalization: { min: 0, max: 100 },
        metric: "sessions",
        aggregation: "sum",
      },
    ]);
    const result = evaluateDefinition(
      twoComponents,
      byMetric([
        row("prompts", "2026-06-01", 80),
        row("sessions", "2026-06-01", 40),
      ]),
      JUNE,
    );
    expect(result?.components.a.contribution).toBe(40);
    expect(result?.components.b.contribution).toBe(20);
    expect(result?.value).toBe(60);
  });
});

describe("ratio components", () => {
  const acceptance = components([
    {
      key: "acceptance",
      weight: 1,
      normalization: { min: 0, max: 0.5 },
      ratio: {
        numerator: { metric: "suggestions_accepted", aggregation: "sum" },
        denominator: { metric: "suggestions_offered", aggregation: "sum" },
      },
    },
  ]);

  it("computes numerator / denominator", () => {
    const result = evaluateDefinition(
      acceptance,
      byMetric([
        row("suggestions_accepted", "2026-06-01", 38),
        row("suggestions_offered", "2026-06-01", 120),
      ]),
      JUNE,
    );
    expect(result?.components.acceptance.raw).toBe(0.3167); // round4(38/120)
    expect(result?.components.acceptance.normalized).toBeCloseTo(63.3333, 3);
  });

  it("both sides present but denominator aggregates to 0 floors raw at 0 — never NaN or Infinity", () => {
    const result = evaluateDefinition(
      acceptance,
      byMetric([
        row("suggestions_accepted", "2026-06-01", 38),
        row("suggestions_offered", "2026-06-01", 0),
      ]),
      JUNE,
    );
    expect(result?.components.acceptance.raw).toBe(0);
    expect(result?.value).toBe(0);
    expect(Number.isFinite(result!.value)).toBe(true);
  });

  it("denominator absent (no rows, not just zero) is not a computable rate — omitted, never fabricated as 0", () => {
    const result = evaluateDefinition(
      acceptance,
      byMetric([row("suggestions_accepted", "2026-06-01", 38)]),
      JUNE,
    );
    // The lone component was omitted for lack of data → nothing was
    // consumed → the whole-definition honesty guard applies.
    expect(result).toBeNull();
  });

  it("numerator absent (no rows), denominator present — also not a computable rate, never floors to 0", () => {
    // The exact asymmetry the adversarial pre-review found live: real spend
    // (denominator) with no usage data yet (numerator) must never read as
    // "real spend, zero output."
    const result = evaluateDefinition(
      acceptance,
      byMetric([row("suggestions_offered", "2026-06-01", 120)]),
      JUNE,
    );
    expect(result).toBeNull();
  });

  it("a ratio component missing one side is omitted, not zeroed, alongside a component that does have data", () => {
    const mixed = components([
      {
        key: "days",
        weight: 0.5,
        normalization: { min: 0, max: 20 },
        metric: "active_day",
        aggregation: "active_days",
      },
      {
        key: "acceptance",
        weight: 0.5,
        normalization: { min: 0, max: 0.5 },
        ratio: {
          numerator: { metric: "suggestions_accepted", aggregation: "sum" },
          denominator: { metric: "suggestions_offered", aggregation: "sum" },
        },
      },
    ]);
    const result = evaluateDefinition(
      mixed,
      byMetric([row("active_day", "2026-06-01", 1)]), // no suggestions data at all
      JUNE,
    );
    expect(result).not.toBeNull();
    // Only the component with real data is in the breakdown — the ratio
    // component is absent entirely, not present with a fabricated raw 0.
    expect(result?.components).toEqual({
      days: { raw: 1, normalized: 5, weight: 0.5, contribution: 2.5 },
    });
    expect(result?.components.acceptance).toBeUndefined();
    expect(result?.value).toBe(2.5);
  });
});

describe("attribution propagation", () => {
  it("propagates the weakest attribution across all consumed rows", () => {
    const result = evaluateDefinition(
      single("active_days", "active_day", { min: 0, max: 10 }),
      byMetric([
        row("active_day", "2026-06-01", 1, { attribution: "person" }),
        row("active_day", "2026-06-02", 1, { attribution: "account" }),
        row("active_day", "2026-06-03", 1, { attribution: "key_project" }),
      ]),
      JUNE,
    );
    expect(result?.attribution).toBe("account");
  });

  it("ratio components consume both sides' attributions", () => {
    const acceptance = components([
      {
        key: "acceptance",
        weight: 1,
        normalization: { min: 0, max: 1 },
        ratio: {
          numerator: { metric: "suggestions_accepted", aggregation: "sum" },
          denominator: { metric: "suggestions_offered", aggregation: "sum" },
        },
      },
    ]);
    const result = evaluateDefinition(
      acceptance,
      byMetric([
        row("suggestions_accepted", "2026-06-01", 10, { attribution: "person" }),
        row("suggestions_offered", "2026-06-01", 20, {
          attribution: "key_project",
        }),
      ]),
      JUNE,
    );
    expect(result?.attribution).toBe("key_project");
  });

  it("stays person when every input is person-attributed", () => {
    const result = evaluateDefinition(
      single("sum"),
      byMetric([row("prompts", "2026-06-01", 5)]),
      JUNE,
    );
    expect(result?.attribution).toBe("person");
  });
});

describe("honesty rules", () => {
  it("returns null when no component consumed any row — absence is not a 0 score", () => {
    expect(evaluateDefinition(single("sum"), new Map(), JUNE)).toBeNull();
  });

  it("scores partial data: a component with no rows contributes raw 0", () => {
    const twoComponents = components([
      {
        key: "present",
        weight: 0.5,
        normalization: { min: 0, max: 10 },
        metric: "prompts",
        aggregation: "sum",
      },
      {
        key: "absent",
        weight: 0.5,
        normalization: { min: 0, max: 10 },
        metric: "sessions",
        aggregation: "sum",
      },
    ]);
    const result = evaluateDefinition(
      twoComponents,
      byMetric([row("prompts", "2026-06-01", 10)]),
      JUNE,
    );
    expect(result).not.toBeNull();
    expect(result?.components.present.contribution).toBe(50);
    expect(result?.components.absent).toEqual({
      raw: 0,
      normalized: 0,
      weight: 0.5,
      contribution: 0,
    });
    expect(result?.value).toBe(50);
  });
});

describe("determinism", () => {
  it("identical inputs produce identical results", () => {
    const rows = byMetric([
      row("active_day", "2026-06-01", 1, { attribution: "account" }),
      row("feature_used", "2026-06-02", 1, { dim: "feature=mcp" }),
    ]);
    const twoComponents = components([
      {
        key: "days",
        weight: 0.5,
        normalization: { min: 0, max: 20 },
        metric: "active_day",
        aggregation: "active_days",
      },
      {
        key: "coverage",
        weight: 0.5,
        normalization: { min: 0, max: 6 },
        metric: "feature_used",
        aggregation: "distinct_dims",
      },
    ]);
    const first = evaluateDefinition(twoComponents, rows, JUNE);
    const second = evaluateDefinition(twoComponents, rows, JUNE);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
