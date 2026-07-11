import { describe, expect, it } from "vitest";
import type { AgenticAdoption } from "../src/lib/agentic-adoption";
import type { AttributionTrend } from "../src/lib/attribution-trend";
import {
  composeNarrative,
  MAX_NARRATIVE_SENTENCES,
  type NarrativeNotableEvent,
} from "../src/lib/narrative";
import {
  CAUSAL_BANNED_PHRASES,
  NARRATIVE_COPY,
} from "../src/lib/narrative-copy";
import type { RawMetricDelta } from "../src/lib/raw-metric-delta";
import type {
  MovementMetric,
  RecentMovement,
} from "../src/lib/recent-movement";

// F2.4 narrative composer (I7). Every sentence must come from a measured input
// with an honest kind — a notComparable/first input never yields a fabricated
// "up from". Copy must stay non-causal.

function deltaMetric(
  key: MovementMetric["key"],
  current: number,
  previous: number,
  unit: MovementMetric["unit"] = "count",
): MovementMetric {
  const delta: RawMetricDelta = {
    kind: "delta",
    current,
    previous,
    delta: current - previous,
    pctChange: previous > 0 ? ((current - previous) / previous) * 100 : null,
    previousPeriodLabel: "May 1–28",
  };
  return { key, unit, current, delta };
}

function firstMetric(
  key: MovementMetric["key"],
  current: number,
  unit: MovementMetric["unit"] = "count",
): MovementMetric {
  return { key, unit, current, delta: { kind: "first", current } };
}

function noDataMetric(
  key: MovementMetric["key"],
  unit: MovementMetric["unit"] = "count",
): MovementMetric {
  return {
    key,
    unit,
    current: 0,
    delta: { kind: "notComparable", reason: "noData" },
  };
}

function movement(metrics: MovementMetric[]): RecentMovement {
  return {
    periodDays: 28,
    currentFrom: "2026-06-01",
    currentTo: "2026-06-28",
    previousFrom: "2026-05-04",
    previousTo: "2026-05-31",
    metrics,
  };
}

const AGENTIC_MEASURED: Extract<AgenticAdoption, { kind: "measured" }> = {
  kind: "measured",
  ratePct: 34,
  agenticDays: 34,
  activeDays: 100,
  trend: [],
  weekToDate: null,
  delta: { kind: "first" },
  coveragePerVendor: [],
  unresolvedSubjects: 0,
};

const ATTRIBUTION_UP: Extract<AttributionTrend, { kind: "measured" }> = {
  kind: "measured",
  currentPct: 92,
  currentWeekStart: "2026-06-22",
  windowPct: 85,
  personDays: 100,
  totalDays: 120,
  byLevel: {
    person: { days: 100, pct: 83 },
    key_project: { days: 10, pct: 8 },
    account: { days: 10, pct: 8 },
  },
  trend: [],
  delta: {
    kind: "delta",
    currentPct: 92,
    previousPct: 71,
    deltaPct: 21,
    previousWeekStart: "2026-04-06",
  },
};

describe("composeNarrative", () => {
  it("healthy org: activity delta + agentic + spend + improving-coverage close", () => {
    const n = composeNarrative({
      movement: movement([
        deltaMetric("active_people", 12, 9),
        deltaMetric("reported_spend", 19000, 19000, "cents"),
      ]),
      agentic: AGENTIC_MEASURED,
      attribution: ATTRIBUTION_UP,
    });
    const text = n.sentences.join(" ");
    expect(text).toContain("Over the last 4 weeks, 12 people were active");
    expect(text).toContain("up from 9");
    expect(text).toContain("34% of active days");
    // Spend flat (19000 vs 19000) → "held steady", not a fabricated move.
    expect(text).toContain("held steady around $190");
    expect(text).toContain("92% of usage is now attributed");
    expect(text).toContain("up from 71%");
    expect(n.sentences.length).toBeLessThanOrEqual(MAX_NARRATIVE_SENTENCES);
  });

  it("first-period org: honest 'first period' states, never a comparison", () => {
    const n = composeNarrative({
      movement: movement([
        firstMetric("active_people", 5),
        firstMetric("reported_spend", 19000, "cents"),
      ]),
      // A first-period org typically has no agent-capable telemetry yet.
      agentic: { kind: "noAgenticData", activeDays: 12, unresolvedSubjects: 0 },
      attribution: { kind: "empty" },
    });
    const text = n.sentences.join(" ");
    expect(text).toContain("the first period we can measure");
    expect(text).toContain("5 people were active");
    // Spend first-period states the value plainly, no "up from".
    expect(text).toContain("Spend over the period was around $190");
    expect(text).not.toMatch(/up from|down from/);
    // No agentic sentence (no measured rate), no close.
    expect(text).not.toContain("% of active days");
    expect(text).not.toContain("attributed to a specific person");
  });

  it("notComparable movement yields no sentence — never a fabricated 'up from'", () => {
    const n = composeNarrative({
      movement: movement([
        noDataMetric("active_people"),
        noDataMetric("reported_spend", "cents"),
      ]),
      agentic: { kind: "noActivity", unresolvedSubjects: 0 },
      attribution: { kind: "empty" },
    });
    expect(n.sentences).toHaveLength(0);
  });

  it("single active person uses singular grammar", () => {
    const n = composeNarrative({
      movement: movement([firstMetric("active_people", 1)]),
      agentic: { kind: "noActivity", unresolvedSubjects: 0 },
    });
    expect(n.sentences[0]).toContain("1 person was active");
  });

  it("spike + plateau org: directional events are hedged and dated", () => {
    const events: NarrativeNotableEvent[] = [
      { kind: "spike", subject: "prompts", multiple: 3, onDate: "2026-06-30" },
      { kind: "plateau", subject: "active-people" },
    ];
    const n = composeNarrative({
      movement: movement([deltaMetric("active_people", 10, 10)]),
      agentic: AGENTIC_MEASURED,
      notableEvents: events,
    });
    const text = n.sentences.join(" ");
    expect(text).toContain("worth a look");
    expect(text).toContain("3× your usual on Jun 30");
    expect(text).toContain("flattened out");
  });

  it("caps length at maxSentences, dropping the tail first", () => {
    const n = composeNarrative({
      movement: movement([
        deltaMetric("active_people", 12, 9),
        deltaMetric("reported_spend", 20000, 15000, "cents"),
      ]),
      agentic: AGENTIC_MEASURED,
      attribution: ATTRIBUTION_UP,
      notableEvents: [
        { kind: "spike", subject: "prompts", multiple: 3, onDate: "2026-06-30" },
      ],
      maxSentences: 2,
    });
    expect(n.sentences).toHaveLength(2);
    // Kept the highest-priority two (activity, agentic); dropped the close.
    expect(n.sentences.join(" ")).not.toContain("attributed to a specific person");
  });

  it("steady activity (flat delta) reads 'about the same', not a fake move", () => {
    const n = composeNarrative({
      movement: movement([deltaMetric("active_people", 10, 10)]),
      agentic: { kind: "noActivity", unresolvedSubjects: 0 },
    });
    expect(n.sentences[0]).toContain("about the same as the period before");
    expect(n.sentences[0]).not.toMatch(/up from|down from/);
  });
});

describe("narrative copy — no causal language (invariant b)", () => {
  it("every NARRATIVE_COPY template is free of causal phrasing", () => {
    const samples = [
      NARRATIVE_COPY.activityDelta({
        period: "the last 4 weeks",
        people: 12,
        direction: "up",
        previous: 9,
      }),
      NARRATIVE_COPY.activitySteady({ period: "the last 4 weeks", people: 12 }),
      NARRATIVE_COPY.activityFirst({ period: "the last 4 weeks", people: 5 }),
      NARRATIVE_COPY.agentic({ ratePct: 34 }),
      NARRATIVE_COPY.spendDelta({
        amount: "$200",
        direction: "up",
        previous: "$150",
      }),
      NARRATIVE_COPY.spendSteady({ amount: "$190" }),
      NARRATIVE_COPY.spendFirst({ amount: "$190" }),
      NARRATIVE_COPY.notableSpike({ subject: "prompts", multiple: 3, day: "Jun 30" }),
      NARRATIVE_COPY.notablePlateau({ subject: "active-people" }),
      NARRATIVE_COPY.closeAttributionUp({ currentPct: 92, previousPct: 71 }),
    ];
    for (const sentence of samples) {
      const lower = sentence.toLowerCase();
      for (const banned of CAUSAL_BANNED_PHRASES) {
        expect(
          lower.includes(banned),
          `"${sentence}" contains banned causal phrase "${banned}"`,
        ).toBe(false);
      }
    }
  });
});
