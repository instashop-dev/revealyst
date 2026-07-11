import { describe, expect, it } from "vitest";
import { computeRecentMovement } from "../src/lib/recent-movement";

// Pure-function suite (F1.2 / M1): no DB, no I/O. Uses a 7-day period for
// readable window boundaries — to = 2026-06-14 gives current 06-08..06-14,
// previous 06-01..06-07.

const TO = "2026-06-14";
const P = 7;

function spend(day: string, value: number) {
  return { subjectId: "s1", day, value };
}
function activeDay(subjectId: string, day: string) {
  return { subjectId, day, value: 1 };
}

function findMetric(
  movement: ReturnType<typeof computeRecentMovement>,
  key: "reported_spend" | "active_people" | "active_days",
) {
  return movement.metrics.find((m) => m.key === key)!;
}

describe("computeRecentMovement", () => {
  it("exposes the adjacent windows it compared", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [],
      activeDayRecords: [],
      identities: [],
    });
    expect(movement).toMatchObject({
      currentFrom: "2026-06-08",
      currentTo: "2026-06-14",
      previousFrom: "2026-06-01",
      previousTo: "2026-06-07",
      periodDays: 7,
    });
  });

  it("computes a spend delta from reported rows across the two periods", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [
        spend("2026-06-03", 400), // previous
        spend("2026-06-10", 500), // current
        spend("2026-06-12", 500), // current
      ],
      activeDayRecords: [],
      identities: [],
    });
    const m = findMetric(movement, "reported_spend");
    expect(m.unit).toBe("cents");
    expect(m.current).toBe(1000);
    expect(m.delta).toMatchObject({ kind: "delta", previous: 400, delta: 600 });
  });

  it("resolves active people + active days per period from identity links", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [],
      activeDayRecords: [
        activeDay("s1", "2026-06-02"), // previous (p1)
        activeDay("s1", "2026-06-09"), // current (p1)
        activeDay("s2", "2026-06-10"), // current (p2)
        activeDay("orphan", "2026-06-11"), // current, UNLINKED → excluded
      ],
      identities: [
        { subjectId: "s1", personId: "p1" },
        { subjectId: "s2", personId: "p2" },
      ],
    });
    const people = findMetric(movement, "active_people");
    const days = findMetric(movement, "active_days");
    // current: p1 + p2 = 2 people (orphan excluded); previous: p1 = 1.
    expect(people.current).toBe(2);
    expect(people.delta).toMatchObject({ kind: "delta", previous: 1, delta: 1 });
    // current active-days total (distinct per person) = 2; previous = 1.
    expect(days.current).toBe(2);
    expect(days.delta).toMatchObject({ kind: "delta", delta: 1 });
  });

  it("no prior-period data → `first` (new), never a fabricated jump", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [spend("2026-06-10", 500)], // only in current
      activeDayRecords: [],
      identities: [],
    });
    expect(findMetric(movement, "reported_spend").delta).toEqual({
      kind: "first",
      current: 500,
    });
  });

  it("nothing anywhere → notComparable(noData), no chip", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [],
      activeDayRecords: [],
      identities: [],
    });
    for (const m of movement.metrics) {
      expect(m.delta).toEqual({ kind: "notComparable", reason: "noData" });
      expect(m.current).toBe(0);
    }
  });

  it("data before the current period makes a measured-0 previous a real delta", () => {
    const movement = computeRecentMovement({
      to: TO,
      periodDays: P,
      spendReportedRecords: [
        spend("2026-05-20", 100), // before BOTH periods → establishes baseline
        spend("2026-06-10", 500), // current
      ],
      activeDayRecords: [],
      identities: [],
    });
    // previous period (06-01..06-07) has no rows, but data exists before it →
    // previous is a measured 0, so this is a real +500 delta (pct null).
    expect(findMetric(movement, "reported_spend").delta).toMatchObject({
      kind: "delta",
      previous: 0,
      delta: 500,
      pctChange: null,
    });
  });
});
