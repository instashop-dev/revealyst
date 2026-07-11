import {
  isUsableConnection,
  type ConnectionChannelInput,
} from "./onboarding-guide";
import { addUtcDays } from "./raw-metric-delta";

// F2.3 / research I2 — request-time spike detection. Rolling mean/σ (z-score)
// over `metric_records` daily totals, computed on already-fetched rows. NO
// cache table, NO precompute, NO ML (tripwire) — pure functions. No React, no
// I/O.
//
// Copy discipline (G7 / invariant b): a spike is labeled *directional* and
// framed "unusual versus your baseline" — NEVER "wrong". A high-spend day may
// be a perfectly good release day; this surface points a finger at it for a
// human to judge, it does not judge. See anomaly-glossary.ts for the rendered
// copy.
//
// Honesty rules:
//  - The current day (`today`) is a PARTIAL, still-ingesting day — it is
//    NEVER the evaluated day and NEVER in a baseline. The evaluated day is the
//    last COMPLETE day (today − 1).
//  - A day is compared ONLY against the trailing window that EXCLUDES it (a day
//    can't be part of the baseline it's measured against).
//  - Baselines need ≥ {@link ANOMALY_MIN_BASELINE_DAYS} measured days, else
//    `insufficient` (no output) — a spike off three data points is noise.
//  - G5 staleness: if the org's data channels are stale past
//    {@link ANOMALY_STALE_AFTER_DAYS}, the whole check is SUPPRESSED — an
//    unsynced stretch's missing recent days must not read as a collapse, and a
//    stale org's "last complete day" isn't current enough to call unusual.
//    This is the ONLY sync-shaped gate; see the note above `dailyTotals` for
//    why a "post-gap catch-up batch" suppression is structurally unnecessary
//    on this pipeline (and would only ever have suppressed real spikes).
//  - Relative gates lie at tiny scale: a spike must also clear
//    {@link ANOMALY_MIN_ABS_DELTA} in absolute terms.

export type SpikeMetric = "spend" | "prompts";

/** The trailing baseline window length (days) each day is compared against. 28
 * days = a stable 4-week read that smooths weekday/weekend swings — the same
 * span RECENT_PERIOD_DAYS uses for the movement strip. Not a benchmark; the
 * baseline is the org's OWN recent history. */
export const ANOMALY_BASELINE_DAYS = 28;

/** A baseline with fewer than this many MEASURED days (days that actually have
 * data in the trailing window) yields no output — too few points for a mean/σ
 * to be meaningful. Half the baseline window. */
export const ANOMALY_MIN_BASELINE_DAYS = 14;

/** Standard-deviations above the trailing mean a day must clear. z ≥ 3 (~3σ)
 * is deliberately conservative: this fires an unprompted callout, so the bar
 * is set to catch the genuinely unusual, not the merely above-average.
 * Uncalibrated presentational threshold — directional label required. */
export const ANOMALY_Z_THRESHOLD = 3;

/** AND the day must be at least this many TIMES the trailing mean. The z-score
 * alone can flag a tiny absolute jump off an ultra-tight baseline; the factor
 * floor keeps a callout to changes a human would call large ("2.4× your
 * baseline"). Uncalibrated presentational threshold. */
export const ANOMALY_FACTOR_FLOOR = 2;

/** If the freshest successful sync across usable connections is older than this
 * many days, the org's data is STALE and every spike check is suppressed (G5).
 * There is no shared staleness threshold in the codebase (SyncStatusBadge has
 * none) — this is the anomaly surface's own definition. Two days tolerates a
 * normal weekend/overnight sync cadence while still catching a channel that
 * has genuinely stopped. */
export const ANOMALY_STALE_AFTER_DAYS = 2;

/** AND the day must exceed the trailing mean by at least this ABSOLUTE amount
 * (review F5). The z-score and the factor are both scale-free, so a flat 1¢
 * baseline followed by a 2¢ day passed every relative gate — a prominent
 * "Spend is 2× your recent baseline" callout over one cent. Floors are in
 * each metric's native unit: 500 cents ($5) of extra spend / 20 extra prompts
 * — below that, a day isn't worth an unprompted callout regardless of how
 * statistically unusual it is. Uncalibrated presentational thresholds. */
export const ANOMALY_MIN_ABS_DELTA: Record<SpikeMetric, number> = {
  spend: 500,
  prompts: 20,
};

type DailyRow = { day: string; value: number };

export type SpikeSignal = {
  metric: SpikeMetric;
  /** The evaluated day (last complete day), `YYYY-MM-DD` UTC. */
  day: string;
  /** That day's total for the metric. */
  value: number;
  /** Mean of the trailing measured baseline (excludes `day`). */
  baselineMean: number;
  /** Sample standard deviation of the trailing measured baseline. */
  baselineStdDev: number;
  /** `value / baselineMean`, rounded to one decimal — the "2.4×" figure. */
  factor: number;
  /** `(value − mean) / stdDev`, rounded to two decimals; `null` when the
   * baseline had zero variance (a jump off a perfectly flat baseline — the
   * factor floor still gates it). */
  zScore: number | null;
  /** Number of measured days in the trailing baseline. */
  baselineDays: number;
};

export type AnomalyResult =
  | { kind: "spike"; signal: SpikeSignal }
  /** Baseline is sound, the evaluated day is not unusual. */
  | { kind: "none"; metric: SpikeMetric }
  /** Not enough measured baseline days to judge. */
  | { kind: "insufficient"; metric: SpikeMetric; measuredDays: number }
  /** The check didn't run: the org's channels are stale (G5). */
  | { kind: "suppressed"; metric: SpikeMetric; reason: "stale" };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Freshest successful sync across USABLE connections, or null if none have
 * ever synced. `lastSuccessAt` is the ONLY freshness source (G5). */
function freshestSync(
  connections: readonly ConnectionChannelInput[],
): Date | null {
  let freshest: number | null = null;
  for (const c of connections) {
    if (!isUsableConnection(c)) continue;
    if (c.lastSuccessAt == null) continue;
    const t = new Date(c.lastSuccessAt).getTime();
    if (Number.isNaN(t)) continue;
    if (freshest === null || t > freshest) freshest = t;
  }
  return freshest === null ? null : new Date(freshest);
}

/**
 * G5 staleness gate. Stale iff no usable connection has EVER synced, or the
 * freshest sync is more than {@link ANOMALY_STALE_AFTER_DAYS} days before
 * `today`. Exported so the plateau detector shares one definition of "stale"
 * (both early-warning surfaces gate identically).
 */
export function isChannelStale(
  connections: readonly ConnectionChannelInput[],
  today: string,
  staleAfterDays: number = ANOMALY_STALE_AFTER_DAYS,
): boolean {
  const freshest = freshestSync(connections);
  if (freshest === null) return true;
  const cutoff = new Date(`${addUtcDays(today, -staleAfterDays)}T00:00:00.000Z`);
  return freshest.getTime() < cutoff.getTime();
}

// NO post-gap "catch-up batch" suppression — deliberately (review F2). It
// looks necessary ("a sync after a gap piles days of spend into one day") but
// is structurally void on this pipeline: `metric_records` are DAY-KEYED (the
// frozen upsert key is org/subject/metric/day/dim) and the local agent
// summarizes per LOG DATE, so a catch-up sync backfills the TRUE historical
// days — it cannot pile volume into the sync day. The local channel also
// emits `spend_cents_estimated`, never `spend_cents`, so a local batch can't
// even reach the spend series this detector reads. A suppression keyed on
// "activity gap then burst" therefore only ever suppressed REAL spikes (a
// genuine post-holiday surge is exactly a gap-then-burst). The staleness gate
// above is the complete G5 story: while the channel is behind, the whole
// check is off; once synced, every day's total is that day's truth.

/** Sum a metric's rows into one total per UTC day. */
function dailyTotals(rows: readonly DailyRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    totals.set(r.day, (totals.get(r.day) ?? 0) + r.value);
  }
  return totals;
}

/**
 * Detects a spike on the last complete day for one metric. See the module
 * header for the honesty rules. Gate order: staleness (whole check) →
 * insufficient baseline → statistical test (z AND factor AND absolute delta).
 *
 * KNOWN CONSERVATIVE FALSE NEGATIVE (documented, pinned in tests): the
 * baseline is a mean/σ, so a single huge historic outlier inside the trailing
 * window inflates both and can mask a genuine spike today. That failure mode
 * only ever SUPPRESSES (never fabricates), which is the right direction for
 * an unprompted callout. A robust median/MAD baseline would fix it — noted as
 * future work, not built now (keep v1 legible; thresholds are uncalibrated
 * anyway).
 */
export function detectDailySpike(input: {
  metric: SpikeMetric;
  /** Metric rows over a window comfortably wider than
   * {@link ANOMALY_BASELINE_DAYS} (the dashboard's 180d). `{ day, value }`
   * — extra fields on the caller's rows are ignored. */
  records: readonly DailyRow[];
  /** Today's UTC date (`YYYY-MM-DD`) — the partial day, EXCLUDED everywhere.
   * The evaluated day is `today − 1`. */
  today: string;
  /** For the G5 staleness gate. */
  connections: readonly ConnectionChannelInput[];
}): AnomalyResult {
  const { metric } = input;

  // 1) Staleness suppresses the whole check.
  if (isChannelStale(input.connections, input.today)) {
    return { kind: "suppressed", metric, reason: "stale" };
  }

  const evalDay = addUtcDays(input.today, -1);
  const totals = dailyTotals(input.records);
  const evalValue = totals.get(evalDay) ?? 0;

  // A zero/absent day is never a spike (nothing happened).
  if (evalValue <= 0) return { kind: "none", metric };

  // 2) Trailing baseline = the measured days in [evalDay-BASELINE, evalDay-1].
  const baselineFrom = addUtcDays(evalDay, -ANOMALY_BASELINE_DAYS);
  const baselineTo = addUtcDays(evalDay, -1);
  const baseline: number[] = [];
  for (const [day, value] of totals) {
    if (day >= baselineFrom && day <= baselineTo) baseline.push(value);
  }
  if (baseline.length < ANOMALY_MIN_BASELINE_DAYS) {
    return { kind: "insufficient", metric, measuredDays: baseline.length };
  }

  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  if (mean <= 0) return { kind: "none", metric };
  // Sample (n−1) variance.
  const variance =
    baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseline.length - 1);
  const stdDev = Math.sqrt(variance);
  const factor = evalValue / mean;
  // Zero-variance baseline: any rise is "infinitely" significant, so the
  // factor floor is the real gate (documented). Represent z as null (not a
  // fabricated finite number) when there's no variance to divide by.
  const zScore = stdDev > 0 ? (evalValue - mean) / stdDev : null;
  const zPasses = zScore === null ? evalValue > mean : zScore >= ANOMALY_Z_THRESHOLD;

  // 3) Statistical test + the absolute-delta floor (review F5): a flat 1¢
  // baseline followed by a 2¢ day is a perfect 2× with infinite significance
  // — and utterly not worth a callout. The floor applies on EVERY path
  // (zero-variance and real-variance alike).
  const absDeltaPasses =
    evalValue - mean >= ANOMALY_MIN_ABS_DELTA[metric];
  if (!(zPasses && factor >= ANOMALY_FACTOR_FLOOR && absDeltaPasses)) {
    return { kind: "none", metric };
  }

  return {
    kind: "spike",
    signal: {
      metric,
      day: evalDay,
      value: evalValue,
      baselineMean: round2(mean),
      baselineStdDev: round2(stdDev),
      factor: round1(factor),
      zScore: zScore === null ? null : round2(zScore),
      baselineDays: baseline.length,
    },
  };
}
