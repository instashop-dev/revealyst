import { describe, expect, it } from "vitest";
import type { MaturityAxes, MaturityView } from "../src/lib/maturity";
import { maturityCsvFilename, maturityViewToCsv } from "../src/lib/maturity-csv";

// W5-H deliverable 4: golden-file test for the board CSV export. Pins the exact
// bytes the serializer emits so a copy/format/tier regression is caught, and
// proves the confidence tiers survive into the spreadsheet.

const INSUFFICIENT_AXES: MaturityAxes = {
  breadth: { available: false },
  depth: { available: false },
  consistency: { available: false },
  activationPct: 42.857,
  activePeople: 18,
  knownPeople: 42,
};

/** A representative view exercising measured / modeled / directional tiers and
 * both populated and empty (—) states. */
const RICH_VIEW: MaturityView = {
  currentWindow: { from: "2026-04-08", to: "2026-06-30" },
  level: 2,
  axes: INSUFFICIENT_AXES,
  dataAsOf: "2026-06-30T00:00:00.000Z",
  stale: false,
  numbers: {
    activation: {
      confidence: "measured",
      activePeople: 18,
      knownPeople: 42,
      activationPct: 42.857,
      darkSeat: { confidence: "not_measured", reason: "n/a" },
    },
    adoptionVsBenchmark: { confidence: "modeled", benchmark: null },
    maturity: {
      confidence: "modeled",
      level: 2,
      axes: INSUFFICIENT_AXES,
      stale: false,
      trajectory: {
        kind: "comparable",
        priorLevel: 1,
        currentLevel: 2,
        levelDelta: 1,
        breadthDelta: 4,
        depthDelta: null,
        consistencyDelta: 2,
        priorWindow: { from: "2026-01-14", to: "2026-04-07" },
      },
    },
    plateau: {
      confidence: "directional",
      kind: "measured",
      plateaued: false,
      earlierMean: 8,
      recentMean: 9,
      changePct: 12.5,
      weeks: 12,
    },
    concentration: {
      confidence: "directional",
      concentration: {
        available: true,
        resolvedPeople: 12,
        totalPrompts: 1000,
        excludedPrompts: 0,
        top10SharePct: 34.2,
        top25SharePct: 61,
        top10Count: 2,
        top25Count: 3,
      },
    },
    costPerActiveUser: {
      confidence: "measured",
      cost: { reportedCents: 22212, units: 18, centsPerUnit: 1234 },
      activePeople: 18,
    },
    toolSprawl: {
      confidence: "measured",
      connectedTools: 5,
      activeTools: 2,
      idleTools: 3,
    },
    agenticShare: {
      confidence: "measured",
      agentic: {
        kind: "measured",
        ratePct: 27.3,
        agenticDays: 40,
        activeDays: 146,
        trend: [],
        weekToDate: null,
        delta: { kind: "first" },
        coveragePerVendor: [],
        unresolvedSubjects: 0,
      },
    },
  },
};

const EXPECTED_RICH =
  [
    "Revealyst AI Maturity export",
    "Report window,2026-04-08 to 2026-06-30",
    "Data as of,2026-06-30T00:00:00.000Z",
    "",
    "Number,Value,Confidence,Detail",
    "Activation,43%,measured,18 of 42 identified people active; idle paid seats not measured",
    "Adoption vs benchmark,—,modeled,No adoption score computed yet",
    "Maturity level & trajectory,Adopted (L2),modeled,Up 1 level(s) vs the prior quarter",
    'Plateau check,Growing,directional,Recent weeks +12.5% vs the earlier half of the window',
    "Concentration,Top 10% = 34%,directional,34% of attributed prompts from the top 2 of 12 people",
    "Cost per active user,$12.34,measured,$222.12 reported spend / 18 active people",
    "Tool sprawl,2 of 5,measured,2 tools producing usage; 3 connected but idle",
    "Agentic share,27%,measured,40 of 146 AI-active person-days used an agent",
  ].join("\r\n") + "\r\n";

describe("maturityViewToCsv", () => {
  it("emits the exact golden bytes with confidence tiers intact", () => {
    expect(maturityViewToCsv(RICH_VIEW)).toBe(EXPECTED_RICH);
  });

  it("names the file by the window end", () => {
    expect(maturityCsvFilename(RICH_VIEW)).toBe("revealyst-maturity-2026-06-30.csv");
  });

  it("serializes honest empty states, not fabricated zeros", () => {
    const empty: MaturityView = {
      ...RICH_VIEW,
      dataAsOf: null,
      numbers: {
        ...RICH_VIEW.numbers,
        activation: {
          confidence: "measured",
          activePeople: 0,
          knownPeople: 0,
          activationPct: null,
          darkSeat: { confidence: "not_measured", reason: "n/a" },
        },
        agenticShare: {
          confidence: "measured",
          agentic: { kind: "noAgenticData", activeDays: 0, unresolvedSubjects: 0 },
        },
      },
    };
    const csv = maturityViewToCsv(empty);
    expect(csv).toContain("Data as of,No successful sync yet");
    expect(csv).toContain(
      "Activation,Not enough data,measured,No people resolved yet; idle paid seats not measured",
    );
    expect(csv).toContain(
      "Agentic share,—,measured,No agent-capable telemetry yet (not a measured zero)",
    );
  });

  it("escapes fields containing commas or quotes (RFC-4180)", () => {
    // A benchmark source with a comma must be quoted so columns don't shift.
    const view: MaturityView = {
      ...RICH_VIEW,
      numbers: {
        ...RICH_VIEW.numbers,
        adoptionVsBenchmark: {
          confidence: "modeled",
          benchmark: {
            orgValue: 55,
            peerMedian: 60,
            source: "Vendor, 2026 report",
          } as MaturityView["numbers"]["adoptionVsBenchmark"]["benchmark"],
        },
      },
    };
    expect(maturityViewToCsv(view)).toContain(
      'Adoption vs benchmark,55,modeled,"Modeled peer reference 60 (Vendor, 2026 report)"',
    );
  });
});
