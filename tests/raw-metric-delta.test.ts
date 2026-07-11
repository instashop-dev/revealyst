import { describe, expect, it } from "vitest";
import {
  adjacentPeriods,
  deriveRawMetricDelta,
  formatRawMetricDelta,
  periodRangeLabel,
  type RawMetricDelta,
} from "../src/lib/raw-metric-delta";

// Pure-function suite (F1.2 / M1): no DB, no I/O.

describe("adjacentPeriods", () => {
  it("splits into two equal, adjacent, inclusive windows ending at `to`", () => {
    expect(adjacentPeriods("2026-06-30", 28)).toEqual({
      currentFrom: "2026-06-03",
      currentTo: "2026-06-30",
      previousFrom: "2026-05-06",
      previousTo: "2026-06-02",
    });
  });

  it("a 7-day period is exactly one week per side", () => {
    expect(adjacentPeriods("2026-06-14", 7)).toEqual({
      currentFrom: "2026-06-08",
      currentTo: "2026-06-14",
      previousFrom: "2026-06-01",
      previousTo: "2026-06-07",
    });
  });

  it("crosses a year boundary correctly", () => {
    expect(adjacentPeriods("2026-01-01", 1)).toEqual({
      currentFrom: "2026-01-01",
      currentTo: "2026-01-01",
      previousFrom: "2025-12-31",
      previousTo: "2025-12-31",
    });
  });
});

describe("periodRangeLabel", () => {
  it("renders a UTC short range, collapsing a single day", () => {
    expect(periodRangeLabel("2026-06-03", "2026-06-30")).toBe("Jun 3–Jun 30");
    expect(periodRangeLabel("2026-06-30", "2026-06-30")).toBe("Jun 30");
  });
});

describe("deriveRawMetricDelta", () => {
  const label = "Jun 1–28";

  it("no data before the current period + current activity → first (never a fake jump)", () => {
    expect(
      deriveRawMetricDelta({
        currentTotal: 42,
        previousTotal: 0,
        hasDataBeforeCurrent: false,
        previousPeriodLabel: label,
      }),
    ).toEqual({ kind: "first", current: 42 });
  });

  it("no data at all on either side → notComparable(noData)", () => {
    expect(
      deriveRawMetricDelta({
        currentTotal: 0,
        previousTotal: 0,
        hasDataBeforeCurrent: false,
        previousPeriodLabel: label,
      }),
    ).toEqual({ kind: "notComparable", reason: "noData" });
  });

  it("measured previous period → delta with a percent change", () => {
    const result = deriveRawMetricDelta({
      currentTotal: 120,
      previousTotal: 100,
      hasDataBeforeCurrent: true,
      previousPeriodLabel: label,
    });
    expect(result).toEqual({
      kind: "delta",
      current: 120,
      previous: 100,
      delta: 20,
      pctChange: 20,
      previousPeriodLabel: label,
    });
  });

  it("a real measured-0 previous period yields a delta but NO percent (no honest %)", () => {
    const result = deriveRawMetricDelta({
      currentTotal: 5,
      previousTotal: 0,
      hasDataBeforeCurrent: true,
      previousPeriodLabel: label,
    });
    expect(result).toMatchObject({ kind: "delta", delta: 5, pctChange: null });
  });

  it("a drop to zero is a real negative delta (100% down), not omitted", () => {
    const result = deriveRawMetricDelta({
      currentTotal: 0,
      previousTotal: 40,
      hasDataBeforeCurrent: true,
      previousPeriodLabel: label,
    });
    expect(result).toMatchObject({ kind: "delta", delta: -40, pctChange: -100 });
  });
});

describe("formatRawMetricDelta", () => {
  const base = { previousPeriodLabel: "Jun 1–28", previous: 100 };

  it("positive delta → up arrow text + percent", () => {
    const f = formatRawMetricDelta(
      { kind: "delta", current: 120, delta: 20, pctChange: 20, ...base },
      "active people",
    );
    expect(f.direction).toBe("up");
    expect(f.text).toBe("+20");
    expect(f.pctText).toBe("+20%");
    expect(f.srText).toContain("rose");
  });

  it("negative delta → down direction", () => {
    const f = formatRawMetricDelta(
      { kind: "delta", current: 80, delta: -20, pctChange: -20, ...base },
      "active people",
    );
    expect(f.direction).toBe("down");
    expect(f.text).toBe("-20");
    expect(f.srText).toContain("fell");
  });

  it("zero delta → 'no change', never '+0'", () => {
    const f = formatRawMetricDelta(
      { kind: "delta", current: 100, delta: 0, pctChange: 0, ...base },
      "active people",
    );
    expect(f.direction).toBe("none");
    expect(f.text).toBe("no change");
    expect(f.pctText).toBeNull();
  });

  it("null pctChange → no percent text, magnitude still shown", () => {
    const f = formatRawMetricDelta(
      { kind: "delta", current: 5, delta: 5, pctChange: null, ...base },
      "active people",
    );
    expect(f.text).toBe("+5");
    expect(f.pctText).toBeNull();
  });

  it("uses the caller's value formatter for the magnitude", () => {
    const f = formatRawMetricDelta(
      { kind: "delta", current: 6000, delta: 2000, pctChange: 50, ...base },
      "spend",
      (n) => `$${(n / 100).toFixed(2)}`,
    );
    expect(f.text).toBe("+$20.00");
  });
});

// Exhaustiveness guard: the union stays these three kinds.
const _exhaustive: RawMetricDelta["kind"][] = ["delta", "first", "notComparable"];
void _exhaustive;
