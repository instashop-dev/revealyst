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
  type PersonLike,
  type SignalRowLike,
} from "../src/lib/maturity";
import {
  MATURITY_AXIS_COPY,
  MATURITY_LEVEL_COPY,
  MATURITY_LEVEL_NONE_COPY,
  MATURITY_LEVEL_STALE_COPY,
  MATURITY_LEVELS,
  MATURITY_NOT_SCORED,
  MATURITY_NUMBER_COPY,
} from "../src/lib/maturity-glossary";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// A fixed anchor so window arithmetic is deterministic. windowTo is "today"
// (partial, excluded); the current window is the 12 whole weeks ending
// yesterday (2026-06-30), i.e. 2026-04-08 … 2026-06-30. Its complete Mondays
// run 2026-04-13 … 2026-06-22 (11 weeks). The prior window is
// 2026-01-15 … 2026-04-07.
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

// Nine weekly Wednesdays inside the PRIOR window (2026-01-15 … 2026-04-07) —
// enough distinct weeks (≥ TRAJECTORY_MIN_PRIOR_WEEKS = 8) to make the prior
// quarter comparable.
const PRIOR_WEEKLY_DAYS = [
  "2026-01-21",
  "2026-01-28",
  "2026-02-04",
  "2026-02-11",
  "2026-02-18",
  "2026-02-25",
  "2026-03-04",
  "2026-03-11",
  "2026-03-18",
];

function rows(
  subjectId: string,
  days: string[],
  extra: Partial<MetricRowLike> = {},
): MetricRowLike[] {
  return days.map((day) => ({ subjectId, day, value: 1, ...extra }));
}

/** N people, each subject `s{i}` linked to person `p{i}`. `peopleRows` carries
 * no createdAt (treated as always-known — see PersonLike). */
function people(n: number): {
  identityLinks: IdentityLinkLike[];
  peopleRows: PersonLike[];
} {
  const identityLinks: IdentityLinkLike[] = [];
  const peopleRows: PersonLike[] = [];
  for (let i = 0; i < n; i++) {
    identityLinks.push({ subjectId: `s${i}`, personId: `p${i}` });
    peopleRows.push({});
  }
  return { identityLinks, peopleRows };
}

function baseInput(over: Partial<MaturityInput> = {}): MaturityInput {
  return {
    windowTo: WINDOW_TO,
    people: [],
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

/** An active connection whose last sync defaults to fresh (inside the current
 * window), so staleness gates don't fire unless a test wants them to. */
function connection(lastSuccessAt = "2026-06-30T12:00:00Z") {
  return {
    id: "c1",
    vendor: "anthropic",
    status: "active",
    displayName: "Claude",
    lastSuccessAt: new Date(lastSuccessAt),
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

  it("activation only available → breadth scores from activation alone, depth insufficient without its inputs", () => {
    const { identityLinks } = people(10);
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
    expect(axes.consistency.available).toBe(true);
  });

  it("a ratio component with a missing side is omitted, never floored to 0 (agentic depth)", () => {
    const { identityLinks } = people(4);
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 4,
      identityLinks,
      activeDayRows: rows("s0", WEEKLY_DAYS),
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
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
      agentActiveRows: rows("s0", days),
      featureRows: [],
      signalRows: [],
    });
    expect(axes.depth).toMatchObject({ available: true, value: 100 });
  });

  it("activation is clamped to 100 when more active people resolve than known-people rows (F11)", () => {
    const { identityLinks } = people(3);
    const activeDayRows = [0, 1, 2].flatMap((i) => rows(`s${i}`, ["2026-06-15"]));
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 1, // inconsistent snapshot — a >100% share is never rendered
      identityLinks,
      activeDayRows,
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
    expect(axes.activationPct).toBe(100);
  });

  it("F2 probe: an unresolved ci-bot's peakConcurrency contributes NOTHING to depth", () => {
    const { identityLinks } = people(4);
    // Resolved people active with zero agentic evidence; the only concurrency
    // signal comes from a subject with NO identity link (a ci-bot).
    const signalRows: SignalRowLike[] = WEEKLY_DAYS.map((day) => ({
      subjectId: "ci-bot",
      day,
      peakConcurrency: 5,
    }));
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 4,
      identityLinks,
      activeDayRows: [0, 1, 2, 3].flatMap((i) => rows(`s${i}`, WEEKLY_DAYS)),
      agentActiveRows: [],
      featureRows: [],
      signalRows,
    });
    // Pre-fix this was `available: true, value: 100` (100% of Depth from one
    // unlinked bot). Now: no resolved depth evidence → insufficient.
    expect(axes.depth.available).toBe(false);
  });

  it("F6: an unresolved subject's features don't widen feature coverage", () => {
    const { identityLinks } = people(4);
    const botFeatures = WEEKLY_DAYS.map((day) => ({
      subjectId: "ci-bot",
      day,
      dim: "feature=mcp",
      value: 1,
    }));
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 4,
      identityLinks,
      activeDayRows: rows("s0", WEEKLY_DAYS),
      agentActiveRows: [],
      featureRows: botFeatures,
      signalRows: [],
    });
    // Only the activation component exists — the bot's features are excluded,
    // so no feature_coverage component appears at all.
    if (!axes.breadth.available) throw new Error("breadth should be available");
    expect(
      axes.breadth.components.some((c) => c.key === "feature_coverage"),
    ).toBe(false);
  });

  it("F4 probe: recent joiners with a perfect cadence don't drag consistency down", () => {
    // 1 veteran active EVERY week of the window + 2 joiners active every week
    // since they joined (the last 4 weeks, through the window end) — all
    // three have a PERFECT cadence for the weeks they existed.
    const { identityLinks } = people(3);
    const veteranDays = [...WEEKLY_DAYS, "2026-06-17", "2026-06-24", "2026-06-30"];
    const joinerDays = ["2026-06-10", "2026-06-17", "2026-06-24", "2026-06-30"];
    const axes = computeAxes({
      window: WIN.current,
      knownPeople: 3,
      identityLinks,
      activeDayRows: [
        ...rows("s0", veteranDays),
        ...rows("s1", joinerDays),
        ...rows("s2", joinerDays),
      ],
      agentActiveRows: [],
      featureRows: [],
      signalRows: [],
    });
    if (!axes.consistency.available) {
      throw new Error("consistency should be available");
    }
    // Pre-fix: joiners divided by the full 12 weeks → ~55 overall (held at L2
    // with "uneven cadence" framing). Now each person's denominator starts at
    // their first active week (min 4), so a perfect-cadence org scores 100.
    expect(axes.consistency.value).toBe(100);
  });
});

describe("mapLevel — thresholds & gates", () => {
  const axis = (
    value: number | null,
    componentKeys: string[] = [],
  ): MaturityAxis =>
    value === null
      ? { available: false }
      : {
          available: true,
          value,
          components: componentKeys.map((key) => ({ key, value, weight: 1 })),
        };
  const axesWith = (
    activationPct: number | null,
    consistency: number | null,
    depth: number | null,
    depthComponentKeys: string[] = ["agentic_share"],
  ): MaturityAxes => ({
    breadth: { available: false },
    depth: axis(depth, depthComponentKeys),
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
    // + high consistency + real depth (with a measured agentic component) →
    // Amplified (L4).
    expect(mapLevel(axesWith(90, 80, 60))).toBe(4);
    // High activation but consistency below the sustained bar → held at L2.
    expect(mapLevel(axesWith(90, 40, 90))).toBe(2);
  });

  it("F2 gate: L4 requires a MEASURED agentic-share component — depth from concurrency/features alone can't clear it", () => {
    // Depth 90 carried entirely by non-agentic components → capped at L3.
    expect(mapLevel(axesWith(90, 80, 90, ["concurrency"]))).toBe(3);
    expect(
      mapLevel(axesWith(90, 80, 90, ["multi_feature_days", "concurrency"])),
    ).toBe(3);
    // Same numbers with an agentic component present → L4.
    expect(mapLevel(axesWith(90, 80, 90, ["agentic_share"]))).toBe(4);
  });
});

describe("computeMaturity — trajectory & the 8 numbers", () => {
  it("trajectory is notComparable(insufficientHistory) when the prior window has no resolved usage", () => {
    const { identityLinks, peopleRows } = people(10);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: rows("s0", WEEKLY_DAYS),
      }),
    );
    expect(view.numbers.maturity.trajectory).toMatchObject({
      kind: "notComparable",
      reason: "insufficientHistory",
    });
  });

  it("F3 probe: unresolved-only prior usage does NOT make the prior window comparable", () => {
    const { identityLinks, peopleRows } = people(10);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: [
          ...rows("s0", WEEKLY_DAYS),
          // Prior-window usage carried ONLY by an unlinked subject.
          ...rows("ci-bot", PRIOR_WEEKLY_DAYS),
        ],
      }),
    );
    expect(view.numbers.maturity.trajectory).toMatchObject({
      kind: "notComparable",
      reason: "insufficientHistory",
    });
  });

  it("F3 probe: data starting 2 weeks before the current window → partialPrior, never 'up a level'", () => {
    const { identityLinks, peopleRows } = people(10);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: [
          ...rows("s0", WEEKLY_DAYS),
          // Resolved usage in only the LAST 2 weeks of the prior window —
          // the org's data simply starts there.
          ...rows("s0", ["2026-03-25", "2026-04-01"]),
        ],
      }),
    );
    expect(view.numbers.maturity.trajectory).toMatchObject({
      kind: "notComparable",
      reason: "partialPrior",
    });
  });

  it("trajectory is comparable once resolved usage spans most of the prior window", () => {
    const { identityLinks, peopleRows } = people(10);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: [
          ...rows("s0", WEEKLY_DAYS),
          ...rows("s0", PRIOR_WEEKLY_DAYS), // 9 distinct prior weeks ≥ 8
        ],
      }),
    );
    expect(view.numbers.maturity.trajectory.kind).toBe("comparable");
  });

  it("full L4 scenario: broad + steady + deep (with measured agentic evidence)", () => {
    const n = 9;
    const { identityLinks, peopleRows } = people(10);
    const activeDayRows: MetricRowLike[] = [];
    const agentActiveRows: MetricRowLike[] = [];
    for (let i = 0; i < n; i++) {
      activeDayRows.push(...rows(`s${i}`, WEEKLY_DAYS, { connectionId: "c1" }));
      agentActiveRows.push(...rows(`s${i}`, WEEKLY_DAYS));
    }
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows,
        agentActiveRows,
        connections: [connection()],
      }),
    );
    expect(view.level).toBe(4);
    expect(view.stale).toBe(false);
    expect(view.numbers.activation.activationPct).toBe(90);
    expect(view.numbers.agenticShare.agentic.kind).toBe("measured");
    expect(view.numbers.toolSprawl).toMatchObject({
      connectedTools: 1,
      activeTools: 1,
      idleTools: 0,
    });
    expect(view.dataAsOf).toBe("2026-06-30T12:00:00.000Z");
  });

  it("F1 probe: rising then DEAD org reads as flattening/declining, never 'Growing'", () => {
    const { identityLinks, peopleRows } = people(6);
    // Weekly usage rising through April into mid-May, then five-plus dead
    // weeks. Connector is HEALTHY (fresh sync) — the silence is measured.
    const risingDays: MetricRowLike[] = [];
    const populated = WEEKLY_DAYS.slice(0, 6); // Apr 8 … May 13
    populated.forEach((day, i) => {
      // Increasing person-count per week: 1, 2, 3, 4, 5, 6 people active.
      for (let p = 0; p <= i; p++) risingDays.push(...rows(`s${p}`, [day]));
    });
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: risingDays,
        connections: [connection("2026-06-30T12:00:00Z")],
      }),
    );
    const p = view.numbers.plateau;
    expect(p.kind).toBe("measured");
    if (p.kind === "measured") {
      // Pre-fix (zero weeks omitted) this read "Growing / +300%".
      expect(p.plateaued).toBe(true);
      expect(p.changePct).toBeLessThan(0);
    }
  });

  it("F1 stale gate: a connector whose last sync predates the recent half withholds the verdict", () => {
    const { identityLinks, peopleRows } = people(6);
    const risingDays: MetricRowLike[] = [];
    const populated = WEEKLY_DAYS.slice(0, 6);
    populated.forEach((day, i) => {
      for (let p = 0; p <= i; p++) risingDays.push(...rows(`s${p}`, [day]));
    });
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: risingDays,
        // Last sync mid-May — the recent half's weeks are UNOBSERVED.
        connections: [connection("2026-05-15T12:00:00Z")],
      }),
    );
    expect(view.numbers.plateau.kind).toBe("stale");
  });

  it("F8: a sync predating the ENTIRE window withholds the level (not a confident Dormant)", () => {
    const { identityLinks, peopleRows } = people(10);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: [],
        connections: [connection("2026-01-05T00:00:00Z")],
      }),
    );
    expect(view.stale).toBe(true);
    expect(view.level).toBeNull();
    expect(view.numbers.maturity.stale).toBe(true);
  });

  it("dark-seat waste is always not_measured (never estimated)", () => {
    const view = computeMaturity(baseInput({ people: people(3).peopleRows }));
    expect(view.numbers.activation.darkSeat.confidence).toBe("not_measured");
  });

  it("cost per active user is omitted when a ratio side is missing (G4)", () => {
    const { identityLinks, peopleRows } = people(4);
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
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
        people: people(1).peopleRows,
        identityLinks: [{ subjectId: "s0", personId: "p0" }],
        activeDayRows: rows("s0", WEEKLY_DAYS, { connectionId: "c1" }),
        connections: [
          {
            id: "c1",
            vendor: "anthropic",
            status: "active",
            displayName: "A",
            lastSuccessAt: new Date("2026-06-30T12:00:00Z"),
          },
          {
            id: "c2",
            vendor: "openai",
            status: "active",
            displayName: "B",
            lastSuccessAt: null,
          },
        ],
      }),
    );
    expect(view.numbers.toolSprawl).toMatchObject({
      connectedTools: 2,
      activeTools: 1,
      idleTools: 1,
    });
  });

  it("F7: the agentic-share card window aligns with the report window (ends yesterday)", () => {
    const { identityLinks, peopleRows } = people(2);
    // Rows dated TODAY (the partial day) must not enter the card — its window
    // ends yesterday, same as the report's current window.
    const view = computeMaturity(
      baseInput({
        people: peopleRows,
        identityLinks,
        activeDayRows: rows("s0", [WINDOW_TO]),
        agentActiveRows: rows("s0", [WINDOW_TO]),
      }),
    );
    // The only rows are today's → outside the aligned window → the card
    // renders its honest empty state instead of a rate from a partial day.
    expect(view.numbers.agenticShare.agentic.kind).toBe("noActivity");
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
  for (const c of [MATURITY_LEVEL_NONE_COPY, MATURITY_LEVEL_STALE_COPY]) {
    allStrings.push(c.name, c.tagline, c.description);
  }
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

  it("F5: level copy claims only gate-backed facts — no champion/concentration/chat-mix characteristics", () => {
    // The gates check activation share, weekly cadence, and (L4) measured
    // depth with an agentic signal — level prose must not assert anything
    // else (concentration is computed separately on the same page and could
    // contradict it on the same screen).
    for (const lvl of MATURITY_LEVELS) {
      const text = `${MATURITY_LEVEL_COPY[lvl].tagline} ${MATURITY_LEVEL_COPY[lvl].description}`;
      expect(text.toLowerCase()).not.toMatch(
        /champion|concentrat|leans on chat|chat and completion/,
      );
    }
  });

  it("covers all five levels", () => {
    for (const l of MATURITY_LEVELS) {
      expect(MATURITY_LEVEL_COPY[l].name.length).toBeGreaterThan(0);
    }
  });
});
