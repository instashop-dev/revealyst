import type { PeriodGrain } from "../contracts/scores";

// Period math for the scoring engine. All arithmetic is UTC calendar days
// (the metric_records grain) — no timezones, no clock reads; callers pass
// the anchor day explicitly so evaluation stays deterministic.

export type Period = {
  /** Inclusive UTC calendar day, YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive UTC calendar day, YYYY-MM-DD. */
  periodEnd: string;
  periodGrain: PeriodGrain;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day: string): Date {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid UTC calendar day: '${day}'`);
  }
  return parsed;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The period of `grain` containing (or ending at, for rolling) `anchorDay`. */
export function periodFor(grain: PeriodGrain, anchorDay: string): Period {
  const anchor = parseDay(anchorDay);
  switch (grain) {
    case "month": {
      const start = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
      );
      const end = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
      );
      return {
        periodStart: formatDay(start),
        periodEnd: formatDay(end),
        periodGrain: "month",
      };
    }
    case "week": {
      // ISO week: Monday through Sunday.
      const isoDow = (anchor.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
      const start = new Date(anchor.getTime() - isoDow * DAY_MS);
      const end = new Date(start.getTime() + 6 * DAY_MS);
      return {
        periodStart: formatDay(start),
        periodEnd: formatDay(end),
        periodGrain: "week",
      };
    }
    case "rolling_28d": {
      const start = new Date(anchor.getTime() - 27 * DAY_MS);
      return {
        periodStart: formatDay(start),
        periodEnd: anchorDay,
        periodGrain: "rolling_28d",
      };
    }
  }
}

/** Inclusive day count — the `avg_per_day` denominator (Σ value / days in period). */
export function daysInPeriod(period: Period): number {
  const start = parseDay(period.periodStart).getTime();
  const end = parseDay(period.periodEnd).getTime();
  if (end < start) {
    throw new Error(
      `period end ${period.periodEnd} precedes start ${period.periodStart}`,
    );
  }
  return Math.round((end - start) / DAY_MS) + 1;
}

/** The UTC day before `day` — the nightly recompute anchor. */
export function previousDay(day: string): string {
  return formatDay(new Date(parseDay(day).getTime() - DAY_MS));
}
