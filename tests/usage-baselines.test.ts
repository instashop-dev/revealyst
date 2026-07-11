import { describe, expect, it } from "vitest";
import {
  completeWeeklyActive,
  computeUsageBaselines,
  materializeMeasuredZeroWeeks,
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

  it("F4: the truncated LEADING week (window starts mid-week) is complete:false and excluded from the complete series", () => {
    // WINDOW_TO 2026-06-30 with 8 weeks → windowFrom 2026-05-06 (a Wednesday),
    // so the week of Mon 2026-05-04 is only partially covered.
    const rows = [
      ad("s1", "2026-05-06"),
      ad("s2", "2026-05-07"),
      ad("s1", "2026-06-01"),
      ad("s2", "2026-06-01"),
      ad("s3", "2026-06-01"),
      ad("s4", "2026-06-01"),
    ];
    const b = computeUsageBaselines({
      activeDayRows: rows,
      identityLinks: identities,
      windowTo: WINDOW_TO,
      weeks: WEEKS,
    });
    expect(b.windowFrom).toBe("2026-05-06");
    const leading = b.weeklyActive.find((w) => w.weekStart === "2026-05-04");
    expect(leading).toBeDefined();
    expect(leading?.complete).toBe(false);
    // Label states the REAL covered span (starts at windowFrom, not Monday).
    expect(leading?.label).toMatch(/^May 6/);
    expect(
      completeWeeklyActive(b).some((w) => w.weekStart === "2026-05-04"),
    ).toBe(false);
  });
});

describe("materializeMeasuredZeroWeeks", () => {
  it("fills interior and trailing activity-less complete weeks as measured zeros; never leading zeros", () => {
    // 4 people active only in the weeks of May 11 and Jun 8; windowTo Jun 30
    // (Tuesday) → last complete week is Jun 22.
    const rows = ["s1", "s2", "s3", "s4"].flatMap((s) => [
      ad(s, "2026-05-11"),
      ad(s, "2026-06-08"),
    ]);
    const b = computeUsageBaselines({
      activeDayRows: rows,
      identityLinks: identities,
      windowTo: WINDOW_TO,
      weeks: WEEKS,
    });
    const weekly = materializeMeasuredZeroWeeks(b);
    expect(weekly.map((w) => w.weekStart)).toEqual([
      "2026-05-11", // activity
      "2026-05-18", // materialized zero (interior)
      "2026-05-25", // materialized zero (interior)
      "2026-06-01", // materialized zero (interior)
      "2026-06-08", // activity
      "2026-06-15", // materialized zero (trailing)
      "2026-06-22", // materialized zero (trailing — last complete week)
    ]);
    const zeros = weekly.filter((w) => w.activePeople === 0);
    expect(zeros).toHaveLength(5);
    for (const z of zeros) {
      expect(z.complete).toBe(true);
      expect(z.activePersonDays).toBe(0);
    }
    // No week before the first activity week (leading zeros would fabricate
    // a 0→N adoption ramp).
    expect(weekly[0].weekStart).toBe("2026-05-11");
    expect(weekly[0].activePeople).toBe(4);
  });

  it("returns [] when there are no complete weeks with activity", () => {
    expect(
      materializeMeasuredZeroWeeks({ weeklyActive: [], windowTo: WINDOW_TO }),
    ).toEqual([]);
  });
});
