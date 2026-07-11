// Recent-movement strip (F1.2 / M1): period-over-period deltas for a few raw
// headline quantities the dashboard already reads — reported spend, active
// people, active days — over the last `periodDays` days vs the period before.
// Pure composition over rows the dashboard view already fetched; zero queries.
//
// This is deliberately its OWN period-scoped read rather than a delta bolted
// onto the dashboard's 180-day cumulative totals: a "vs previous period" chip
// on a 180-day running total would be dishonest (the total and the delta would
// span different windows). Everything here is aggregate-only (a spend figure
// and two org-level counts) — no per-person values, so it doesn't change what
// `assertTeamOnlyPseudonymized` inspects.

import {
  adjacentPeriods,
  deriveRawMetricDelta,
  periodRangeLabel,
  type RawMetricDelta,
} from "./raw-metric-delta";
import { resolvePerPersonUsage } from "./usage-distribution";

/** Days in each side of the period-over-period comparison. A 28-day period is
 * a stable 4-week read that smooths weekday/weekend swings; the same constant
 * scopes the M3/M4 distribution modules so the whole "recent" story on the
 * dashboard covers one consistent window. */
export const RECENT_PERIOD_DAYS = 28;

type MetricRow = { subjectId: string; day: string; value: number };
type IdentityLink = { subjectId: string; personId: string };

export type MovementMetricKey = "reported_spend" | "active_people" | "active_days";

export type MovementMetric = {
  key: MovementMetricKey;
  /** How the UI should render the magnitude of this quantity. */
  unit: "cents" | "count";
  current: number;
  delta: RawMetricDelta;
};

export type RecentMovement = {
  periodDays: number;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  metrics: MovementMetric[];
};

function sumInRange(rows: MetricRow[], from: string, to: string): number {
  let total = 0;
  for (const r of rows) if (r.day >= from && r.day <= to) total += r.value;
  return total;
}

function filterRange(rows: MetricRow[], from: string, to: string): MetricRow[] {
  return rows.filter((r) => r.day >= from && r.day <= to);
}

function hasAnyBefore(rows: MetricRow[], day: string): boolean {
  return rows.some((r) => r.day < day);
}

/** Active people + total active-days over one period, identity-resolved. */
function activityTotals(
  activeDayRows: MetricRow[],
  identities: IdentityLink[],
): { activePeople: number; activeDays: number } {
  const usage = resolvePerPersonUsage({
    activeDayRows,
    promptRows: [],
    identities,
  });
  let activePeople = 0;
  let activeDays = 0;
  for (const u of usage) {
    if (u.activeDays > 0) activePeople += 1;
    activeDays += u.activeDays;
  }
  return { activePeople, activeDays };
}

/**
 * Computes the recent-movement strip from the dashboard's pre-fetched
 * `spend_cents` and `active_day` records plus the identity links, over the
 * `periodDays`-day window ending at `to`. Active people/days are resolved the
 * same way M3/M4 resolve them (unresolved subjects excluded). Each metric's
 * `first`/`notComparable` honesty kind flows straight from
 * `deriveRawMetricDelta` — a freshly-connected org with no prior-period data
 * shows "new", never a fabricated jump.
 */
export function computeRecentMovement(args: {
  to: string;
  periodDays?: number;
  spendReportedRecords: MetricRow[];
  activeDayRecords: MetricRow[];
  identities: IdentityLink[];
}): RecentMovement {
  const periodDays = args.periodDays ?? RECENT_PERIOD_DAYS;
  const p = adjacentPeriods(args.to, periodDays);
  const prevLabel = periodRangeLabel(p.previousFrom, p.previousTo);

  // Spend (reported cents).
  const spendCurrent = sumInRange(args.spendReportedRecords, p.currentFrom, p.currentTo);
  const spendPrevious = sumInRange(args.spendReportedRecords, p.previousFrom, p.previousTo);
  const spendMetric: MovementMetric = {
    key: "reported_spend",
    unit: "cents",
    current: spendCurrent,
    delta: deriveRawMetricDelta({
      currentTotal: spendCurrent,
      previousTotal: spendPrevious,
      hasDataBeforeCurrent: hasAnyBefore(args.spendReportedRecords, p.currentFrom),
      previousPeriodLabel: prevLabel,
    }),
  };

  // Active people + active days.
  const currentActivity = activityTotals(
    filterRange(args.activeDayRecords, p.currentFrom, p.currentTo),
    args.identities,
  );
  const previousActivity = activityTotals(
    filterRange(args.activeDayRecords, p.previousFrom, p.previousTo),
    args.identities,
  );
  const activeDayHasBefore = hasAnyBefore(args.activeDayRecords, p.currentFrom);

  const peopleMetric: MovementMetric = {
    key: "active_people",
    unit: "count",
    current: currentActivity.activePeople,
    delta: deriveRawMetricDelta({
      currentTotal: currentActivity.activePeople,
      previousTotal: previousActivity.activePeople,
      hasDataBeforeCurrent: activeDayHasBefore,
      previousPeriodLabel: prevLabel,
    }),
  };
  const daysMetric: MovementMetric = {
    key: "active_days",
    unit: "count",
    current: currentActivity.activeDays,
    delta: deriveRawMetricDelta({
      currentTotal: currentActivity.activeDays,
      previousTotal: previousActivity.activeDays,
      hasDataBeforeCurrent: activeDayHasBefore,
      previousPeriodLabel: prevLabel,
    }),
  };

  return {
    periodDays,
    currentFrom: p.currentFrom,
    currentTo: p.currentTo,
    previousFrom: p.previousFrom,
    previousTo: p.previousTo,
    metrics: [spendMetric, peopleMetric, daysMetric],
  };
}
