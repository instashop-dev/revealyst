import { describe, expect, it } from "vitest";
import {
  completeWeeklyActive,
  computeUsageBaselines,
  MIN_PEOPLE_FOR_BASELINE,
  weekStartUtc,
} from "../src/lib/usage-baselines";

const WINDOW_TO = "2026-06-30"; // a Tuesday — its week is partial
const WEEKS = 8;

type ActiveRow = { subjectId: string; day: string; value: number };
function ad(subjectId: string, day: string, value = 1): ActiveRow {
  return { subjectId, day, value };
}

// 4 cleanly-resolved people + one unresolved subject + one shared subject.
const identities = [
  { subjectId: "s1", personId: "p1" },
  { subjectId: "s2", personId: "p2" },
  { subjectId: "s3", personId: "p3" },
  { subjectId: "s4", personId: "p4" },
  // Shared subject linked to two people — excluded from all per-person math.
  { subjectId: "sShared", personId: "pA" },
  { subjectId: "sShared", personId: "pB" },
];

const activeDayRows: ActiveRow[] = [
  ad("s1", "2026-06-01"),
  ad("s1", "2026-06-08"),
  ad("s1", "2026-06-15"),
  ad("s2", "2026-06-02"),
  ad("s2", "2026-06-09"),
  ad("s3", "2026-06-16"),
  ad("s3", "2026-06-23"),
  ad("s4", "2026-06-24"),
  ad("s4", "2026-06-30"), // == windowTo, the partial current week
  // Excluded rows:
  ad("sX", "2026-06-10"), // unresolved subject
  ad("sShared", "2026-06-11"), // shared → excluded, not "unresolved"
  ad("s1", "2026-04-01"), // before the window horizon → sliced off
  ad("s1", "2026-06-20", 0), // value 0 → not an active day
];

describe("computeUsageBaselines", () => {
  const base = computeUsageBaselines({
    activeDayRows,
    identityLinks: identities,
    windowTo: WINDOW_TO,
    weeks: WEEKS,
  });

  it("resolves people cleanly, excluding unresolved and shared subjects", () => {
    expect(base.resolvedPeople).toBe(4);
    expect(base.unresolvedSubjects).toBe(1); // only sX; the shared one isn't "unresolved"
  });

  it("weekly person-days sum to the clean per-person day total (9)", () => {
    // p1:3 + p2:2 + p3:2 + p4:2 = 9 active person-days, none double-counted.
    const totalPersonDays = base.weeklyActive.reduce(
      (a, w) => a + w.activePersonDays,
      0,
    );
    expect(totalPersonDays).toBe(9);
  });

  it("marks the partial current week incomplete; completeWeeklyActive drops it", () => {
    const currentWeek = weekStartUtc(WINDOW_TO);
    const current = base.weeklyActive.find((w) => w.weekStart === currentWeek);
    expect(current).toBeDefined();
    expect(current?.complete).toBe(false);
    const complete = completeWeeklyActive(base);
    expect(complete.every((w) => w.complete)).toBe(true);
    expect(complete.some((w) => w.weekStart === currentWeek)).toBe(false);
  });

  it("cadence summarizes per-person active-day counts (median 2, max 3, mean 2.25)", () => {
    expect(base.cadence.available).toBe(true);
    if (!base.cadence.available) return;
    expect(base.cadence.resolvedPeople).toBe(4);
    expect(base.cadence.medianActiveDays).toBe(2); // [2,2,2,3]
    expect(base.cadence.maxActiveDays).toBe(3);
    expect(base.cadence.meanActiveDays).toBe(2.25);
  });

  it("activation buckets each person into their first-seen week; total = resolved people", () => {
    const totalNew = base.activation.reduce((a, p) => a + p.newPeople, 0);
    expect(totalNew).toBe(4);
    // p1 first-seen 2026-06-01 → that week has ≥1 new person.
    const firstWeek = weekStartUtc("2026-06-01");
    expect(base.activation.some((p) => p.weekStart === firstWeek)).toBe(true);
    // Chronological.
    const starts = base.activation.map((p) => p.weekStart);
    expect([...starts].sort()).toEqual(starts);
  });

  it("fewer than the people floor → honest insufficient/empty kinds", () => {
    const thin = computeUsageBaselines({
      activeDayRows: [ad("s1", "2026-06-01"), ad("s2", "2026-06-02")],
      identityLinks: identities,
      windowTo: WINDOW_TO,
      weeks: WEEKS,
    });
    expect(thin.resolvedPeople).toBeLessThan(MIN_PEOPLE_FOR_BASELINE);
    expect(thin.weeklyActive).toEqual([]);
    expect(thin.cadence.available).toBe(false);
    expect(thin.activation).toEqual([]);
  });
});
