import { describe, expect, it } from "vitest";
import {
  detectMilestones,
  deriveCompanionMilestones,
  MAX_MILESTONES,
  WEEKLY_CADENCE_MIN_WEEKS,
} from "../src/lib/milestones";
import {
  featureBreadthFromBreakdown,
  featureBreadthFromRows,
  type ComponentDetailRow,
} from "../src/lib/score-insights";
import { compareWorkflowDiversity } from "../src/lib/workflow-diversity";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// W5-F milestone detection (§8.4). Pure, recompute-on-read, no storage. Honesty
// invariant b: no input → no milestone (never a fabricated celebration); the
// crossing is STRICT (inherits `isNewBest`'s `>`, never `>=`), so a tie with the
// prior baseline never re-fires.

function row(
  key: string,
  opts: { raw?: number; omitted?: boolean } = {},
): ComponentDetailRow {
  const omitted = opts.omitted ?? false;
  return {
    key,
    label: key,
    kind: "plain",
    omitted,
    raw: omitted ? undefined : opts.raw,
    normalized: omitted ? undefined : 50,
    weight: 0.5,
    calcSimple: `calc for ${key}`,
  };
}

function breakdownEntry(raw: number) {
  return { raw, normalized: 50, weight: 0.5, contribution: 25 };
}

describe("detectMilestones — no fabrication on empty input", () => {
  it("returns nothing when no input signals fire", () => {
    expect(detectMilestones({})).toEqual([]);
    expect(
      detectMilestones({ newBests: [], breadth: null, firstAgentSession: false }),
    ).toEqual([]);
  });
});

describe("detectMilestones — feature breadth (W5-E comparator, strict >)", () => {
  it("fires when a threshold is newly crossed this period", () => {
    const ms = detectMilestones({
      breadth: compareWorkflowDiversity(5, 4), // crosses 5
    });
    expect(ms).toHaveLength(1);
    expect(ms[0].kind).toBe("feature-breadth");
    // Copy states the measured count AND the crossed threshold, grounded.
    expect(ms[0].body).toMatch(/5 distinct workflows/);
    expect(ms[0].body).toMatch(/5-workflow mark/);
  });

  it("a TIE with the prior baseline never fires (strict >, never >=)", () => {
    // current === previous at the threshold: nothing NEW was crossed.
    expect(detectMilestones({ breadth: compareWorkflowDiversity(5, 5) })).toEqual([]);
    // Already past the threshold last period → not a new crossing.
    expect(detectMilestones({ breadth: compareWorkflowDiversity(6, 5) })).toEqual([]);
  });

  it("names the HIGHEST threshold crossed when several cross at once", () => {
    // From 1 → 5 crosses 2, 3, and 5; the milestone celebrates the top mark.
    const ms = detectMilestones({ breadth: compareWorkflowDiversity(5, 1) });
    expect(ms[0].body).toMatch(/5-workflow mark/);
  });
});

describe("detectMilestones — first agent session + new-best", () => {
  it("first-agent-session fires on the boolean gate", () => {
    const ms = detectMilestones({ firstAgentSession: true });
    expect(ms.map((m) => m.kind)).toContain("first-agent-session");
  });

  it("new-best is trusted from the caller (strict gate lives upstream)", () => {
    const ms = detectMilestones({
      newBests: [{ label: "Adoption", value: 72 }],
    });
    expect(ms).toHaveLength(1);
    expect(ms[0].kind).toBe("new-best");
    expect(ms[0].body).toMatch(/reached 72/);
    // Measured-against-own-past framing, never a benchmark.
    expect(ms[0].body).toMatch(/your own past/i);
  });
});

describe("detectMilestones — weekly cadence is NARRATIVE ONLY (no-streak decision)", () => {
  it("fires only at/above the minimum active-week gate", () => {
    expect(
      detectMilestones({ activeWeeks: WEEKLY_CADENCE_MIN_WEEKS - 1 }),
    ).toEqual([]);
    const ms = detectMilestones({ activeWeeks: WEEKLY_CADENCE_MIN_WEEKS });
    expect(ms.map((m) => m.kind)).toContain("weekly-cadence");
  });

  it("carries NO counter in its copy — no number, no streak flame", () => {
    const ms = detectMilestones({ activeWeeks: 12 });
    const cadence = ms.find((m) => m.kind === "weekly-cadence")!;
    // The whole point of the §8.4 decision: no digit, nothing to protect.
    expect(/\d/.test(cadence.title)).toBe(false);
    expect(/\d/.test(cadence.body)).toBe(false);
    expect(cadence.body.toLowerCase()).not.toMatch(/streak|flame|xp|league/);
  });
});

describe("detectMilestones — ordering, cap, and copy hygiene", () => {
  it("orders by prominence and caps at MAX_MILESTONES", () => {
    const ms = detectMilestones({
      firstAgentSession: true,
      breadth: compareWorkflowDiversity(3, 2),
      newBests: [
        { label: "Adoption", value: 70 },
        { label: "Fluency", value: 65 },
      ],
      activeWeeks: 5,
    });
    // Five candidates → capped to MAX_MILESTONES.
    expect(ms).toHaveLength(MAX_MILESTONES);
    // Agentic transition leads, breadth next (the two highest weights).
    expect(ms[0].kind).toBe("first-agent-session");
    expect(ms[1].kind).toBe("feature-breadth");
  });

  it("no milestone copy states an invented benchmark/threshold as fact", () => {
    const ms = detectMilestones({
      firstAgentSession: true,
      breadth: compareWorkflowDiversity(5, 4),
      newBests: [{ label: "Adoption", value: 70 }],
      activeWeeks: 6,
    });
    for (const m of ms) {
      expect(BANNED_PHRASING.test(m.title)).toBe(false);
      expect(BANNED_PHRASING.test(m.body)).toBe(false);
    }
  });
});

describe("featureBreadth extraction helpers (query-free milestone input)", () => {
  it("reads the distinct-workflow count off the breadth/tool_coverage component raw", () => {
    expect(
      featureBreadthFromRows([row("depth", { raw: 3 }), row("breadth", { raw: 7 })]),
    ).toBe(7);
    expect(featureBreadthFromRows([row("tool_coverage", { raw: 4 })])).toBe(4);
  });

  it("returns null when the breadth component is omitted or absent (never a 0)", () => {
    expect(featureBreadthFromRows([row("breadth", { omitted: true })])).toBeNull();
    expect(featureBreadthFromRows([row("depth", { raw: 9 })])).toBeNull();
  });

  it("reads the same count from a stored breakdown jsonb", () => {
    expect(
      featureBreadthFromBreakdown({
        depth: breakdownEntry(2),
        breadth: breakdownEntry(6),
      }),
    ).toBe(6);
    expect(featureBreadthFromBreakdown({ tool_coverage: breakdownEntry(5) })).toBe(5);
    expect(featureBreadthFromBreakdown(null)).toBeNull();
    expect(featureBreadthFromBreakdown({ depth: breakdownEntry(3) })).toBeNull();
  });

  it("end-to-end: a period-over-period breadth crossing produces a milestone", () => {
    // Current period components (raw distinct-workflow count = 5).
    const current = featureBreadthFromRows([row("breadth", { raw: 5 })]);
    // Previous period stored breakdown (count = 4).
    const previous = featureBreadthFromBreakdown({ breadth: breakdownEntry(4) });
    const ms = detectMilestones({
      breadth: compareWorkflowDiversity(current!, previous ?? 0),
    });
    expect(ms.map((m) => m.kind)).toEqual(["feature-breadth"]);
  });
});

// U1.3: the SHARED companion milestone derivation (the Growth route's source;
// extracted so no surface can drift onto a different milestone computation). It
// reads the distinct-workflow count off BOTH periods' stored breakdowns and the
// agentic result's trend — same gates as the prior inline dashboard wiring.
describe("deriveCompanionMilestones — shared derivation (U1.3)", () => {
  const scoreRow = (breadth: number) => ({
    components: { breadth: breakdownEntry(breadth) },
  });

  it("fires the feature-breadth milestone on a real period-over-period crossing", () => {
    const ms = deriveCompanionMilestones({
      currentScoreRows: [scoreRow(5)],
      prevScoreRows: [scoreRow(4)],
      agentic: { kind: "noAgenticData" },
    });
    expect(ms.map((m) => m.kind)).toEqual(["feature-breadth"]);
  });

  it("a tie with the prior baseline fires nothing (strict >, no re-celebration)", () => {
    expect(
      deriveCompanionMilestones({
        currentScoreRows: [scoreRow(5)],
        prevScoreRows: [scoreRow(5)],
        agentic: { kind: "noAgenticData" },
      }),
    ).toEqual([]);
  });

  it("takes the MAX breadth across multiple current/prev score rows", () => {
    const ms = deriveCompanionMilestones({
      currentScoreRows: [scoreRow(3), scoreRow(6)],
      prevScoreRows: [scoreRow(4), scoreRow(2)],
      agentic: { kind: "noAgenticData" },
    });
    // current max 6, prev max 4 → crosses the 5-workflow mark.
    expect(ms.map((m) => m.kind)).toEqual(["feature-breadth"]);
    expect(ms[0].body).toMatch(/6 distinct workflows/);
  });

  it("gates first-agent-session on measured + ≤1 trend week; weekly rhythm on sustained trend", () => {
    // Measured, exactly one trend week → agents just showed up (no weekly rhythm yet).
    const early = deriveCompanionMilestones({
      currentScoreRows: [],
      prevScoreRows: [],
      agentic: { kind: "measured", trend: [{}] },
    });
    expect(early.map((m) => m.kind)).toEqual(["first-agent-session"]);

    // Measured, many trend weeks → the weekly rhythm, no "just showed up".
    const sustained = deriveCompanionMilestones({
      currentScoreRows: [],
      prevScoreRows: [],
      agentic: { kind: "measured", trend: [{}, {}, {}, {}, {}] },
    });
    expect(sustained.map((m) => m.kind)).toEqual(["weekly-cadence"]);
  });

  it("no evidence at all → no milestones (never fabricated)", () => {
    expect(
      deriveCompanionMilestones({
        currentScoreRows: [],
        prevScoreRows: [],
        agentic: { kind: "noActivity" },
      }),
    ).toEqual([]);
  });
});
