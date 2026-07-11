import { describe, expect, it } from "vitest";
import {
  ANOMALY_MIN_ABS_DELTA,
  ANOMALY_MIN_BASELINE_DAYS,
  ANOMALY_Z_THRESHOLD,
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

/** `count` daily rows alternating low/high (real variance), LAST at `endDay`. */
function alternating(endDay: string, count: number, low: number, high: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      day: addUtcDays(endDay, -(count - 1 - i)),
      value: i % 2 === 0 ? low : high,
    });
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
  metric?: SpikeMetric;
}) {
  return detectDailySpike({
    metric: over.metric ?? "spend",
    records: over.records,
    today: TODAY,
    connections: over.connections ?? [freshConn()],
  });
}

describe("detectDailySpike", () => {
  it("a perfectly flat series → none (no spike)", () => {
    // 30 flat days ending at the eval day; eval day equals the baseline.
    const result = detect({ records: flat(EVAL_DAY, 30, 10_000) });
    expect(result.kind).toBe("none");
  });

  it("a genuine 3× day → spike with the correct factor and day", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000); // 28 days before eval
    const records = [...baseline, { day: EVAL_DAY, value: 30_000 }];
    const result = detect({ records });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    expect(result.signal.day).toBe(EVAL_DAY);
    expect(result.signal.factor).toBe(3);
    expect(result.signal.value).toBe(30_000);
  });

  it("excludes the anomaly day from its OWN baseline (mean/days ignore eval day)", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000);
    const records = [...baseline, { day: EVAL_DAY, value: 30_000 }];
    const result = detect({ records });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    // Baseline is the 28 prior days only — the 30k eval day is NOT averaged in.
    expect(result.signal.baselineMean).toBe(10_000);
    expect(result.signal.baselineDays).toBe(28);
  });

  it("a zero-variance baseline reports zScore null but still flags on the factor", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
    });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    expect(result.signal.zScore).toBeNull();
    expect(result.signal.baselineStdDev).toBe(0);
  });

  it("a REAL-variance baseline: z ≥ 3 spike carries a finite zScore (the z path, not the flat shortcut)", () => {
    // Alternating 9k/11k: mean 10k, sample σ ≈ 1018 — genuinely noisy data.
    const baseline = alternating(addUtcDays(EVAL_DAY, -1), 28, 9_000, 11_000);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
    });
    expect(result.kind).toBe("spike");
    if (result.kind !== "spike") return;
    expect(result.signal.baselineStdDev).toBeGreaterThan(0);
    expect(result.signal.zScore).not.toBeNull();
    expect(result.signal.zScore!).toBeGreaterThanOrEqual(ANOMALY_Z_THRESHOLD);
    expect(result.signal.factor).toBe(3);
  });

  it("a REAL-variance baseline: factor ≥ 2 but z < 3 → none (the z gate does real work)", () => {
    // Alternating 4k/16k: mean 10k, sample σ ≈ 6110. A 21k day is 2.1× the
    // mean but only ~1.8σ above it — within this org's own noise.
    const baseline = alternating(addUtcDays(EVAL_DAY, -1), 28, 4_000, 16_000);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 21_000 }],
    });
    expect(result.kind).toBe("none");
  });

  it("KNOWN CONSERVATIVE FALSE NEGATIVE (pinned): one huge historic outlier in the window masks a genuine 3× day", () => {
    // 27 typical 10k days + one 300k outlier inside the trailing window
    // inflate the mean to ~20.4k and σ to ~55k — a 30k day (3× typical) now
    // clears neither the factor nor the z gate. Mean/σ contamination only
    // ever SUPPRESSES (never fabricates) — acceptable for an unprompted
    // callout; a median/MAD baseline is noted as future work in anomaly.ts.
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000).map((r) =>
      r.day === addUtcDays(EVAL_DAY, -10) ? { ...r, value: 300_000 } : r,
    );
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
    });
    expect(result.kind).toBe("none");
  });

  it("the partial current day is never evaluated (a huge 'today' is ignored)", () => {
    const baseline = flat(EVAL_DAY, 30, 10_000); // eval day is flat/normal
    const records = [...baseline, { day: TODAY, value: 1_000_000 }];
    const result = detect({ records });
    expect(result.kind).toBe("none");
  });

  it("fewer than the minimum measured baseline days → insufficient", () => {
    // Only 10 baseline days present (+ the eval day) — below the 14-day floor.
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 10, 10_000);
    const result = detect({
      records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
    });
    expect(result.kind).toBe("insufficient");
    if (result.kind !== "insufficient") return;
    expect(result.measuredDays).toBe(10);
    expect(result.measuredDays).toBeLessThan(ANOMALY_MIN_BASELINE_DAYS);
  });

  it("an absent/zero eval day is never a spike", () => {
    const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000);
    // No eval-day row at all.
    const result = detect({ records: baseline });
    expect(result.kind).toBe("none");
  });

  describe("absolute-delta floor (F5 — relative gates lie at tiny scale)", () => {
    it("a flat 1¢ baseline + a 2¢ day is a perfect 2× and infinitely significant — and NOT a spike", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 1);
      const result = detect({
        records: [...baseline, { day: EVAL_DAY, value: 2 }],
      });
      expect(result.kind).toBe("none");
    });

    it("prompts: a 3× day below the +20-prompt floor → none; well above it → spike", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 5);
      expect(
        detect({
          metric: "prompts",
          records: [...baseline, { day: EVAL_DAY, value: 15 }], // +10 < 20
        }).kind,
      ).toBe("none");
      const spiked = detect({
        metric: "prompts",
        records: [...baseline, { day: EVAL_DAY, value: 40 }], // +35 ≥ 20
      });
      expect(spiked.kind).toBe("spike");
      expect(ANOMALY_MIN_ABS_DELTA.prompts).toBe(20);
    });
  });

  describe("G5 staleness", () => {
    it("suppresses the whole check when the freshest sync is stale", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000);
      const result = detect({
        records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
        connections: [freshConn("anthropic_console", addUtcDays(TODAY, -10))],
      });
      expect(result.kind).toBe("suppressed");
      if (result.kind !== "suppressed") return;
      expect(result.reason).toBe("stale");
    });

    it("suppresses when no usable connection has ever synced", () => {
      const baseline = flat(addUtcDays(EVAL_DAY, -1), 28, 10_000);
      const result = detect({
        records: [...baseline, { day: EVAL_DAY, value: 30_000 }],
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

  describe("no post-gap suppression (F2 — day-keyed records mean a catch-up sync backfills TRUE days)", () => {
    // A genuine post-holiday surge IS a gap-then-burst: spend rows absent for
    // 5 days, then a real 5× day. The removed activity-gap suppression
    // silently swallowed exactly this. Pin: it FLAGS.
    const gappedBaseline = flat(addUtcDays(EVAL_DAY, -6), 23, 10_000); // ends eval−6 → 5-day gap
    const records = [...gappedBaseline, { day: EVAL_DAY, value: 50_000 }];

    it("a genuine 5× post-holiday spike on a local-channel org FLAGS (staleness is the only sync gate)", () => {
      const result = detect({
        records,
        connections: [freshConn("claude_code_local")],
      });
      expect(result.kind).toBe("spike");
      if (result.kind !== "spike") return;
      expect(result.signal.factor).toBe(5);
      expect(result.signal.baselineDays).toBe(23); // measured days only
    });

    it("a fresh poll org with a pending never-synced agent connection FLAGS (a pending agent must not mute a poll org)", () => {
      const result = detect({
        records,
        connections: [
          freshConn("anthropic_console"),
          { vendor: "claude_code_local", status: "pending", lastSuccessAt: null },
        ],
      });
      expect(result.kind).toBe("spike");
    });
  });
});
