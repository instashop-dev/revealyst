import { describe, expect, it } from "vitest";
import {
  computeAxes,
  computeMaturity,
  computePlateau,
  mapLevel,
  maturityWindows,
  type IdentityLinkLike,
  type MaturityAxes,
  type MaturityAxis,
  type MaturityInput,
  type MetricRowLike,
} from "../src/lib/maturity";
import {
  MATURITY_AXIS_COPY,
  MATURITY_LEVEL_COPY,
  MATURITY_LEVEL_NONE_COPY,
  MATURITY_LEVELS,
  MATURITY_NOT_SCORED,
  MATURITY_NUMBER_COPY,
} from "../src/lib/maturity-glossary";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// A fixed anchor so window arithmetic is deterministic. windowTo is "today"
// (partial, excluded); the current window is the 12 whole weeks ending
// yesterday (2026-06-30), i.e. 2026-04-08 … 2026-06-30.
const WINDOW_TO = "2026-07-01";
const WIN = maturityWindows(WINDOW_TO);

// Ten distinct weekly dates inside the current window (each a Wednesday, 7 days
// apart) — enough to exercise the weekly-cadence consistency + plateau math.
const WEEKLY_DAYS = [
  "2026-04-08",
  "2026-04-15",
  "2026-04-22",
  "2026-04-29",
  "2026-05-06",
  "2026-05-13",
  "2026-05-20",
  "2026-05-27",
  "2026-06-03",
  "2026-06-10",
];

function rows(
  subjectId: string,
  days: string[],
  extra: Partial<MetricRowLike> = {},
): MetricRowLike[] {
  return days.map((day) => ({ subjectId, day, value: 1, ...extra }));
}

/** N people, each subject `s{i}` linked to person `p{i}`. */
function people(n: number): {
  identityLinks: IdentityLinkLike[];
  subjects: string[];
} {
  const identityLinks: IdentityLinkLike[] = [];
  const subjects: string[] = [];
  for (let i = 0; i < n; i++) {
    identityLinks.push({ subjectId: `s${i}`, personId: `p${i}` });
    subjects.push(`s${i}`);
  }
  return { identityLinks, subjects };
}

function baseInput(over: Partial<MaturityInput> = {}): MaturityInput {
  return {
    windowTo: WINDOW_TO,
    knownPeople: 0,
    identityLinks: [],
    activeDayRows: [],
    agentActiveRows: [],
    featureRows: [],
    signalRows: [],
    promptRows: [],
    spendRows: [],
    connections: [],
    adoptionScore: null,
    ...over,
  };
}

describe("computeAxes — honest empty & partial states", () => {
  it("no data at all → every axis insufficient, activation null (NOT zero)", () => {
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 0,
      identityLinks: [],
      activeDayRows: [],
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
    expect(axes.breadth.available).toBe(false);
    expect(axes.depth.available).toBe(false);
    expect(axes.consistency.available).toBe(false);
    expect(axes.activationPct).toBeNull();
    expect(axes.activePeople).toBe(0);
  });

  it("activation only available → breadth scores from activation alone, depth/consistency insufficient without their inputs", () => {
    const { identityLinks } = people(10);
    // One active person on a single day: activation measurable, but no agent /
    // feature / signal rows, and a single active week.
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 10,
      identityLinks,
      activeDayRows: rows("s0", ["2026-06-15"]),
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
    expect(axes.activationPct).toBe(10);
    // Breadth blends only the activation component (feature coverage omitted,
    // not floored) → equals the activation value.
    expect(axes.breadth).toMatchObject({ available: true, value: 10 });
    expect(axes.depth.available).toBe(false);
    // One active person active in a single week → consistency IS available
    // (≥1 active person, ≥2 weeks in window) but low.
    expect(axes.consistency.available).toBe(true);
  });

  it("a ratio component with a missing side is omitted, never floored to 0 (agentic depth)", () => {
    const { identityLinks } = people(4);
    // Active days but ZERO agent rows: depth's agentic component must be
    // omitted (no agent-capable telemetry ≠ measured 0% agentic).
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 4,
      identityLinks,
      activeDayRows: rows("s0", WEEKLY_DAYS),
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
    if (axes.depth.available) {
      // If any depth component were available it must not be a fabricated
      // agentic 0 — but here none is, so depth is insufficient.
      throw new Error("depth should be insufficient with no agent/feature/signal rows");
    }
    expect(axes.depth.available).toBe(false);
  });

  it("agentic depth is measured (not 0) when agent telemetry exists", () => {
    const { identityLinks } = people(4);
    const days = WEEKLY_DAYS;
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 4,
      identityLinks,
      activeDayRows: rows("s0", days),
      // Every active person-day is agentic → 100% agentic share.
      agentActiveRows: rows("s0", days),
      featureRows: [],
      signalRows: [],
    });
    expect(axes.depth).toMatchObject({ available: true, value: 100 });
  });
});

describe("mapLevel — thresholds & gates", () => {
  const axis = (value: number | null): MaturityAxis =>
    value === null
      ? { available: false }
      : { available: true, value, components: [] };
  const axesWith = (
    activationPct: number | null,
    consistency: number | null,
    depth: number | null,
  ): MaturityAxes => ({
    breadth: { available: false },
    depth: axis(depth),
    consistency: axis(consistency),
    activationPct,
    activePeople: 0,
    knownPeople: 10,
  });

  it("null activation → null level (insufficient, not L0)", () => {
    expect(mapLevel(axesWith(null, 100, 100))).toBeNull();
  });

  it("measured low activation → L0 Dormant (distinct from insufficient)", () => {
    expect(mapLevel(axesWith(10, null, null))).toBe(0);
  });

  it("activation threshold boundaries are inclusive at the floor", () => {
    expect(mapLevel(axesWith(19.9, null, null))).toBe(0);
    expect(mapLevel(axesWith(20, null, null))).toBe(1);
    expect(mapLevel(axesWith(49.9, null, null))).toBe(1);
    expect(mapLevel(axesWith(50, null, null))).toBe(2);
    expect(mapLevel(axesWith(79.9, null, null))).toBe(2);
    // 80% clears the base for L3 but is HELD at L2 without a sustained cadence.
    expect(mapLevel(axesWith(80, null, null))).toBe(2);
  });

  it("L3 requires a sustained cadence; L4 requires cadence + depth on top", () => {
    // High activation, sustained consistency, no strong depth → Embedded (L3).
    expect(mapLevel(axesWith(90, 60, 10))).toBe(3);
    // + high consistency + real depth → Amplified (L4).
    expect(mapLevel(axesWith(90, 80, 60))).toBe(4);
    // High activation but consistency below the sustained bar → held at L2.
    expect(mapLevel(axesWith(90, 40, 90))).toBe(2);
  });
});

describe("computeMaturity — trajectory & the 8 numbers", () => {
  it("trajectory is notComparable when the prior window has no usage", () => {
    const { identityLinks } = people(10);
    const view = computeMaturity(
      baseInput({
        knownPeople: 10,
        identityLinks,
        activeDayRows: rows("s0", WEEKLY_DAYS),
      }),
    );
    expect(view.numbers.maturity.trajectory.kind).toBe("notComparable");
  });

  it("trajectory is comparable once the prior window has usage", () => {
    const { identityLinks } = people(10);
    const view = computeMaturity(
      baseInput({
        knownPeople: 10,
        identityLinks,
        activeDayRows: [
          ...rows("s0", WEEKLY_DAYS),
          // A usage day inside the prior window (2026-01-15 … 2026-04-07).
          ...rows("s0", ["2026-03-01"]),
        ],
      }),
    );
    expect(view.numbers.maturity.trajectory.kind).toBe("comparable");
  });

  it("full L4 scenario: broad + steady + deep", () => {
    const n = 9;
    const { identityLinks } = people(n);
    const activeDayRows: MetricRowLike[] = [];
    const agentActiveRows: MetricRowLike[] = [];
    for (let i = 0; i < n; i++) {
      activeDayRows.push(...rows(`s${i}`, WEEKLY_DAYS, { connectionId: "c1" }));
      agentActiveRows.push(...rows(`s${i}`, WEEKLY_DAYS));
    }
    const view = computeMaturity(
      baseInput({
        knownPeople: 10,
        identityLinks,
        activeDayRows,
        agentActiveRows,
        connections: [
          {
            id: "c1",
            vendor: "anthropic",
            status: "active",
            displayName: "Claude",
            lastSuccessAt: new Date("2026-06-30T12:00:00Z"),
          },
        ],
      }),
    );
    expect(view.level).toBe(4);
    expect(view.numbers.activation.activationPct).toBe(90);
    expect(view.numbers.agenticShare.agentic.kind).toBe("measured");
    // Tool sprawl: one connected tool, actively producing usage → none idle.
    expect(view.numbers.toolSprawl).toMatchObject({
      connectedTools: 1,
      activeTools: 1,
      idleTools: 0,
    });
    expect(view.dataAsOf).toBe("2026-06-30T12:00:00.000Z");
  });

  it("dark-seat waste is always not_measured (never estimated)", () => {
    const view = computeMaturity(baseInput({ knownPeople: 3 }));
    expect(view.numbers.activation.darkSeat.confidence).toBe("not_measured");
  });

  it("cost per active user is omitted when a ratio side is missing (G4)", () => {
    const { identityLinks } = people(4);
    // Active people but no spend rows → ratio omitted, not floored.
    const view = computeMaturity(
      baseInput({
        knownPeople: 4,
        identityLinks,
        activeDayRows: rows("s0", WEEKLY_DAYS),
        spendRows: [],
      }),
    );
    expect(view.numbers.costPerActiveUser.cost).toBeNull();
  });

  it("tool sprawl flags a connected-but-idle tool", () => {
    const view = computeMaturity(
      baseInput({
        knownPeople: 1,
        identityLinks: [{ subjectId: "s0", personId: "p0" }],
        // Usage on c1 only; c2 is connected but produces nothing.
        activeDayRows: rows("s0", WEEKLY_DAYS, { connectionId: "c1" }),
        connections: [
          { id: "c1", vendor: "anthropic", status: "active", displayName: "A", lastSuccessAt: null },
          { id: "c2", vendor: "openai", status: "active", displayName: "B", lastSuccessAt: null },
        ],
      }),
    );
    expect(view.numbers.toolSprawl).toMatchObject({
      connectedTools: 2,
      activeTools: 1,
      idleTools: 1,
    });
  });
});

describe("computePlateau", () => {
  it("insufficient below the minimum weeks", () => {
    expect(computePlateau([1, 2, 3]).kind).toBe("insufficient");
  });
  it("flat weekly usage reads as plateaued", () => {
    const p = computePlateau([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(p.kind).toBe("measured");
    if (p.kind === "measured") expect(p.plateaued).toBe(true);
  });
  it("clear week-over-week growth reads as not plateaued", () => {
    const p = computePlateau([2, 3, 4, 8, 12, 16, 20, 24]);
    expect(p.kind).toBe("measured");
    if (p.kind === "measured") expect(p.plateaued).toBe(false);
  });
});

describe("maturity-glossary copy — no invented benchmarks (invariant b)", () => {
  const allStrings: string[] = [];
  for (const lvl of MATURITY_LEVELS) {
    const c = MATURITY_LEVEL_COPY[lvl];
    allStrings.push(c.name, c.tagline, c.description);
  }
  allStrings.push(
    MATURITY_LEVEL_NONE_COPY.name,
    MATURITY_LEVEL_NONE_COPY.tagline,
    MATURITY_LEVEL_NONE_COPY.description,
  );
  for (const axis of Object.values(MATURITY_AXIS_COPY)) {
    allStrings.push(axis.label, axis.shortWhat, axis.what, axis.inputs);
  }
  for (const num of Object.values(MATURITY_NUMBER_COPY)) {
    allStrings.push(num.label, num.shortWhat, num.caveat);
  }
  for (const item of MATURITY_NOT_SCORED) {
    allStrings.push(item.label, item.what, item.why);
  }

  it("no copy string trips the banned-phrasing guard", () => {
    for (const s of allStrings) {
      expect(s, `banned phrasing in: "${s}"`).not.toMatch(BANNED_PHRASING);
    }
  });

  it("copy never promises time saved / ROI as a product number", () => {
    // The ONLY place "time saved" / "ROI" may appear is the not-scored refusal
    // list — never in a level/axis/number description.
    const scored = [
      ...MATURITY_LEVELS.flatMap((l) => [
        MATURITY_LEVEL_COPY[l].tagline,
        MATURITY_LEVEL_COPY[l].description,
      ]),
      ...Object.values(MATURITY_AXIS_COPY).flatMap((a) => [a.what, a.inputs]),
    ];
    for (const s of scored) {
      expect(s.toLowerCase()).not.toMatch(/time saved|hours saved/);
    }
  });

  it("covers all five levels", () => {
    for (const l of MATURITY_LEVELS) {
      expect(MATURITY_LEVEL_COPY[l].name.length).toBeGreaterThan(0);
    }
  });
});
