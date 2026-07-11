import { describe, expect, it } from "vitest";
import { computeRecentMovement } from "../src/lib/recent-movement";

// Pure-function suite (F1.2 / M1): no DB, no I/O. Uses a 7-day period for
// readable window boundaries — TODAY = 2026-06-15 anchors the comparison at
// the last COMPLETE day 06-14 (today is excluded as a partial day), giving
// current 06-08..06-14 and previous 06-01..06-07.

const TODAY = "2026-06-15";
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
  it("anchors at the last COMPLETE day — today is excluded from both windows", () => {
    const movement = computeRecentMovement({
      today: TODAY,
      periodDays: P,
      spendReportedRecords: [],
      activeDayRecords: [],
      identities: [],
    });
    expect(movement).toMatchObject({
      currentFrom: "2026-06-08",
      currentTo: "2026-06-14", // today − 1, never today
      previousFrom: "2026-06-01",
      previousTo: "2026-06-07",
      periodDays: 7,
    });
  });

  it("a perfectly flat org with today's data not yet ingested shows NO change (the partial-day probe)", () => {
    // 100¢ every day from well before the previous window through yesterday —
    // and NOTHING for today (still syncing). A window that included today
    // would fabricate a -100¢ "decline" every morning; the complete-day
    // anchor must read this as dead flat.
    const flat: Array<{ subjectId: string; day: string; value: number }> = [];
    for (let d = 1; d <= 14; d++) {
      flat.push(spend(`2026-06-${String(d).padStart(2, "0")}`, 100));
    }
    flat.push(spend("2026-05-31", 100)); // history before both windows
    const movement = computeRecentMovement({
      today: TODAY, // 2026-06-15 — absent from the rows above
      periodDays: P,
      spendReportedRecords: flat,
      activeDayRecords: [],
      identities: [],
    });
    const m = findMetric(movement, "reported_spend");
    expect(m.current).toBe(700); // 7 complete days × 100
    expect(m.delta).toMatchObject({ kind: "delta", previous: 700, delta: 0 });
  });

  it("computes a spend delta from reported rows across the two periods", () => {
    const movement = computeRecentMovement({
      today: TODAY,
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

  it("rows dated today are ignored entirely (partial day never leaks into the current period)", () => {
    const movement = computeRecentMovement({
      today: TODAY,
      periodDays: P,
      spendReportedRecords: [
        spend("2026-06-03", 400), // previous
        spend("2026-06-10", 500), // current
        spend(TODAY, 9_999), // partial today — must not count anywhere
      ],
      activeDayRecords: [],
      identities: [],
    });
    expect(findMetric(movement, "reported_spend").current).toBe(500);
  });

  it("resolves active people + person-days per period from identity links", () => {
    const movement = computeRecentMovement({
      today: TODAY,
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
    // current person-days total (distinct per person) = 2; previous = 1.
    expect(days.current).toBe(2);
    expect(days.delta).toMatchObject({ kind: "delta", delta: 1 });
  });

  it("shared (multi-person) subjects are excluded from people/person-days, same as M3/M4", () => {
    const movement = computeRecentMovement({
      today: TODAY,
      periodDays: P,
      spendReportedRecords: [],
      activeDayRecords: [
        activeDay("solo", "2026-06-09"), // current (p1, exclusive)
        activeDay("shared", "2026-06-10"), // current, linked to p2 AND p3
      ],
      identities: [
        { subjectId: "solo", personId: "p1" },
        { subjectId: "shared", personId: "p2" },
        { subjectId: "shared", personId: "p3" },
      ],
    });
    // Only p1 counts — the shared subject's day is neither multiplied to
    // p2+p3 nor guessed to one of them.
    expect(findMetric(movement, "active_people").current).toBe(1);
    expect(findMetric(movement, "active_days").current).toBe(1);
  });

  it("no prior-period data → `first` (new), never a fabricated jump", () => {
    const movement = computeRecentMovement({
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
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
