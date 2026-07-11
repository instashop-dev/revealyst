import { describe, expect, it } from "vitest";
import {
  computeAgenticAdoption,
  type AgenticMetricRow,
} from "../src/lib/agentic-adoption";

// F1.4 agentic-adoption rate — pure derivation. No DB, hand-built metric rows.

function row(
  subjectId: string,
  day: string,
  value = 1,
  sourceConnector?: string,
): AgenticMetricRow {
  return { subjectId, day, value, sourceConnector };
}

describe("computeAgenticAdoption — empty / degraded states", () => {
  it("no active rows at all → noActivity (nothing to measure a rate against)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [],
      activeDayRows: [],
    });
    expect(result).toEqual({ kind: "noActivity" });
  });

  it("active rows but ZERO agent rows → noAgenticData, never a measured 0%", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [],
      activeDayRows: [row("s1", "2026-06-01"), row("s2", "2026-06-01")],
    });
    // The honest 'no agent telemetry' state — distinct from a real 0% adoption.
    expect(result.kind).toBe("noAgenticData");
    if (result.kind === "noAgenticData") {
      expect(result.activeDays).toBe(2);
    }
  });

  it("agent rows present but agent flag value 0 is treated as absence", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01", 0)],
      activeDayRows: [row("s1", "2026-06-01")],
    });
    expect(result.kind).toBe("noAgenticData");
  });
});

describe("computeAgenticAdoption — rate math", () => {
  it("rate is distinct agentic subject-days ÷ distinct active subject-days", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01"), row("s2", "2026-06-01")],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-01"),
        row("s3", "2026-06-01"),
        row("s4", "2026-06-01"),
      ],
    });
    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.activeDays).toBe(4);
    expect(result.agenticDays).toBe(2);
    expect(result.ratePct).toBe(50);
  });

  it("dedups multiple rows for the same subject-day (counts the day once)", () => {
    const result = computeAgenticAdoption({
      // Same subject-day flagged by two connectors — one agentic day, not two.
      agentActiveRows: [
        row("s1", "2026-06-01", 1, "anthropic-console@1"),
        row("s1", "2026-06-01", 1, "cursor@1"),
      ],
      activeDayRows: [row("s1", "2026-06-01"), row("s1", "2026-06-01")],
    });
    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.agenticDays).toBe(1);
    expect(result.activeDays).toBe(1);
    expect(result.ratePct).toBe(100);
  });

  it("intersects with active days so the rate can never exceed 100%", () => {
    const result = computeAgenticAdoption({
      // s2|d2 has an agent flag but NO active_day row — excluded from numerator.
      agentActiveRows: [row("s1", "2026-06-01"), row("s2", "2026-06-02")],
      activeDayRows: [row("s1", "2026-06-01")],
    });
    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.agenticDays).toBe(1);
    expect(result.activeDays).toBe(1);
    expect(result.ratePct).toBe(100);
  });

  it("rounds the rate to two decimals", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01")],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-01"),
        row("s3", "2026-06-01"),
      ],
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.ratePct).toBeCloseTo(33.33, 2);
  });
});

describe("computeAgenticAdoption — per-vendor coverage", () => {
  it("counts distinct agentic days per source connector, sorted desc", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        row("s1", "2026-06-01", 1, "anthropic-console@1"),
        row("s1", "2026-06-02", 1, "anthropic-console@1"),
        row("s2", "2026-06-01", 1, "cursor@1"),
      ],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s1", "2026-06-02"),
        row("s2", "2026-06-01"),
      ],
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.coveragePerVendor).toEqual([
      { sourceConnector: "anthropic-console@1", agenticDays: 2 },
      { sourceConnector: "cursor@1", agenticDays: 1 },
    ]);
  });
});

describe("computeAgenticAdoption — weekly trend + delta", () => {
  // 2026-06-01 is a Monday; 2026-06-08 is the next Monday.
  it("buckets by Monday-anchored week and computes a per-week rate", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        // Week 1: 1 of 2 active days agentic → 50%.
        row("s1", "2026-06-01"),
        // Week 2: 2 of 2 active days agentic → 100%.
        row("s1", "2026-06-08"),
        row("s2", "2026-06-09"),
      ],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-02"),
        row("s1", "2026-06-08"),
        row("s2", "2026-06-09"),
      ],
    });
    if (result.kind !== "measured") throw new Error("expected measured");

    expect(result.ratePct).toBe(75); // 3 of 4 overall
    expect(result.trend).toHaveLength(2);
    expect(result.trend[0]).toMatchObject({
      weekStart: "2026-06-01",
      label: "Jun 1–7",
      ratePct: 50,
      agenticDays: 1,
      activeDays: 2,
    });
    expect(result.trend[1]).toMatchObject({
      weekStart: "2026-06-08",
      ratePct: 100,
      agenticDays: 2,
      activeDays: 2,
    });

    // Delta reuses the shared DeltaResult shape: last week vs the prior week.
    expect(result.delta).toEqual({
      kind: "delta",
      current: 100,
      previous: 50,
      delta: 50,
      previousPeriodLabel: "Jun 1–7",
    });
  });

  it("omits weeks with no active days (never plots a 0% gap week)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01")],
      activeDayRows: [row("s1", "2026-06-01")],
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    // Only the one week that has data — no empty intermediate buckets.
    expect(result.trend).toHaveLength(1);
    expect(result.delta).toEqual({ kind: "first" });
  });

  it("labels a cross-month week with both months", () => {
    // 2026-06-01 is Monday; the prior week starts Mon 2026-05-25 (May 25–31).
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-05-30")],
      activeDayRows: [row("s1", "2026-05-30"), row("s2", "2026-06-01")],
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend[0].weekStart).toBe("2026-05-25");
    expect(result.trend[0].label).toBe("May 25–31");
  });
});
