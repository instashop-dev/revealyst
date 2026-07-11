import { describe, expect, it } from "vitest";
import {
  computeAttributionTrend,
  DEFAULT_TREND_WEEKS,
  type UsageDayRow,
} from "../src/lib/attribution-trend";

// F1.7 — pure attribution-coverage trend over usage-day (`active_day`) rows.
// Denominator = usage-days; numerator = person-attributed usage-days. All UTC.

const day = (d: string, attribution: string): UsageDayRow => ({
  day: d,
  attribution,
});

// Mondays 7 days apart, oldest first (2026-06-01 is a Monday).
function mondayPlus(weeks: number): string {
  const base = new Date("2026-06-01T00:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}

describe("computeAttributionTrend", () => {
  it("returns empty (no card) when there are no usage rows", () => {
    expect(computeAttributionTrend([])).toEqual({ kind: "empty" });
  });

  it("ignores rows whose attribution is not a known ladder level (empty)", () => {
    const result = computeAttributionTrend([
      day("2026-06-01", "bogus"),
      day("2026-06-02", ""),
    ]);
    expect(result).toEqual({ kind: "empty" });
  });

  it("reports 100% with no 'up from' claim for a single all-person week", () => {
    const result = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "person"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.currentPct).toBe(100);
    expect(result.personDays).toBe(2);
    expect(result.totalDays).toBe(2);
    expect(result.byLevel.person).toEqual({ days: 2, pct: 100 });
    expect(result.byLevel.key_project).toEqual({ days: 0, pct: 0 });
    expect(result.byLevel.account).toEqual({ days: 0, pct: 0 });
    expect(result.trend).toHaveLength(1);
    // Single measured week -> no fabricated comparison.
    expect(result.delta).toEqual({ kind: "first" });
  });

  it("computes the person-attributed share across mixed levels, byLevel summing to total", () => {
    // One week: 2 person, 1 key_project, 1 account = 4 usage-days, 50% person.
    const result = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "person"),
      day("2026-06-03", "key_project"),
      day("2026-06-04", "account"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.totalDays).toBe(4);
    expect(result.currentPct).toBe(50);
    expect(result.byLevel.person).toEqual({ days: 2, pct: 50 });
    expect(result.byLevel.key_project).toEqual({ days: 1, pct: 25 });
    expect(result.byLevel.account).toEqual({ days: 1, pct: 25 });
    // byLevel days sum exactly to totalDays.
    const summed =
      result.byLevel.person.days +
      result.byLevel.key_project.days +
      result.byLevel.account.days;
    expect(summed).toBe(result.totalDays);
    // currentPct is exactly byLevel.person.pct by construction.
    expect(result.currentPct).toBe(result.byLevel.person.pct);
  });

  it("buckets usage-days into UTC ISO weeks anchored on Monday", () => {
    // 2026-06-07 is a Sunday -> belongs to the week of Mon 2026-06-01.
    // 2026-06-08 is a Monday -> starts a new week.
    const result = computeAttributionTrend([
      day("2026-06-07", "person"),
      day("2026-06-08", "person"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend.map((p) => p.weekStart)).toEqual([
      "2026-06-01",
      "2026-06-08",
    ]);
  });

  it("produces a real 'up from' delta across two weeks (rising)", () => {
    const result = computeAttributionTrend([
      // Week of 2026-06-01: 1 person of 2 -> 50%.
      day("2026-06-01", "person"),
      day("2026-06-02", "account"),
      // Week of 2026-06-15: 2 person of 2 -> 100%.
      day("2026-06-15", "person"),
      day("2026-06-16", "person"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.delta).toEqual({
      kind: "delta",
      currentPct: 100,
      previousPct: 50,
      deltaPct: 50,
      weeksApart: 2,
      previousWeekStart: "2026-06-01",
    });
    // Aggregate headline over both displayed weeks: 3 person of 4 = 75%.
    expect(result.currentPct).toBe(75);
  });

  it("produces a falling delta when coverage drops between weeks", () => {
    const result = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "person"),
      day("2026-06-15", "account"),
      day("2026-06-16", "person"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    if (result.delta.kind !== "delta") throw new Error("expected delta");
    expect(result.delta.previousPct).toBe(100);
    expect(result.delta.currentPct).toBe(50);
    expect(result.delta.deltaPct).toBe(-50);
  });

  it("rounds percentages to one decimal place", () => {
    // 1 person of 3 = 33.333% -> 33.3.
    const result = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "account"),
      day("2026-06-03", "account"),
    ]);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.currentPct).toBe(33.3);
    expect(result.byLevel.account.pct).toBe(66.7);
  });

  it("caps the trend to the most recent `weeks`, and computes headline/byLevel over ONLY those weeks", () => {
    // 15 distinct weeks, one usage-day each. The 3 OLDEST weeks are account-
    // attributed (0% person); the 12 newest are person-attributed (100%).
    const rows: UsageDayRow[] = [];
    for (let w = 0; w < 15; w++) {
      rows.push(day(mondayPlus(w), w < 3 ? "account" : "person"));
    }
    const result = computeAttributionTrend(rows, { weeks: DEFAULT_TREND_WEEKS });
    if (result.kind !== "measured") throw new Error("expected measured");
    // Only the newest 12 weeks are displayed...
    expect(result.trend).toHaveLength(12);
    expect(result.trend[0].weekStart).toBe(mondayPlus(3));
    expect(result.trend[11].weekStart).toBe(mondayPlus(14));
    // ...so the older account-only weeks never leak into the headline: all 12
    // displayed usage-days are person-attributed -> 100%, totalDays 12 (not 15).
    expect(result.totalDays).toBe(12);
    expect(result.currentPct).toBe(100);
    expect(result.byLevel.account.days).toBe(0);
  });

  it("respects a smaller custom `weeks` cap", () => {
    const rows: UsageDayRow[] = [];
    for (let w = 0; w < 6; w++) rows.push(day(mondayPlus(w), "person"));
    const result = computeAttributionTrend(rows, { weeks: 3 });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend).toHaveLength(3);
    expect(result.trend[0].weekStart).toBe(mondayPlus(3));
  });

  it("is order-independent (rows may arrive unsorted)", () => {
    const rows = [
      day("2026-06-16", "person"),
      day("2026-06-01", "account"),
      day("2026-06-02", "person"),
      day("2026-06-15", "person"),
    ];
    const result = computeAttributionTrend(rows);
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend.map((p) => p.weekStart)).toEqual([
      "2026-06-01",
      "2026-06-15",
    ]);
    expect(result.totalDays).toBe(4);
  });
});
