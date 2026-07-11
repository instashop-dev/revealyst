// Period-over-period deltas for RAW metric quantities (F1.2 / M1) — spend,
// active people, active days. This is the raw-metric sibling of
// score-insights.ts's `deriveDelta`/`DeltaResult`: it reuses the SAME kind
// idiom (`delta` / `first` / `notComparable`) so the two never tell a
// different honesty story, but adds what raw counts need that scores don't —
// a percent change (null when there's no positive baseline to divide by,
// never a fabricated "+∞%" or "+0%") and a `noData` reason for a period pair
// with nothing on either side. No React, no I/O.
//
// Honesty rules (invariant b), mirrored from the score delta:
//  - No data BEFORE the current period → there is no baseline to compare
//    against. A period showing new activity is `first` (render "new", never a
//    +100% jump from an invented 0); a period pair with nothing at all is
//    `notComparable { reason: "noData" }` (render no chip).
//  - A measured 0 in the previous period (the org HAD data earlier) is a real
//    comparison: the delta is shown, but the percent is omitted (`pctChange:
//    null`) because a change from 0 has no honest percentage.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Two adjacent equal-length day windows ending at `to` (inclusive). The
 * current period is the last `periodDays` days; the previous period is the
 * `periodDays` days immediately before it. All bounds are UTC YYYY-MM-DD. */
export type AdjacentPeriods = {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar-day arithmetic on YYYY-MM-DD strings. Exported so window
 * anchors (e.g. "the last COMPLETE day = today − 1") share one definition
 * across the analytics modules instead of re-implementing date math. */
export function addUtcDays(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + delta * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Splits the day range ending at `to` into the two adjacent equal windows a
 * period-over-period delta compares. `periodDays` is the length of each side
 * (e.g. 28 for a rolling-4-week read). `currentFrom` = to − (periodDays − 1),
 * so the current window is exactly `periodDays` calendar days INCLUSIVE of
 * `to`; the previous window is the `periodDays` days directly before it.
 */
export function adjacentPeriods(to: string, periodDays: number): AdjacentPeriods {
  const currentFrom = addUtcDays(to, -(periodDays - 1));
  const previousTo = addUtcDays(currentFrom, -1);
  const previousFrom = addUtcDays(previousTo, -(periodDays - 1));
  return { currentFrom, currentTo: to, previousFrom, previousTo };
}

/** Short "Jun 3–30" label for a window (UTC), reused in delta screen-reader
 * copy so the previous period is always named, never "the prior period". */
export function periodRangeLabel(from: string, to: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`;
}

export type RawMetricDelta =
  | {
      kind: "delta";
      current: number;
      previous: number;
      delta: number;
      /** Percent change vs the previous period, or null when the previous
       * period was 0 (a change from nothing has no honest percentage). */
      pctChange: number | null;
      previousPeriodLabel: string;
    }
  /** Activity this period, but no data before it to compare against. */
  | { kind: "first"; current: number }
  /** Nothing on either side of the comparison. */
  | { kind: "notComparable"; reason: "noData" };

/**
 * Derives a raw-metric period-over-period delta from two already-summed
 * period totals plus one honesty fact: whether the org had ANY data of this
 * metric BEFORE the current period. That flag is what separates a real
 * measured-0 previous period (show the delta) from "the previous window
 * predates any data we have" (`first` — no baseline).
 */
export function deriveRawMetricDelta(input: {
  currentTotal: number;
  previousTotal: number;
  /** True iff at least one row of this metric exists dated before the current
   * period's first day — i.e. the previous period is a real baseline, not a
   * pre-history void. */
  hasDataBeforeCurrent: boolean;
  previousPeriodLabel: string;
}): RawMetricDelta {
  const { currentTotal, previousTotal, hasDataBeforeCurrent, previousPeriodLabel } = input;
  if (!hasDataBeforeCurrent) {
    if (currentTotal > 0) return { kind: "first", current: currentTotal };
    return { kind: "notComparable", reason: "noData" };
  }
  const delta = round2(currentTotal - previousTotal);
  return {
    kind: "delta",
    current: currentTotal,
    previous: previousTotal,
    delta,
    pctChange: previousTotal > 0 ? round2((delta / previousTotal) * 100) : null,
    previousPeriodLabel,
  };
}

export type FormattedRawDelta = {
  /** Signed magnitude for display, e.g. "+3" or "-1"; "no change" at 0. */
  text: string;
  /** Signed percent, e.g. "+12%", or null when there's no honest percentage
   * (previous period was 0). Callers show the magnitude alone in that case. */
  pctText: string | null;
  direction: "up" | "down" | "none";
  srText: string;
};

/**
 * Formats an already-narrowed `{ kind: "delta" }` raw-metric result. `unit`
 * is the noun for the screen-reader sentence ("active people", "active days");
 * `formatValue` renders the magnitude (defaults to an integer). A round-to-
 * zero delta is direction "none"/"no change" — never a "+0" claiming a change
 * that didn't happen (same rule as score `formatDelta`).
 */
export function formatRawMetricDelta(
  delta: Extract<RawMetricDelta, { kind: "delta" }>,
  unit: string,
  formatValue: (n: number) => string = (n) => `${Math.round(n)}`,
): FormattedRawDelta {
  const rounded = round2(delta.delta);
  const direction: FormattedRawDelta["direction"] =
    rounded > 0 ? "up" : rounded < 0 ? "down" : "none";
  const text =
    direction === "none"
      ? "no change"
      : `${rounded > 0 ? "+" : "-"}${formatValue(Math.abs(rounded))}`;
  const pctText =
    delta.pctChange === null || direction === "none"
      ? null
      : `${delta.pctChange > 0 ? "+" : ""}${Math.round(delta.pctChange)}%`;
  const srText =
    direction === "none"
      ? `No change in ${unit} versus the previous period (${delta.previousPeriodLabel}).`
      : `${unit} ${direction === "up" ? "rose" : "fell"} versus the previous period (${delta.previousPeriodLabel}).`;
  return { text, pctText, direction, srText };
}
