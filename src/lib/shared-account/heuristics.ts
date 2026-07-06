// Shared-account detection heuristics (W2-K, §6.2). Pure — no DB, no I/O.
//
// Usage patterns that imply one vendor seat is really several people —
// round-the-clock activity, usage volume several times the team median, or
// overlapping concurrent sessions — produce an advisory FLAG with an
// "adoption likely undercounted" callout. A flag is METADATA, never a data
// correction (invariant b / the tracked_user contract): it does not create
// people, does not change any per-user number, and a flagged shared account
// still counts only its resolved identities. The reconciliation UI surfaces
// flags read-only so a human can act (issue per-user keys — §6.3).
//
// Degradation is first-class. The intra-day signals (`hours` histogram,
// `peakConcurrency`) come from `subject_day_signals`; a vendor that cannot
// provide them (Copilot: source_granularity "none") yields null on both, so
// the round-the-clock and concurrency heuristics simply do not fire for that
// subject — we NEVER fabricate an intra-day pattern. Volume-vs-median works
// at daily grain, so it remains the degraded-mode signal.

export type SharedAccountReason =
  | "round_the_clock"
  | "concurrent_usage"
  | "volume_exceeds_team_median";

export type SharedAccountConfidence = "low" | "medium" | "high";

export type SharedAccountFlag = {
  subjectId: string;
  reasons: SharedAccountReason[];
  confidence: SharedAccountConfidence;
  callout: "adoption likely undercounted";
};

export type SharedAccountConfig = {
  /** A single day with ≥ this many distinct active UTC hours reads as
   *  round-the-clock (one human does not work ~this span daily). */
  roundTheClockMinHours: number;
  /** Peak overlapping sessions at/above this imply ≥2 simultaneous people. */
  concurrencyMin: number;
  /** Volume at/above this multiple of the team median is anomalously high. */
  volumeMedianMultiple: number;
  /** Minimum count of baseline (non-strong-signal) subjects required before
   *  the volume heuristic fires — below this the median is meaningless
   *  (e.g. Personal mode = an org of one). */
  minBaselineSize: number;
};

export const DEFAULT_SHARED_ACCOUNT_CONFIG: SharedAccountConfig = {
  roundTheClockMinHours: 16,
  concurrencyMin: 2,
  volumeMedianMultiple: 3,
  minBaselineSize: 3,
};

/** One `subject_day_signals` row (the fields the heuristics read). */
export type SubjectDaySignal = {
  subjectId: string;
  /** 24-slot per-UTC-hour activity histogram; null when the vendor cannot
   *  provide intra-day data (source_granularity "none"). */
  hours: number[] | null;
  peakConcurrency: number | null;
  sourceGranularity: "event" | "1m" | "1h" | "none";
};

/** Median of a numeric list (0 for empty). Robust to a few shared-account
 *  outliers, which is exactly why the spec says median, not mean. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

type SignalAggregate = {
  /** Max distinct active hours in any single day; null if no hours data. */
  maxActiveHoursInDay: number | null;
  /** Max peak concurrency across days; null if the vendor never reported it. */
  maxPeakConcurrency: number | null;
};

function aggregateSignals(
  signals: ReadonlyArray<SubjectDaySignal>,
): Map<string, SignalAggregate> {
  const bySubject = new Map<string, SignalAggregate>();
  for (const s of signals) {
    const agg = bySubject.get(s.subjectId) ?? {
      maxActiveHoursInDay: null,
      maxPeakConcurrency: null,
    };
    if (s.hours) {
      const activeHours = s.hours.reduce((n, h) => (h > 0 ? n + 1 : n), 0);
      agg.maxActiveHoursInDay = Math.max(agg.maxActiveHoursInDay ?? 0, activeHours);
    }
    if (s.peakConcurrency !== null) {
      agg.maxPeakConcurrency = Math.max(
        agg.maxPeakConcurrency ?? 0,
        s.peakConcurrency,
      );
    }
    bySubject.set(s.subjectId, agg);
  }
  return bySubject;
}

/**
 * Flags subjects whose usage pattern implies sharing. `volumeBySubject` is a
 * caller-chosen aggregate magnitude per subject (e.g. summed tokens over the
 * window) — kept out of this function so the honesty-sensitive logic stays
 * decoupled from metric-key semantics. The team median is computed over the
 * provided volumes. Returns one flag per implicated subject, sorted by id;
 * subjects with no triggered reason are simply absent (never a fabricated
 * "not shared" record).
 */
export function detectSharedAccounts(input: {
  signals: ReadonlyArray<SubjectDaySignal>;
  volumeBySubject: ReadonlyMap<string, number>;
  config?: Partial<SharedAccountConfig>;
}): SharedAccountFlag[] {
  const config = { ...DEFAULT_SHARED_ACCOUNT_CONFIG, ...input.config };
  const aggregates = aggregateSignals(input.signals);

  const subjectIds = new Set<string>([
    ...aggregates.keys(),
    ...input.volumeBySubject.keys(),
  ]);

  // Pre-pass: which subjects show a STRONG intra-day signal (round-the-clock
  // or concurrency)? Evaluated up front for two reasons — the volume baseline
  // must exclude them, and each subject reuses the result below.
  const strongSignal = new Map<
    string,
    { roundClock: boolean; concurrent: boolean }
  >();
  for (const subjectId of subjectIds) {
    const agg = aggregates.get(subjectId);
    strongSignal.set(subjectId, {
      roundClock:
        agg?.maxActiveHoursInDay != null &&
        agg.maxActiveHoursInDay >= config.roundTheClockMinHours,
      concurrent:
        agg?.maxPeakConcurrency != null &&
        agg.maxPeakConcurrency >= config.concurrencyMin,
    });
  }

  // The team-median baseline is computed over subjects WITHOUT a strong
  // signal — the "normal single-user" cohort. Including the shared accounts
  // we're hunting would let them inflate the median above their own
  // threshold and hide, exactly when sharing is most prevalent. Volume alone
  // stays advisory (low confidence); the baseline-size guard suppresses it
  // entirely when there aren't enough normal users to define a median (e.g.
  // Personal mode = an org of one). A vendor with no intra-day data (Copilot,
  // source_granularity "none") can't corroborate volume — that residual
  // limitation is inherent to daily-grain and surfaced honestly, not papered.
  const baselineVolumes: number[] = [];
  for (const [subjectId, volume] of input.volumeBySubject) {
    const s = strongSignal.get(subjectId);
    if (!s?.roundClock && !s?.concurrent) baselineVolumes.push(volume);
  }
  const teamMedian = median(baselineVolumes);
  const baselineSufficient = baselineVolumes.length >= config.minBaselineSize;

  const flags: SharedAccountFlag[] = [];
  for (const subjectId of subjectIds) {
    const volume = input.volumeBySubject.get(subjectId) ?? 0;
    const signal = strongSignal.get(subjectId);
    const reasons: SharedAccountReason[] = [];

    // Round-the-clock / concurrency — only when intra-day data exists (both
    // degrade to silence for source_granularity "none", never fabricated).
    if (signal?.roundClock) reasons.push("round_the_clock");
    if (signal?.concurrent) reasons.push("concurrent_usage");

    // Volume ≫ team median — daily-grain, so it is the degraded-mode signal.
    if (
      baselineSufficient &&
      teamMedian > 0 &&
      volume >= teamMedian * config.volumeMedianMultiple
    ) {
      reasons.push("volume_exceeds_team_median");
    }

    if (reasons.length === 0) continue;

    // A simultaneous- or round-the-clock signal is near-proof of sharing;
    // volume alone is only suggestive. Two independent signals → high.
    const strong =
      reasons.includes("concurrent_usage") ||
      reasons.includes("round_the_clock");
    const confidence: SharedAccountConfidence = strong
      ? reasons.length >= 2
        ? "high"
        : "medium"
      : "low";

    flags.push({
      subjectId,
      reasons,
      confidence,
      callout: "adoption likely undercounted",
    });
  }

  return flags.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}
