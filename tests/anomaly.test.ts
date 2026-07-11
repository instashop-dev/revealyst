import { describe, expect, it } from "vitest";
import {
  ANOMALY_MIN_BASELINE_DAYS,
  detectDailySpike,
  isChannelStale,
  type SpikeMetric,
} from "../src/lib/anomaly";
import type { ConnectionChannelInput } from "../src/lib/onboarding-guide";
import { addUtcDays } from "../src/lib/raw-metric-delta";

const TODAY = "2026-07-01";
const EVAL_DAY = addUtcDays(TODAY, -1); // 2026-06-30 — the last complete day

type Row = { day: string; value: number };

/** `count` consecutive daily rows of `value`, the LAST dated `endDay`. */
function flat(endDay: string, count: number, value: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ day: addUtcDays(endDay, -(count - 1 - i)), value });
  }
  return rows;
}

/** A fresh, usable connection so the staleness gate never fires by accident. */
function freshConn(
  vendor = "anthropic_console",
  at = TODAY,
): ConnectionChannelInput {
  return { vendor, status: "active", lastSuccessAt: new Date(`${at}T12:00:00.000Z`) };
}

function detect(over: {
  records: Row[];
  connections?: ConnectionChannelInput[];
  activeDayRecords?: Row[];
  metric?: SpikeMetric;
}) {
  return detectDailySpike({
    metric: over.metric ?? "spend",
    records: over.records,
    today: TODAY,
    connections: over.connections ?? [freshConn()],
    activeDayRecords: over.activeDayRecords ?? [],
  });
}

describe("detectDailySpike", () => {
  it("a perfectly flat series → none (no spike)", () => {
    // 30 flat days ending at the eval day; eval day equals the baseline.
    const result = detect({ records: flat(EVAL_DAY, 30, 100) });
    expect(result.kind).toBe("none");
  });

  it("a genuine 3× day → spike with the correct factor and day", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100); // 28 days before eval
    const records = [...baseline, { day: EVAL_DAY, value: 300 }];
    const result = detect({ records });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    expect(result.signal.day).toBe(EVAL_DAY);
    expect(result.signal.factor).toBe(3);
    expect(result.signal.value).toBe(300);
  });

  it("excludes the anomaly day from its OWN baseline (mean/days ignore eval day)", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
    const records = [...baseline, { day: EVAL_DAY, value: 300 }];
    const result = detect({ records });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    // Baseline is the 28 prior days only — the 300 eval day is NOT averaged in.
    expect(result.signal.baselineMean).toBe(100);
    expect(result.signal.baselineDays).toBe(28);
  });

  it("a zero-variance baseline reports zScore null but still flags on the factor", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 300 }],
    });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    expect(result.signal.zScore).toBeNull();
    expect(result.signal.baselineStdDev).toBe(0);
  });

  it("the partial current day is never evaluated (a huge 'today' is ignored)", () => {
    const baseline = flat(EVAL_DAY, 30, 100); // eval day is flat/normal
    const records = [...baseline, { day: TODAY, value: 1_000_000 }];
    const result = detect({ records });
    expect(result.kind).toBe("none");
  });

  it("fewer than the minimum measured baseline days → insufficient", () => {
    // Only 10 baseline days present (+ the eval day) — below the 14-day floor.
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 10, 100);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 300 }],
    });
    expect(result.kind).toBe("insufficient");
    if (result.kind !== "insufficient") return;
    expect(result.measuredDays).toBe(10);
    expect(result.measuredDays).toBeLessThan(ANOMALY_MIN_BASELINE_DAYS);
  });

  it("an absent/zero eval day is never a spike", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
    // No eval-day row at all.
    const result = detect({ records: baseline });
    expect(result.kind).toBe("none");
  });

  describe("G5 staleness", () => {
    it("suppresses the whole check when the freshest sync is stale", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
      const result = detect({
        records: [...baseline, { day: EVAL_DAY, value: 300 }],
        connections: [freshConn("anthropic_console", addUtcDays(TODAY, -10))],
      });
      expect(result.kind).toBe("suppressed");
      if (result.kind !== "suppressed") return;
      expect(result.reason).toBe("stale");
    });

    it("suppresses when no usable connection has ever synced", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
      const result = detect({
        records: [...baseline, { day: EVAL_DAY, value: 300 }],
        connections: [{ vendor: "cursor", status: "pending", lastSuccessAt: null }],
      });
      expect(result.kind).toBe("suppressed");
    });

    it("isChannelStale: fresh within threshold → not stale; a paused connection's success doesn't count", () => {
      expect(isChannelStale([freshConn()], TODAY)).toBe(false);
      expect(
        isChannelStale(
          [{ vendor: "cursor", status: "paused", lastSuccessAt: new Date(`${TODAY}T00:00:00Z`) }],
          TODAY,
        ),
      ).toBe(true);
    });
  });

  describe("G5 post-gap catch-up batch (local channel)", () => {
    // Spend baseline is complete (28 days), so a spike WOULD fire — the only
    // question is whether the active_day gap suppresses it.
    const spendBaseline = flat(addUtcDays(EVAL_DAY, -1), 28, 100);
    const spendRecords = [...spendBaseline, { day: EVAL_DAY, value: 300 }];
    // active_day: active up to eval-6, then a 5-day gap (eval-5..eval-1), then a
    // burst on the eval day — the catch-up-sync signature.
    const activeDayRecords = [
      ...flat(addUtcDays(EVAL_DAY, -6), 20, 1),
      { day: EVAL_DAY, value: 1 },
    ];

    it("a local-channel org: 5-day gap then a burst on the eval day → suppressed, not flagged", () => {
      const result = detect({
        records: spendRecords,
        activeDayRecords,
        connections: [freshConn("claude_code_local")],
      });
      expect(result.kind).toBe("suppressed");
      if (result.kind !== "suppressed") return;
      expect(result.reason).toBe("postGapBatch");
    });

    it("the SAME data on a poll-only org (no local channel) → the spike stands", () => {
      const result = detect({
        records: spendRecords,
        activeDayRecords,
        connections: [freshConn("anthropic_console")],
      });
      expect(result.kind).toBe("spike");
    });

    it("a local-channel org with continuous activity (no gap) → the spike stands", () => {
      const result = detect({
        records: spendRecords,
        activeDayRecords: flat(EVAL_DAY, 30, 1), // active every day, incl. eval day
        connections: [freshConn("claude_code_local")],
      });
      expect(result.kind).toBe("spike");
    });
  });
});
