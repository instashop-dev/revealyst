import {
  isUsableConnection,
  LOCAL_CHANNEL_VENDOR,
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
//  - G5 post-gap batch: for local-channel orgs a burst on the first active day
//    after a ≥ {@link ANOMALY_POST_GAP_MIN_DAYS}-day gap is a CATCH-UP sync,
//    not a spike — SUPPRESSED. (A post-gap sync is not a spend spike.)

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

/** For local-channel orgs, a burst on the first active day after a gap of at
 * least this many empty active-days is treated as a catch-up sync batch, not a
 * spike (G5). Three days distinguishes a real multi-day silence-then-sync from
 * an ordinary one-day sync gap. */
export const ANOMALY_POST_GAP_MIN_DAYS = 3;

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
  /** A spike would have fired but is suppressed by a G5 gate. */
  | { kind: "suppressed"; metric: SpikeMetric; reason: "stale" | "postGapBatch" };

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

function hasLocalChannel(
  connections: readonly ConnectionChannelInput[],
): boolean {
  return connections.some(
    (c) => isUsableConnection(c) && c.vendor === LOCAL_CHANNEL_VENDOR,
  );
}

/**
 * True when `evalDay` is the first active day after a gap of at least
 * `minGap` empty active-days — the catch-up-sync signature. Reads the
 * ORG-LEVEL union of `active_day` days: a poll connector that keeps the org
 * active every day leaves no gap, so this only ever fires when the org
 * genuinely went silent (the local-channel case the caller gates on).
 */
function isPostGapResumption(
  activeDayRecords: readonly DailyRow[],
  evalDay: string,
  minGap: number,
): boolean {
  const activeDays = new Set<string>();
  for (const r of activeDayRecords) if (r.value > 0) activeDays.add(r.day);
  // A resumption BURST requires activity on the evaluated day itself.
  if (!activeDays.has(evalDay)) return false;
  let gap = 0;
  let d = addUtcDays(evalDay, -1);
  // Bounded: finding `minGap` consecutive empty days is enough to decide.
  while (gap < minGap) {
    if (activeDays.has(d)) break;
    gap += 1;
    d = addUtcDays(d, -1);
  }
  return gap >= minGap;
}

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
 * insufficient baseline → statistical test → post-gap suppression (only a
 * would-be spike is ever suppressed, so `none` never masks a catch-up batch).
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
  /** For the G5 staleness + post-gap gates. */
  connections: readonly ConnectionChannelInput[];
  /** Org `active_day` rows for post-gap detection (the same rows the dashboard
   * already fetched). */
  activeDayRecords: readonly DailyRow[];
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

  // 3) Statistical test.
  if (!(zPasses && factor >= ANOMALY_FACTOR_FLOOR)) {
    return { kind: "none", metric };
  }

  // 4) Post-gap batch suppression (local-channel orgs only).
  if (
    hasLocalChannel(input.connections) &&
    isPostGapResumption(input.activeDayRecords, evalDay, ANOMALY_POST_GAP_MIN_DAYS)
  ) {
    return { kind: "suppressed", metric, reason: "postGapBatch" };
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
