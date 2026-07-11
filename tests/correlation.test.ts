import { describe, expect, it } from "vitest";
import {
  buildCorrelationSeries,
  computeCorrelation,
  computeCorrelationPanel,
  CORRELATION_MIN_WEEKS,
  CORRELATION_PAIRS,
  type WeeklySeries,
} from "../src/lib/correlation";
import {
  CAUSAL_BANNED_PHRASES,
  CORRELATION_BANNED_PHRASES,
  CORRELATION_COPY,
} from "../src/lib/narrative-copy";

const DAY_MS = 24 * 60 * 60 * 1000;
function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Weekly maps keyed by dates exactly 7 days apart — the adjacency check is
// `addDays(prev, 7) === cur`, so any 7-day-spaced keys are treated as adjacent
// weeks (weekStart validation happens in the row-bucketing layer, tested
// separately below).
const W0 = "2026-01-05"; // arbitrary week anchor
function series(values: number[], startWeek = W0): WeeklySeries {
  const m: WeeklySeries = new Map();
  values.forEach((v, i) => m.set(addDays(startWeek, i * 7), v));
  return m;
}

describe("computeCorrelation — direction agreement", () => {
  it("counts same-direction transitions, excluding flat-side weeks from the denominator", () => {
    // A: +,+,flat,+,+,-   B: +,+,+,+,+,-  → 5 comparable (flat excluded), all agree
    const a = series([1, 2, 3, 3, 4, 5, 4]);
    const b = series([1, 2, 3, 5, 6, 7, 6]);
    const r = computeCorrelation("active_people__spend", a, b);
    expect(r.kind).toBe("measured");
    if (r.kind !== "measured") return;
    expect(r.weeks).toBe(7);
    expect(r.comparableWeeks).toBe(5); // the flat A transition is excluded
    expect(r.agreeingWeeks).toBe(5);
    expect(r.agreementPct).toBe(100);
  });

  it("reports 0% when the two measures move opposite ways", () => {
    const a = series([1, 2, 3, 4, 5, 6, 7]);
    const b = series([7, 6, 5, 4, 3, 2, 1]);
    const r = computeCorrelation("active_people__spend", a, b);
    expect(r.kind).toBe("measured");
    if (r.kind !== "measured") return;
    expect(r.comparableWeeks).toBe(6);
    expect(r.agreeingWeeks).toBe(0);
    expect(r.agreementPct).toBe(0);
  });

  it("computes a fractional agreement share", () => {
    // A all up; B: up,up,down,up,up,up → 5 agree of 6 → 83%
    const a = series([1, 2, 3, 4, 5, 6, 7]);
    const b = series([1, 2, 3, 2, 3, 4, 5]);
    const r = computeCorrelation("active_people__spend", a, b);
    expect(r.kind).toBe("measured");
    if (r.kind !== "measured") return;
    expect(r.comparableWeeks).toBe(6);
    expect(r.agreeingWeeks).toBe(5);
    expect(r.agreementPct).toBe(83); // round(5/6*100)
  });

  it("is insufficient below the minimum overlapping weeks", () => {
    const a = series([1, 2, 3, 4, 5]); // only 5 common weeks
    const b = series([1, 2, 3, 4, 5]);
    expect(a.size).toBeLessThan(CORRELATION_MIN_WEEKS);
    const r = computeCorrelation("active_people__spend", a, b);
    expect(r.kind).toBe("insufficient");
    if (r.kind !== "insufficient") return;
    expect(r.weeks).toBe(5);
  });

  it("is insufficient when every transition is flat on one side (no direction)", () => {
    const a = series([5, 5, 5, 5, 5, 5]); // never moves → no direction anywhere
    const b = series([1, 2, 3, 4, 5, 6]);
    const r = computeCorrelation("active_people__spend", a, b);
    // 6 overlapping weeks (meets the count floor) but 0 comparable transitions.
    expect(r.kind).toBe("insufficient");
  });

  it("never bridges a calendar gap into a fake transition", () => {
    // Weeks 0,1, [gap at 2], 3,4,5,6 — six overlapping weeks, but the 1→3 jump
    // spans 14 days and must NOT count as a transition.
    const a = new Map<string, number>();
    const b = new Map<string, number>();
    for (const i of [0, 1, 3, 4, 5, 6]) {
      a.set(addDays(W0, i * 7), i + 1); // strictly increasing
      b.set(addDays(W0, i * 7), i + 1);
    }
    const r = computeCorrelation("active_people__spend", a, b);
    expect(r.kind).toBe("measured");
    if (r.kind !== "measured") return;
    expect(r.weeks).toBe(6);
    // Adjacent pairs: 0→1, 3→4, 4→5, 5→6 = 4 (the 1→3 gap is skipped).
    expect(r.comparableWeeks).toBe(4);
  });
});

describe("buildCorrelationSeries — present-only weeks (no measured zero)", () => {
  const windowTo = "2026-06-01";
  const identities = [
    { subjectId: "s0", personId: "p0" },
    { subjectId: "s1", personId: "p1" },
  ];

  it("omits weeks with no rows rather than plotting a 0", () => {
    // Spend only in two complete weeks well before windowTo.
    const spendReportedRows = [
      { day: "2026-03-04", value: 100 },
      { day: "2026-03-11", value: 120 },
    ];
    const s = buildCorrelationSeries({
      windowTo,
      spendReportedRows,
      activeDayRows: [],
      agentActiveRows: [],
      promptRows: [],
      identities,
    });
    expect(s.spend.size).toBe(2); // exactly the two weeks with rows — no zeros
    expect([...s.spend.values()]).toEqual([100, 120]);
  });

  it("excludes subjects with no identity link from active-people weeks", () => {
    const activeDayRows = [
      { subjectId: "s0", day: "2026-03-04", value: 1 },
      { subjectId: "unlinked", day: "2026-03-04", value: 1 }, // no identity → dropped
      { subjectId: "s1", day: "2026-03-11", value: 1 },
    ];
    const s = buildCorrelationSeries({
      windowTo,
      spendReportedRows: [],
      activeDayRows,
      agentActiveRows: [],
      promptRows: [],
      identities,
    });
    // Week of Mar 2: only s0 resolved (unlinked excluded) → 1 person.
    const marWeek = [...s.activePeople.entries()].find(([, v]) => v >= 1);
    expect(marWeek?.[1]).toBe(1);
  });
});

describe("computeCorrelationPanel", () => {
  it("returns the three fixed pairs, and measures a clearly co-moving pair", () => {
    const start = "2026-03-02"; // week anchor
    const identities = Array.from({ length: 5 }, (_, j) => ({
      subjectId: `s${j}`,
      personId: `p${j}`,
    }));
    const activeDayRows: { subjectId: string; day: string; value: number }[] = [];
    const spendReportedRows: { day: string; value: number }[] = [];
    const promptRows: { day: string; value: number }[] = [];
    const agentActiveRows: { subjectId: string; day: string; value: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i * 7);
      const people = Math.min(i + 1, 5); // 1,2,3,4,5,5,5 → rising then flat
      for (let j = 0; j < people; j++) {
        activeDayRows.push({ subjectId: `s${j}`, day, value: 1 });
      }
      agentActiveRows.push({ subjectId: "s0", day, value: 1 });
      spendReportedRows.push({ day, value: (i + 1) * 100 }); // strictly rising
      promptRows.push({ day, value: (i + 1) * 10 });
    }

    const results = computeCorrelationPanel({
      windowTo: "2026-06-01",
      spendReportedRows,
      activeDayRows,
      agentActiveRows,
      promptRows,
      identities,
    });

    expect(results.map((r) => r.pair)).toEqual([...CORRELATION_PAIRS]);
    const peopleVsSpend = results.find(
      (r) => r.pair === "active_people__spend",
    )!;
    expect(peopleVsSpend.kind).toBe("measured");
    if (peopleVsSpend.kind !== "measured") return;
    // People rose then flattened; spend rose throughout — the flat weeks are
    // excluded, the rising ones agree.
    expect(peopleVsSpend.agreementPct).toBe(100);
    expect(peopleVsSpend.weeks).toBe(7);
  });
});

describe("correlation copy — directional and non-causal", () => {
  it("carries no causal or pseudo-statistical phrasing", () => {
    const samples = [
      CORRELATION_COPY.title,
      CORRELATION_COPY.intro,
      CORRELATION_COPY.insufficient,
      CORRELATION_COPY.disclaimer,
      CORRELATION_COPY.measuredLine({
        joint: "Active people and spend",
        agreeing: 7,
        comparable: 9,
      }),
    ];
    for (const sentence of samples) {
      const lower = sentence.toLowerCase();
      for (const banned of [
        ...CAUSAL_BANNED_PHRASES,
        ...CORRELATION_BANNED_PHRASES,
      ]) {
        expect(
          lower.includes(banned),
          `"${sentence}" contains banned phrase "${banned}"`,
        ).toBe(false);
      }
    }
  });

  it("the disclaimer explicitly disclaims causation", () => {
    expect(CORRELATION_COPY.disclaimer.toLowerCase()).toContain("directional");
    expect(CORRELATION_COPY.disclaimer).toContain("not that one moved the other");
  });
});
