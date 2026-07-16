import { describe, expect, it } from "vitest";
import type { ScoreComponent } from "../src/contracts/scores";
import type { SpikeSignal } from "../src/lib/anomaly";
import { COACHING_GUIDANCE_SUFFIX } from "../src/lib/recommendation-catalog";
import type { ScoreTrendPoint } from "../src/lib/dashboard-trends";
import { LEGACY_CATALOG_RECOMMENDATIONS } from "./fixtures/recommendation-catalog";
import { SCORE_SLUGS } from "../src/lib/metrics-glossary";
import {
  connectionAttentionInputs,
  deriveAttention,
  deriveDelta,
  formatComponentDetail,
  formatDelta,
  interpretScore,
  personDeltaResult,
  personScoreDropAttribution,
  resolveSelfPersonId,
  type ComponentDetailRow,
} from "../src/lib/score-insights";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// ─── Shared builders for the F1.3 (score-drop attribution) + F1.1 (coaching)
// deriveAttention cases below ───

type Breakdown = Record<
  string,
  { raw: number; normalized: number; weight: number; contribution: number }
>;

/** One stored breakdown entry; only `contribution` matters for driver
 * attribution, the rest are filled with plausible numbers. */
function entry(contribution: number): Breakdown[string] {
  return { raw: contribution, normalized: contribution, weight: 0.5, contribution };
}

function componentRow(
  key: string,
  opts: { normalized?: number; weight?: number; omitted?: boolean },
): ComponentDetailRow {
  const omitted = opts.omitted ?? false;
  return {
    key,
    label: key,
    kind: "plain",
    omitted,
    normalized: omitted ? undefined : opts.normalized,
    weight: opts.weight ?? 0.5,
    calcSimple: `calc for ${key}`,
  };
}

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

describe("personDeltaResult", () => {
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
  function def(id: string, slug: string, version = 1): Def {
    return {
      id,
      orgId: null,
      slug,
      version,
      name: slug,
      subjectLevel: "person",
      components: [],
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }
  const defs: Def[] = [def("def-adoption-1", "adoption"), def("def-fluency-1", "fluency")];

  it("currentValue null → null (never a fabricated comparison)", () => {
    const result = personDeltaResult({
      currentValue: null,
      currentVersion: 1,
      prevRows: [],
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    expect(result).toBeNull();
  });

  it("no prior row (or no matching definition/grain among prior rows) → first (never 0)", () => {
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
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    expect(result).toEqual({ kind: "first" });
  });

  it("currentVersion undefined → notComparable (fails safe, never silently diffed)", () => {
    const rows: Row[] = [
      row({
        definitionId: "def-adoption-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 65,
      }),
    ];
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: undefined,
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    expect(result).toEqual({ kind: "notComparable", reason: "definitionVersion" });
  });

  it("matched row's definition version differs from currentVersion → notComparable", () => {
    const rows: Row[] = [
      row({
        definitionId: "def-adoption-1", // version 1
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 65,
      }),
    ];
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 2,
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    expect(result).toEqual({ kind: "notComparable", reason: "definitionVersion" });
  });

  it("a prior row referencing an unknown definitionId (dangling — not among this slug's known versions) is excluded from matching, never silently diffed into a fabricated delta", () => {
    const rows: Row[] = [
      row({
        definitionId: "def-deleted", // not present in `defs` at all
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 65,
      }),
    ];
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    // Falls out of the match set entirely (there is no known version of this
    // slug with that id), so it's treated the same as "no prior row" —
    // "first", never a fabricated comparison. The internal
    // `previousVersion === undefined` guard inside personDeltaResult exists
    // as defense-in-depth for the same failure mode should a future refactor
    // change how matches are found; this test documents the currently
    // reachable path to that same never-fabricate-a-delta outcome.
    expect(result).toEqual({ kind: "first" });
  });

  it("happy path: same definition version → a delta against the latest matching row (team-level rows never match)", () => {
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
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    expect(result).toEqual({
      kind: "delta",
      current: 70,
      previous: 65,
      delta: 5,
      previousPeriodLabel: "May 2026",
    });
  });

  // ─── Multi-person-org regression (invariant b) ───
  // `scores.results` has no person filter, so in a personal-kind org with an
  // invited second member `prevRows` holds BOTH people's rows. Without the
  // `personId` pin the selector picks the latest row by periodEnd regardless
  // of person — the caller's delta could be diffed against the OTHER member's
  // previous score. These pin the fix: two people's rows, where the other
  // person's row is the one the unpinned selection would pick.
  const multiPersonRows: Row[] = [
    // The caller's own latest previous row (April).
    row({
      id: "row-caller",
      personId: "person-caller",
      definitionId: "def-adoption-1",
      subjectLevel: "person",
      periodGrain: "month",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      value: 40,
    }),
    // The invited member's row — LATER periodEnd, so unpinned selection
    // (latest by periodEnd) would diff against this row, not the caller's.
    row({
      id: "row-other",
      personId: "person-other",
      definitionId: "def-adoption-1",
      subjectLevel: "person",
      periodGrain: "month",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      value: 20,
    }),
  ];

  it("multi-person org: the personId pin keeps the delta on the caller's own rows only", () => {
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: multiPersonRows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "April 2026",
      personId: "person-caller",
    });
    // 70 vs the caller's own 40 — never the other member's 20 (which would
    // have read as a fabricated +50 delta on the caller's card).
    expect(result).toEqual({
      kind: "delta",
      current: 70,
      previous: 40,
      delta: 30,
      previousPeriodLabel: "April 2026",
    });
  });

  it("multi-person org: a pinned person with no previous rows → first (never someone else's row)", () => {
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: multiPersonRows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
      personId: "person-third",
    });
    expect(result).toEqual({ kind: "first" });
  });

  it("no personId pin → unpinned latest-by-periodEnd selection (back-compat, org-of-one)", () => {
    const result = personDeltaResult({
      currentValue: 70,
      currentVersion: 1,
      prevRows: multiPersonRows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      previousPeriodLabel: "May 2026",
    });
    // Documents the pre-existing unpinned behavior callers without a pin get:
    // latest row by periodEnd, whoever's it is. Callers with multi-person rows
    // must pass `personId` (the dashboard does — see personal-self-view.tsx).
    expect(result).toEqual({
      kind: "delta",
      current: 70,
      previous: 20,
      delta: 50,
      previousPeriodLabel: "May 2026",
    });
  });

  it("multi-person org: personScoreDropAttribution resolves the pinned person's previous breakdown (driver stays in lockstep with the delta)", () => {
    const rows: Row[] = [
      row({
        id: "row-caller",
        personId: "person-caller",
        definitionId: "def-adoption-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
        value: 40,
        components: { active_days: { raw: 4, normalized: 20, weight: 1, contribution: 20 } },
      }),
      row({
        id: "row-other",
        personId: "person-other",
        definitionId: "def-adoption-1",
        subjectLevel: "person",
        periodGrain: "month",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        value: 20,
        components: { active_days: { raw: 2, normalized: 10, weight: 1, contribution: 10 } },
      }),
    ];
    const result = personScoreDropAttribution({
      currentVersion: 1,
      currentComponents: { active_days: { raw: 8, normalized: 40, weight: 1, contribution: 40 } },
      prevRows: rows,
      definitions: defs,
      slug: "adoption",
      grain: "month",
      personId: "person-caller",
    });
    // The previous breakdown is the CALLER's April row — the same row the
    // pinned delta diffed against — never the other member's May row.
    expect(result).toEqual({
      currentVersion: 1,
      previousVersion: 1,
      currentComponents: { active_days: { raw: 8, normalized: 40, weight: 1, contribution: 40 } },
      previousComponents: { active_days: { raw: 4, normalized: 20, weight: 1, contribution: 20 } },
    });
  });
});

describe("resolveSelfPersonId", () => {
  const person = (id: string, authUserId: string | null) => ({ id, authUserId });

  it("linked caller → their own person, even alongside other members", () => {
    const people = [person("p-other", "user-other"), person("p-me", "user-me")];
    expect(resolveSelfPersonId(people, "user-me")).toBe("p-me");
  });

  it("unlinked caller in an org-of-one → the sole person (real solo dashboards keep working)", () => {
    expect(resolveSelfPersonId([person("p-solo", null)], "user-me")).toBe(
      "p-solo",
    );
  });

  it("unlinked caller in a multi-person org → null (honest-empty, never an arbitrary member's rows)", () => {
    const people = [person("p-a", null), person("p-b", null)];
    expect(resolveSelfPersonId(people, "user-me")).toBeNull();
  });

  it("no people at all → null", () => {
    expect(resolveSelfPersonId([], "user-me")).toBeNull();
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
    for (const slug of SCORE_SLUGS) {
      for (const v of [0, 39, 40, 69, 70, 100]) {
        expect(BANNED_PHRASING.test(interpretScore(v, slug).guidance)).toBe(false);
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

  it("-0.5 rounds symmetrically to -1/down, NOT '-0'/none (Math.round(-0.5) === -0 pitfall)", () => {
    const result = formatDelta(delta(-0.5));
    expect(result).toMatchObject({ text: "-1", direction: "down" });
  });

  it("+0.5 rounds to +1/up — the same magnitude as -0.5 rounds the other way", () => {
    const result = formatDelta(delta(0.5));
    expect(result).toMatchObject({ text: "+1", direction: "up" });
  });

  it("-0.4 rounds to 'no change' (below the half-point either direction)", () => {
    const result = formatDelta(delta(-0.4));
    expect(result.direction).toBe("none");
    expect(result.text).toBe("no change");
  });

  it("+0.4 rounds to 'no change'", () => {
    const result = formatDelta(delta(0.4));
    expect(result.direction).toBe("none");
    expect(result.text).toBe("no change");
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
      connections: [{ label: "Cursor", status: "error" }],
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
      connections: [{ label: "GitHub Copilot", status: "error" }],
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
      connections: [{ label: "Cursor", status: "paused" }],
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

  it("unresolvedUsage: count > 0, viewer is admin, no scores yet → an action item", () => {
    const items = deriveAttention({
      connections: [],
      unresolvedUsage: { count: 3, viewerIsAdmin: true, scoresExist: false },
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("action");
    expect(items[0].body).toMatch(/aren't linked to a person yet/);
    expect(items[0].body).toMatch(/Adoption, Fluency, and Efficiency can't compute/);
  });

  it("unresolvedUsage: count 0 → nothing, even for an admin viewer with no scores", () => {
    const items = deriveAttention({
      connections: [],
      unresolvedUsage: { count: 0, viewerIsAdmin: true, scoresExist: false },
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toEqual([]);
  });

  it("unresolvedUsage: gated INSIDE deriveAttention — a non-admin viewer never sees the callout, even with a positive count and no scores", () => {
    const items = deriveAttention({
      connections: [],
      unresolvedUsage: { count: 3, viewerIsAdmin: false, scoresExist: false },
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toEqual([]);
  });

  it("unresolvedUsage: gated INSIDE deriveAttention — once scores exist, the callout stops even with a positive count and an admin viewer", () => {
    const items = deriveAttention({
      connections: [],
      unresolvedUsage: { count: 3, viewerIsAdmin: true, scoresExist: true },
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toEqual([]);
  });

  it("omitted unresolvedUsage → nothing", () => {
    const items = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
    });
    expect(items).toEqual([]);
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

describe("connectionAttentionInputs", () => {
  it("keeps only error/paused connections, maps to a vendor label, and drops id", () => {
    const result = connectionAttentionInputs([
      { id: "c1", vendor: "cursor", status: "error" },
      { id: "c2", vendor: "github_copilot", status: "active" },
      { id: "c3", vendor: "openai", status: "paused" },
    ]);
    expect(result).toEqual([
      { label: "Cursor", status: "error" },
      { label: "OpenAI", status: "paused" },
    ]);
    expect(result.every((c) => !("id" in c))).toBe(true);
  });

  it("empty input → []", () => {
    expect(connectionAttentionInputs([])).toEqual([]);
  });
});

describe("deriveAttention — F1.3 score-drop attribution", () => {
  const base = { connections: [], gaps: [], sharedAccountCount: 0 };

  it("names the component whose contribution fell most, using its glossary label", () => {
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "efficiency",
          delta: -35,
          attribution: {
            currentVersion: 1,
            previousVersion: 1,
            // output_per_spend fell 30; engagement_per_spend fell 5.
            currentComponents: {
              output_per_spend: entry(10),
              engagement_per_spend: entry(30),
            } satisfies Breakdown,
            previousComponents: {
              output_per_spend: entry(40),
              engagement_per_spend: entry(35),
            } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Efficiency dropped");
    // "Output per spend" is the glossary label for output_per_spend — a raw
    // key must never leak into the copy.
    expect(items[0].body).toContain("the part that dropped most was Output per spend");
    expect(items[0].body).not.toContain("output_per_spend");
  });

  it("a definition-version change → no driver claim (un-attributed drop copy, never a cross-version guess)", () => {
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "efficiency",
          delta: -35,
          attribution: {
            currentVersion: 2,
            previousVersion: 1,
            currentComponents: { output_per_spend: entry(10) } satisfies Breakdown,
            previousComponents: { output_per_spend: entry(40) } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).toContain("versus the previous period of the same kind.");
    expect(items[0].body).not.toContain("the part that dropped most");
  });

  it("a component omitted on one side is never blamed — the honest stopped-being-measurable copy renders instead", () => {
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "efficiency",
          delta: -35,
          attribution: {
            currentVersion: 1,
            previousVersion: 1,
            // engagement_per_spend ROSE; output_per_spend is omitted this
            // period (present previously) — the real cause is unattributable,
            // so no component is guessed as the driver; the measurability
            // asymmetry itself is stated instead.
            currentComponents: { engagement_per_spend: entry(25) } satisfies Breakdown,
            previousComponents: {
              engagement_per_spend: entry(20),
              output_per_spend: entry(45),
            } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).not.toContain("the part that dropped most");
    expect(items[0].body).toContain("isn't measurable this period");
  });

  it("omission asymmetry (reviewer scenario, verbatim): a 2-point breadth dip is never blamed for a 32-point drop whose cause is a component that stopped being measurable", () => {
    // prev fluency {breadth:20, depth:25, effectiveness:30} = 75; current
    // {breadth:18, depth:25} with effectiveness OMITTED (vendor funnel stopped
    // reporting). Breadth explains 2 of 32 points — naming it would be a
    // fabricated causal claim.
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "fluency",
          delta: -32,
          attribution: {
            currentVersion: 1,
            previousVersion: 1,
            currentComponents: {
              breadth: entry(18),
              depth: entry(25),
            } satisfies Breakdown,
            previousComponents: {
              breadth: entry(20),
              depth: entry(25),
              effectiveness: entry(30),
            } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).not.toContain("the part that dropped most");
    expect(items[0].body).not.toContain("Breadth");
    expect(items[0].body).toContain(
      "A part of this score that was measured last period isn't measurable this period, so the drop isn't pinned on any one part.",
    );
  });

  it("materiality floor: a small faller below half the drop is never named (un-attributed copy, no omission involved)", () => {
    // Every component measured on both sides; worst faller is effectiveness at
    // -3 against a -12 drop — below the 0.5 × |delta| = 6 floor, so nothing is
    // named (the breakdown genuinely can't account for the drop).
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "fluency",
          delta: -12,
          attribution: {
            currentVersion: 1,
            previousVersion: 1,
            currentComponents: {
              breadth: entry(18),
              depth: entry(25),
              effectiveness: entry(27),
            } satisfies Breakdown,
            previousComponents: {
              breadth: entry(20),
              depth: entry(25),
              effectiveness: entry(30),
            } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).not.toContain("the part that dropped most");
    expect(items[0].body).not.toContain("isn't measurable");
    expect(items[0].body).toContain("versus the previous period of the same kind.");
  });

  it("sign guard: a large RISING component never outranks a small material faller", () => {
    // output_per_spend ROSE 90; engagement_per_spend fell 10 against a -15
    // drop (≥ the 7.5 floor) — Engagement per spend is named, never the riser.
    const items = deriveAttention({
      ...base,
      scoreDrops: [
        {
          slug: "efficiency",
          delta: -15,
          attribution: {
            currentVersion: 1,
            previousVersion: 1,
            currentComponents: {
              output_per_spend: entry(100),
              engagement_per_spend: entry(30),
            } satisfies Breakdown,
            previousComponents: {
              output_per_spend: entry(10),
              engagement_per_spend: entry(40),
            } satisfies Breakdown,
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).toContain("the part that dropped most was Engagement per spend");
    expect(items[0].body).not.toContain("Output per spend");
  });

  it("no attribution supplied → the plain drop copy (backward-compatible)", () => {
    const items = deriveAttention({
      ...base,
      scoreDrops: [{ slug: "fluency", delta: -20 }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].body).toContain("versus the previous period of the same kind.");
    expect(items[0].body).not.toContain("the part that dropped most");
  });
});

describe("deriveAttention — F1.1 coaching recommendations", () => {
  // W6-C: deriveAttention no longer imports a static map — it receives catalog
  // rows. The legacy fixture (verbatim static-map content) drives these cases.
  const base = {
    connections: [],
    gaps: [],
    sharedAccountCount: 0,
    scoreDrops: [],
    recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
  };

  it("a measured, weak, non-trivial-weight component → one info recommendation carrying the honesty suffix and kind", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        { slug: "adoption", components: [componentRow("active_days", { normalized: 20, weight: 0.5 })] },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("info");
    expect(items[0].kind).toBe("recommendation");
    expect(items[0].title).toBe("Make AI part of the daily routine");
    expect(items[0].body.endsWith(COACHING_GUIDANCE_SUFFIX)).toBe(true);
    expect(items[0].href).toBeUndefined();
  });

  it("an omitted component is never coached on (no data ≠ measured-low)", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        { slug: "adoption", components: [componentRow("active_days", { omitted: true })] },
      ],
    });
    expect(items).toEqual([]);
  });

  it("a component at or above the weak band (normalized ≥ 40) gets no recommendation", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        { slug: "adoption", components: [componentRow("active_days", { normalized: 40, weight: 0.5 })] },
      ],
    });
    expect(items).toEqual([]);
  });

  it("a trivial-weight component gets no recommendation even when weak", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        { slug: "adoption", components: [componentRow("active_days", { normalized: 5, weight: 0.1 })] },
      ],
    });
    expect(items).toEqual([]);
  });

  it("a weak component with no mapped recommendation is skipped, not fabricated", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        { slug: "adoption", components: [componentRow("no_such_component", { normalized: 5, weight: 0.5 })] },
      ],
    });
    expect(items).toEqual([]);
  });

  it("at most two recommendations surface, weakest component first", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        {
          slug: "fluency",
          components: [
            componentRow("breadth", { normalized: 30, weight: 0.33 }),
            componentRow("depth", { normalized: 10, weight: 0.33 }),
            componentRow("effectiveness", { normalized: 20, weight: 0.34 }),
          ],
        },
      ],
    });
    const recs = items.filter((i) => i.kind === "recommendation");
    expect(recs).toHaveLength(2);
    // depth (10) is weakest, then effectiveness (20) — breadth (30) is cut.
    expect(recs[0].title).toBe("Use AI on more days, not just more per day");
    expect(recs[1].title).toBe("Look at why suggestions are being turned down");
  });

  it("same-signal components never burn both slots (reviewer scenario): adoption.active_days + fluency.depth dedupe to one, letting tool-coverage through", () => {
    // adoption.active_days and fluency.depth read the SAME 0–20 `active_day`
    // signal — both weak at 10, they'd tie and consume both slots with
    // near-identical advice, cutting the distinct tool-coverage guidance (20).
    const items = deriveAttention({
      ...base,
      scoreComponents: [
        {
          slug: "adoption",
          components: [
            componentRow("active_days", { normalized: 10, weight: 0.5 }),
            componentRow("tool_coverage", { normalized: 20, weight: 0.5 }),
          ],
        },
        {
          slug: "fluency",
          components: [componentRow("depth", { normalized: 10, weight: 0.33 })],
        },
      ],
    });
    const recs = items.filter((i) => i.kind === "recommendation");
    expect(recs).toHaveLength(2);
    const titles = recs.map((r) => r.title);
    // Exactly ONE active-days-signal recommendation…
    expect(
      titles.filter(
        (t) =>
          t === "Make AI part of the daily routine" ||
          t === "Use AI on more days, not just more per day",
      ),
    ).toHaveLength(1);
    // …and the distinct feature-breadth guidance survives the cap.
    expect(titles).toContain("Broaden which AI features get used");
  });

  it("recommendations sort BELOW real alerts — action first, then every other info item, then guidance", () => {
    const items = deriveAttention({
      ...base,
      connections: [{ label: "Cursor", status: "error" }],
      gaps: [{ kind: "sub_daily_unavailable" }],
      sharedAccountCount: 2,
      scoreDrops: [{ slug: "fluency", delta: -20 }],
      scoreComponents: [
        { slug: "adoption", components: [componentRow("active_days", { normalized: 10, weight: 0.5 })] },
      ],
    });
    // The recommendation is the very last item, and everything above it is a
    // non-recommendation.
    const last = items[items.length - 1];
    expect(last.kind).toBe("recommendation");
    expect(items.slice(0, -1).every((i) => i.kind !== "recommendation")).toBe(true);
    // The single action item still leads.
    expect(items[0].severity).toBe("action");
  });

  it("no scoreComponents (scores not computed yet) → no recommendations", () => {
    expect(deriveAttention({ ...base })).toEqual([]);
    expect(deriveAttention({ ...base, scoreComponents: [] })).toEqual([]);
  });

  it("every rendered recommendation body passes the banned-phrasing sweep", () => {
    const items = deriveAttention({
      ...base,
      scoreComponents: SCORE_SLUGS.map((slug) => ({
        slug,
        components: [
          componentRow("active_days", { normalized: 5, weight: 0.5 }),
          componentRow("tool_coverage", { normalized: 5, weight: 0.5 }),
          componentRow("breadth", { normalized: 5, weight: 0.33 }),
          componentRow("depth", { normalized: 5, weight: 0.33 }),
          componentRow("effectiveness", { normalized: 5, weight: 0.34 }),
          componentRow("output_per_spend", { normalized: 5, weight: 0.5 }),
          componentRow("engagement_per_spend", { normalized: 5, weight: 0.5 }),
        ],
      })),
    });
    const recs = items.filter((i) => i.kind === "recommendation");
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(BANNED_PHRASING.test(rec.title)).toBe(false);
      expect(BANNED_PHRASING.test(rec.body)).toBe(false);
    }
  });
});

// ─── F2.3 (I2/I3) anomaly + plateau integration ───

function spikeSignal(over: Partial<SpikeSignal> = {}): SpikeSignal {
  return {
    metric: "spend",
    day: "2026-06-14",
    value: 24_000,
    baselineMean: 10_000,
    baselineStdDev: 2_000,
    factor: 2.4,
    zScore: 7,
    baselineDays: 28,
    ...over,
  };
}

const plateauInput = {
  kind: "plateau" as const,
  peak: { weekStart: "2026-05-04", label: "May 4–10", activePeople: 10 },
  latest: { weekStart: "2026-06-01", label: "Jun 1–7", activePeople: 4 },
  decliningWeeks: 3,
  declinePct: 60,
};

describe("deriveAttention — F2.3 anomaly/plateau integration", () => {
  const base = {
    connections: [],
    gaps: [],
    sharedAccountCount: 0,
    scoreDrops: [],
    // W6-C: catalog rows supplied so the "anomalies sort above recommendations"
    // case can produce a rec; cases with no scoreComponents stay empty.
    recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
  };

  it("backward compatible: no anomalies/plateau inputs → unchanged (empty)", () => {
    expect(deriveAttention({ ...base })).toEqual([]);
    expect(deriveAttention({ ...base, anomalies: [], plateau: null })).toEqual([]);
  });

  it("a spike renders a directional 'anomaly'-kind info item naming the factor", () => {
    const items = deriveAttention({ ...base, anomalies: [spikeSignal()] });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("anomaly");
    expect(items[0].severity).toBe("info");
    expect(items[0].title).toMatch(/2\.4×/);
    // F3: the baseline denominator is MEASURED days and the copy must say so
    // ("days with spend"), never claim a calendar span it didn't average over.
    expect(items[0].body).toMatch(
      /across the 28 days with spend in the last 4 weeks/,
    );
    // Directional framing — "unusual", never "wrong".
    expect(items[0].body).toMatch(/unusual/i);
    expect(items[0].body).not.toMatch(/\bwrong\b/i);
  });

  it("F3: a SPARSE baseline's copy states the measured-day denominator, not a calendar window", () => {
    const items = deriveAttention({
      ...base,
      anomalies: [spikeSignal({ baselineDays: 14, factor: 3 })],
    });
    expect(items[0].body).toMatch(
      /across the 14 days with spend in the last 4 weeks/,
    );
    // The misleading old phrasing must not come back.
    expect(items[0].body).not.toMatch(/over the previous 14 days/);
  });

  it("a prompt-volume spike names prompt volume, not spend", () => {
    const items = deriveAttention({
      ...base,
      anomalies: [spikeSignal({ metric: "prompts", factor: 3 })],
    });
    expect(items[0].title).toMatch(/Prompt volume/);
    expect(items[0].body).toMatch(/prompt volume/);
  });

  it("a plateau renders a 'plateau'-kind info item stating the decline", () => {
    const items = deriveAttention({ ...base, plateau: plateauInput });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("plateau");
    expect(items[0].severity).toBe("info");
    expect(items[0].body).toMatch(/60%/);
    // F7: the stated run length is the true calendar span since the peak.
    expect(items[0].body).toMatch(/in the 3 weeks since/);
    expect(items[0].body).toMatch(/worth a look/i);
  });

  it("anomalies sort ABOVE coaching recommendations", () => {
    const items = deriveAttention({
      ...base,
      anomalies: [spikeSignal()],
      scoreComponents: [
        {
          slug: "adoption",
          components: [componentRow("active_days", { normalized: 5, weight: 0.5 })],
        },
      ],
    });
    const anomalyIdx = items.findIndex((i) => i.kind === "anomaly");
    const recIdx = items.findIndex((i) => i.kind === "recommendation");
    expect(anomalyIdx).toBeGreaterThanOrEqual(0);
    expect(recIdx).toBeGreaterThanOrEqual(0);
    expect(anomalyIdx).toBeLessThan(recIdx);
  });

  it("anomalies/plateau sort BELOW action items (an errored connection)", () => {
    const items = deriveAttention({
      ...base,
      connections: [{ label: "Cursor", status: "error" }],
      anomalies: [spikeSignal()],
      plateau: plateauInput,
    });
    expect(items[0].severity).toBe("action");
    const firstInfoIdx = items.findIndex((i) => i.severity === "info");
    const lastActionIdx = items.map((i) => i.severity).lastIndexOf("action");
    expect(lastActionIdx).toBeLessThan(firstInfoIdx);
    // Among info items, the spike sorts above the plateau.
    const anomalyIdx = items.findIndex((i) => i.kind === "anomaly");
    const plateauIdx = items.findIndex((i) => i.kind === "plateau");
    expect(anomalyIdx).toBeLessThan(plateauIdx);
  });

  it("anomaly + plateau copy passes the banned-phrasing sweep", () => {
    const items = deriveAttention({
      ...base,
      anomalies: [spikeSignal(), spikeSignal({ metric: "prompts" })],
      plateau: plateauInput,
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(BANNED_PHRASING.test(item.title)).toBe(false);
      expect(BANNED_PHRASING.test(item.body)).toBe(false);
    }
  });
});
