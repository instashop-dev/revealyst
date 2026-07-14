import { describe, expect, it } from "vitest";
import { computeAttributionTrend } from "../src/lib/attribution-trend";
import type { AgenticAdoption } from "../src/lib/agentic-adoption";
import { composeExecReport, type ExecReportInputs } from "../src/lib/exec-report";
import type {
  MaturityAxis,
  MaturityNumbers,
  MaturityTrajectory,
  MaturityView,
  PlateauNumber,
} from "../src/lib/maturity";
import { CAUSAL_BANNED_PHRASES } from "../src/lib/narrative-copy";
import { computeRecentMovement } from "../src/lib/recent-movement";
import type { SpendGovernanceView } from "../src/lib/spend-governance";

// Golden-file narrative tests for the monthly executive memo composer (W6-F).
// The composer is PURE and TEMPLATE-ONLY (zero LLM) — every line is asserted
// against an exact expected string, with special attention to the LOAD-BEARING
// honesty states: the two QoQ `notComparable` trajectory variants, the
// first-month attribution honesty, and the plateau growing/flattened split.
// Nothing here fabricates a number when an input is missing.

const AXIS = (value: number): MaturityAxis => ({
  available: true,
  value,
  components: [{ key: "activation", value, weight: 1 }],
});

function measuredAgentic(ratePct: number): AgenticAdoption {
  // The composer + reused narrative only read `.kind` and `.ratePct`; the rest
  // of the measured shape is filled minimally for the type.
  return {
    kind: "measured",
    ratePct,
    agenticDays: 40,
    activeDays: 100,
    trend: [],
    weekToDate: null,
    delta: { kind: "first" },
    coveragePerVendor: [],
    unresolvedSubjects: 0,
  } as unknown as AgenticAdoption;
}

function numbers(over: {
  trajectory: MaturityTrajectory;
  plateau: PlateauNumber;
  level?: MaturityNumbers["maturity"]["level"];
  stale?: boolean;
}): MaturityNumbers {
  const level = over.level ?? 2;
  return {
    activation: {
      confidence: "measured",
      activePeople: 12,
      knownPeople: 25,
      activationPct: 48,
      darkSeat: { confidence: "not_measured", reason: "no seat counts" },
    },
    adoptionVsBenchmark: {
      confidence: "modeled",
      benchmark: {
        slug: "adoption",
        label: "Adoption",
        orgValue: 62,
        peerMedian: 55,
        percentile: 60,
        source: "fixture",
      },
    },
    maturity: {
      confidence: "modeled",
      level,
      axes: axesFixture(),
      trajectory: over.trajectory,
      stale: over.stale ?? false,
    },
    plateau: over.plateau,
    concentration: {
      confidence: "directional",
      concentration: {
        available: true,
        resolvedPeople: 12,
        totalPrompts: 400,
        excludedPrompts: 10,
        top10SharePct: 35,
        top25SharePct: 60,
        top10Count: 2,
        top25Count: 3,
      },
    },
    costPerActiveUser: {
      confidence: "measured",
      cost: { reportedCents: 120000, units: 12, centsPerUnit: 10000 },
      activePeople: 12,
    },
    toolSprawl: {
      confidence: "measured",
      connectedTools: 4,
      activeTools: 3,
      idleTools: 1,
    },
    agenticShare: { confidence: "measured", agentic: measuredAgentic(41) },
  };
}

function axesFixture() {
  return {
    breadth: AXIS(60),
    depth: AXIS(50),
    consistency: AXIS(55),
    activationPct: 48,
    activePeople: 12,
    knownPeople: 25,
  };
}

function maturityView(over: {
  trajectory: MaturityTrajectory;
  plateau: PlateauNumber;
  level?: MaturityNumbers["maturity"]["level"];
  stale?: boolean;
}): MaturityView {
  const n = numbers(over);
  return {
    currentWindow: { from: "2026-04-08", to: "2026-06-30" },
    level: over.stale ? null : (over.level ?? 2),
    axes: axesFixture(),
    numbers: n,
    dataAsOf: "2026-06-30T12:00:00.000Z",
    stale: over.stale ?? false,
  };
}

function spendView(over: Partial<SpendGovernanceView>): SpendGovernanceView {
  return {
    budget: undefined,
    window: { from: "2026-06-01", to: "2026-06-30" },
    reportedCents: 0,
    estimatedCents: 0,
    alert: null,
    byTool: [],
    byModel: [],
    projection: null,
    costPerActiveDay: null,
    costPerPrompt: null,
    modelMixTrend: { available: false },
    ...over,
  };
}

/** A small real movement (via the pure compute) so the reused "In brief" prose
 * is non-empty — its own honesty is covered by narrative.test.ts. */
function sampleMovement() {
  const today = "2026-07-01";
  const activeDayRecords = [
    { subjectId: "s1", day: "2026-06-10", value: 1 },
    { subjectId: "s2", day: "2026-06-12", value: 1 },
    { subjectId: "s1", day: "2026-05-10", value: 1 },
  ];
  const spendRecords = [
    { subjectId: "s1", day: "2026-06-10", value: 5000 },
    { subjectId: "s1", day: "2026-05-10", value: 3000 },
  ];
  const identities = [
    { subjectId: "s1", personId: "p1" },
    { subjectId: "s2", personId: "p2" },
  ];
  return computeRecentMovement({
    today,
    spendReportedRecords: spendRecords,
    activeDayRecords,
    identities,
  });
}

function baseInputs(over: {
  trajectory: MaturityTrajectory;
  plateau: PlateauNumber;
  spend?: Partial<SpendGovernanceView>;
  attributionRows?: { day: string; attribution: string }[];
  level?: MaturityNumbers["maturity"]["level"];
  stale?: boolean;
}): ExecReportInputs {
  return {
    monthKey: "2026-06",
    orgName: "Acme Inc",
    maturity: maturityView({
      trajectory: over.trajectory,
      plateau: over.plateau,
      level: over.level,
      stale: over.stale,
    }),
    spend: spendView(over.spend ?? {}),
    attribution: computeAttributionTrend(over.attributionRows ?? []),
    narrative: { movement: sampleMovement(), agentic: measuredAgentic(41) },
  };
}

const GROWING: PlateauNumber = {
  confidence: "directional",
  kind: "measured",
  plateaued: false,
  earlierMean: 8,
  recentMean: 12,
  changePct: 50,
  weeks: 8,
};
const FLATTENED: PlateauNumber = {
  confidence: "directional",
  kind: "measured",
  plateaued: true,
  earlierMean: 12,
  recentMean: 12,
  changePct: 0,
  weeks: 8,
};

describe("composeExecReport — QoQ trajectory (LOAD-BEARING honest states)", () => {
  it("withholds the move when the prior quarter has no measured usage (insufficientHistory)", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
      }),
    );
    expect(report.trajectoryLine).toBe(
      "There's no comparable prior quarter yet, so we're not showing a quarter-over-quarter move — the earlier window has no measured usage to compare against.",
    );
    // Never a fabricated "flat" or "up".
    expect(report.trajectoryLine).not.toMatch(/up|down|held|rose|slipped/i);
  });

  it("withholds the move when the prior quarter is only partially covered (partialPrior)", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "partialPrior" },
        plateau: GROWING,
      }),
    );
    expect(report.trajectoryLine).toBe(
      "We're not showing a quarter-over-quarter move this month: your data doesn't yet cover enough of the prior quarter to compare honestly — doing so would compare against your own onboarding.",
    );
  });

  it("reports a real level rise from a comparable prior quarter", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: {
          kind: "comparable",
          priorLevel: 1,
          currentLevel: 2,
          levelDelta: 1,
          breadthDelta: 10,
          depthDelta: 5,
          consistencyDelta: 8,
          priorWindow: { from: "2026-01-14", to: "2026-04-07" },
        },
        plateau: GROWING,
      }),
    );
    expect(report.trajectoryLine).toBe(
      "Quarter over quarter, your level rose a level — from Trial to Adopted.",
    );
  });

  it("holds the level flat when the delta is zero (not a fabricated move)", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: {
          kind: "comparable",
          priorLevel: 2,
          currentLevel: 2,
          levelDelta: 0,
          breadthDelta: 0,
          depthDelta: 0,
          consistencyDelta: 0,
          priorWindow: { from: "2026-01-14", to: "2026-04-07" },
        },
        plateau: GROWING,
      }),
    );
    expect(report.trajectoryLine).toBe(
      "Quarter over quarter, your level held at Adopted.",
    );
  });

  it("withholds the delta when one quarter couldn't be placed", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: {
          kind: "comparable",
          priorLevel: null,
          currentLevel: 2,
          levelDelta: null,
          breadthDelta: null,
          depthDelta: null,
          consistencyDelta: null,
          priorWindow: { from: "2026-01-14", to: "2026-04-07" },
        },
        plateau: GROWING,
      }),
    );
    expect(report.trajectoryLine).toBe(
      "We can't show a quarter-over-quarter level move this month, because one of the two quarters didn't have enough data to place a level.",
    );
  });
});

describe("composeExecReport — plateau", () => {
  it("reports growing usage", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
      }),
    );
    expect(report.plateauLine).toBe(
      "Recent weekly usage is still growing, not flattening.",
    );
  });

  it("reports a flattened plateau", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: FLATTENED,
      }),
    );
    expect(report.plateauLine).toBe(
      "Recent weekly usage has flattened out — a directional prompt to look, not a verdict that anything is wrong.",
    );
  });

  it("withholds the plateau read when it is insufficient", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: { confidence: "directional", kind: "insufficient", weeks: 3 },
      }),
    );
    expect(report.plateauLine).toBe(
      "There aren't enough complete weeks of usage yet to say whether recent usage is growing or flattening.",
    );
  });
});

describe("composeExecReport — attribution (honesty-gap) line", () => {
  it("honest empty when there's no attributed usage", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        attributionRows: [],
      }),
    );
    expect(report.honestyLine).toBe(
      "There isn't enough attributed usage yet to show an attribution-coverage trend.",
    );
  });

  it("first measurable week makes no 'up from' claim", () => {
    // All rows in ONE ISO week → the trend has a single point → delta 'first'.
    const rows = [
      { day: "2026-06-15", attribution: "person" },
      { day: "2026-06-16", attribution: "account" },
    ];
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        attributionRows: rows,
      }),
    );
    expect(report.honestyLine).toBe(
      "In the latest measured week, 50% of usage was attributed by the vendor to a specific person — the first week we can measure this.",
    );
    expect(report.honestyLine).not.toMatch(/up from|down from/);
  });

  it("reports an improving coverage delta across two weeks", () => {
    const rows = [
      // Earlier week (week of Mon 2026-06-08): 1 of 2 person-attributed = 50%.
      { day: "2026-06-09", attribution: "person" },
      { day: "2026-06-10", attribution: "account" },
      // Latest week (week of Mon 2026-06-15): 2 of 2 = 100%.
      { day: "2026-06-16", attribution: "person" },
      { day: "2026-06-17", attribution: "person" },
    ];
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        attributionRows: rows,
      }),
    );
    expect(report.honestyLine).toContain("Attribution coverage is improving");
    expect(report.honestyLine).toContain("100%");
    expect(report.honestyLine).toContain("up from 50%");
  });
});

describe("composeExecReport — spend line (vendor-reported, never a bill)", () => {
  it("reports spend against a budget with the percent used", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        spend: {
          reportedCents: 190000,
          budget: {
            monthlyLimitCents: 500000,
          } as SpendGovernanceView["budget"],
          alert: { crossedThreshold: 0, pctUsed: 38, overBudget: false },
        },
      }),
    );
    expect(report.spendLine).toBe(
      "Vendor-reported AI spend so far this month is $1,900 — 38% of your $5,000 monthly budget.",
    );
  });

  it("names an honest no-spend state against a budget", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        spend: {
          reportedCents: 0,
          budget: {
            monthlyLimitCents: 500000,
          } as SpendGovernanceView["budget"],
        },
      }),
    );
    expect(report.spendLine).toBe(
      "No vendor-reported AI spend has been recorded this month against your $5,000 monthly budget.",
    );
  });

  it("surfaces estimated spend alongside, never summed into the budget percent", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        spend: {
          reportedCents: 100000,
          estimatedCents: 40000,
          budget: {
            monthlyLimitCents: 500000,
          } as SpendGovernanceView["budget"],
          alert: { crossedThreshold: 0, pctUsed: 20, overBudget: false },
        },
      }),
    );
    // Percent is 20% (reported only), NOT 28% (reported + estimated).
    expect(report.spendLine).toContain("20% of your $5,000");
    expect(report.spendLine).toContain(
      "A further $400 of estimated (not vendor-billed) usage",
    );
    expect(report.spendLine).not.toContain("28%");
  });
});

describe("composeExecReport — board sections + no-fabrication", () => {
  it("renders all eight numbers with their confidence tiers", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
      }),
    );
    expect(report.sections).toHaveLength(8);
    const byKey = Object.fromEntries(report.sections.map((s) => [s.key, s]));
    expect(byKey.activation.value).toBe("48% (12 of 25 people active)");
    expect(byKey.activation.confidenceLabel).toBe("Measured");
    expect(byKey.maturity.confidenceLabel).toBe("Modeled");
    expect(byKey.plateau.confidenceLabel).toBe("Directional");
    expect(byKey.toolSprawl.value).toBe("3 of 4 connected tools active (1 idle)");
    expect(byKey.agenticShare.value).toBe("41% of active days used an agent");
  });

  it("shows honest empties, never a fabricated zero, when a side is missing", () => {
    const inputs = baseInputs({
      trajectory: { kind: "notComparable", reason: "insufficientHistory" },
      plateau: GROWING,
    });
    // Wipe the measurable sides: no people, no cost, no benchmark, no agentic.
    inputs.maturity.numbers.activation.activationPct = null;
    inputs.maturity.numbers.costPerActiveUser.cost = null;
    inputs.maturity.numbers.adoptionVsBenchmark.benchmark = null;
    inputs.maturity.numbers.agenticShare.agentic = {
      kind: "noAgenticData",
      activeDays: 10,
      unresolvedSubjects: 0,
    };
    const report = composeExecReport(inputs);
    const byKey = Object.fromEntries(report.sections.map((s) => [s.key, s]));
    expect(byKey.activation.value).toBe("Not enough people to measure yet");
    expect(byKey.costPerActiveUser.value).toContain("Not enough data");
    expect(byKey.adoptionVsBenchmark.value).toBe("No adoption score yet to compare");
    expect(byKey.agenticShare.value).toBe(
      "No agent-capable telemetry from the connected tools yet",
    );
  });

  it("renders the three honest maturity headline states", () => {
    const placed = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: GROWING,
        level: 3,
      }),
    );
    expect(placed.maturityLine).toContain("Embedded (L3)");

    const stale = composeExecReport(
      baseInputs({
        trajectory: { kind: "notComparable", reason: "insufficientHistory" },
        plateau: { confidence: "directional", kind: "stale", weeks: 8 },
        stale: true,
      }),
    );
    expect(stale.maturityLine).toBe(
      "Your maturity level is withheld this month: no connected tool has synced inside the report's window, so the quiet weeks are unobserved, not measured. Re-syncing your connections brings it current.",
    );
    expect(stale.plateauLine).toContain("withholding the plateau read");
  });

  it("never uses a causal phrase anywhere in the composed memo", () => {
    const report = composeExecReport(
      baseInputs({
        trajectory: {
          kind: "comparable",
          priorLevel: 1,
          currentLevel: 2,
          levelDelta: 1,
          breadthDelta: 10,
          depthDelta: 5,
          consistencyDelta: 8,
          priorWindow: { from: "2026-01-14", to: "2026-04-07" },
        },
        plateau: GROWING,
        spend: {
          reportedCents: 190000,
          budget: {
            monthlyLimitCents: 500000,
          } as SpendGovernanceView["budget"],
          alert: { crossedThreshold: 0, pctUsed: 38, overBudget: false },
        },
      }),
    );
    const allProse = [
      ...report.summary,
      report.maturityLine,
      report.trajectoryLine,
      report.plateauLine,
      report.spendLine,
      report.honestyLine,
      ...report.sections.map((s) => `${s.value} ${s.caveat}`),
    ]
      .join(" ")
      .toLowerCase();
    for (const phrase of CAUSAL_BANNED_PHRASES) {
      expect(allProse).not.toContain(phrase);
    }
  });
});

describe("composeExecReport — capability coverage line (W7-6 follow-up)", () => {
  const base = baseInputs({
    trajectory: { kind: "notComparable", reason: "insufficientHistory" },
    plateau: GROWING,
  });

  it("renders one aggregate, count-only sentence for the strongest capability", () => {
    const report = composeExecReport({
      ...base,
      capabilityCoverage: [
        { label: "Cost-efficient AI usage", mastered: 4, total: 5 },
        { label: "Make AI part of daily work", mastered: 2, total: 6 },
      ],
    });
    expect(report.capabilityCoverageLine).toContain("4 of 5 people");
    expect(report.capabilityCoverageLine).toContain("Cost-efficient AI usage");
    expect(report.capabilityCoverageLine).toContain("2 capabilities");
    // Count-only — never a person name or a fabricated percentage.
    expect(report.capabilityCoverageLine).not.toMatch(/%/);
  });

  it("is empty when no capability cleared the floor (renderers skip it)", () => {
    expect(composeExecReport(base).capabilityCoverageLine).toBe("");
    expect(
      composeExecReport({ ...base, capabilityCoverage: [] }).capabilityCoverageLine,
    ).toBe("");
  });
});
