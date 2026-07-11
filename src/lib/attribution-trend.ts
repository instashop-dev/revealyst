import {
  ATTRIBUTION_LEVELS,
  type AttributionLevel,
} from "../contracts/attribution";

// F1.7 "Honesty-gap trend" — the honesty machinery made into visible progress:
// what share of tracked usage Revealyst can honestly tie to a SPECIFIC person,
// over time. This is a MEASURED number (G2's confidence tier): every usage-day
// below is a real, stored `active_day` metric_records row carrying the vendor's
// honest attribution level — nothing is inferred, derived, or directional.
//
// Pure lib, no React and no I/O: it runs over metric rows the dashboard view
// already fetched (src/lib/dashboard-view.ts), so it adds ZERO new DB reads and
// never widens a query window. Aggregate-only — it reads `day` + `attribution`
// and never a subject identifier, so nothing it returns can be tied back to a
// person (the team-dashboard privacy predicate is unaffected).
//
// Denominator = usage-days (one `active_day` row = one subject active on one
// UTC calendar day). currentPct = person-attributed usage-days ÷ all
// usage-days. Attribution is the frozen ladder (person > key_project >
// account, src/contracts/attribution.ts); "person" is the only rung that means
// "resolved to a specific individual", so it is the coverage numerator.

/** How many recent ISO weeks of usage the trend surfaces at most. Presentation
 * bound only — keeps the sparkline to a bounded, recent trajectory. Not derived
 * from any dataset. The unpurged `attribution` column can back a far longer
 * history; the card just shows the recent slice. */
export const DEFAULT_TREND_WEEKS = 12;

/** One pre-fetched usage-day row. Only the two aggregate-safe fields are read —
 * a subject id is deliberately NOT in this shape so a coverage number can never
 * be tied back to an individual. `attribution` is validated against the frozen
 * ladder before it counts (the DB enum already guarantees this; the guard keeps
 * the byLevel breakdown summing exactly to the total if an unknown value ever
 * slips through). */
export type UsageDayRow = { day: string; attribution: string };

export type AttributionTrendPoint = {
  /** Monday (UTC) of the ISO week this point aggregates, "YYYY-MM-DD". */
  weekStart: string;
  /** Person-attributed usage-days ÷ all usage-days that week, 0–100 (1 d.p.). */
  pct: number;
  personDays: number;
  totalDays: number;
};

/**
 * The week-over-week movement, narrowed with the same first/delta discipline
 * as `DeltaResult` (src/lib/score-insights.ts): a single measured week has no
 * honest "up from" claim, so it is `{ kind: "first" }`, never a fabricated 0
 * or a comparison against nothing. There is no `notComparable` rung here (as
 * there is for scores) on purpose: attribution coverage is one fixed
 * measurement over the frozen ladder with no grain or definition-version axis,
 * so every week IS comparable to every other — the only two honest states are
 * "one week so far" and "a real delta between two weeks".
 */
export type AttributionCoverageDelta =
  | {
      kind: "delta";
      /** Most-recent displayed week's pct. */
      currentPct: number;
      /** Earliest displayed week's pct — the "up from" figure. */
      previousPct: number;
      /** currentPct − previousPct, signed, 1 d.p. */
      deltaPct: number;
      /** Calendar weeks between the two endpoints. */
      weeksApart: number;
      previousWeekStart: string;
    }
  | { kind: "first" };

export type AttributionByLevel = Record<
  AttributionLevel,
  { days: number; pct: number }
>;

export type AttributionTrend =
  | { kind: "empty" }
  | {
      kind: "measured";
      /** Person-attributed share across all displayed weeks, 0–100 (1 d.p.).
       * Equal to `byLevel.person.pct` by construction. */
      currentPct: number;
      personDays: number;
      totalDays: number;
      /** Per-rung usage-day counts + shares across the displayed weeks; the
       * three `days` sum to `totalDays` and the three `pct` sum to ~100. */
      byLevel: AttributionByLevel;
      /** Chronological weekly points (only weeks with real usage), most recent
       * `weeks` of them. */
      trend: AttributionTrendPoint[];
      delta: AttributionCoverageDelta;
    };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pctOf(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round1((numerator / denominator) * 100);
}

/** The Monday (UTC) of the ISO week containing `day` ("YYYY-MM-DD"). Bucketing
 * is UTC-only so a viewer's local timezone can never shift a usage-day into a
 * neighboring week (the underlying `active_day` rows are already UTC calendar
 * days). */
function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const deltaToMonday = (dow + 6) % 7; // Mon→0 … Sun→6
  d.setUTCDate(d.getUTCDate() - deltaToMonday);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(fromWeekStart: string, toWeekStart: string): number {
  const ms =
    new Date(`${toWeekStart}T00:00:00.000Z`).getTime() -
    new Date(`${fromWeekStart}T00:00:00.000Z`).getTime();
  return Math.round(ms / WEEK_MS);
}

type WeekBucket = {
  total: number;
  person: number;
  byLevel: Record<AttributionLevel, number>;
};

/**
 * Attribution-coverage trend over pre-fetched usage-day rows (recommend
 * `active_day` metric_records). Buckets usage-days into UTC ISO weeks, keeps
 * the most recent `weeks` weeks that actually have usage, and reports the
 * person-attributed share overall + per week + the ladder breakdown.
 *
 * Honesty rules baked in:
 *  - No usage rows at all → `{ kind: "empty" }` (the card shows an honest
 *    empty state — why it's empty + what fills it, never a teaser number).
 *  - A single measured week → `delta: { kind: "first" }` (no "up from" claim).
 *  - Weeks with zero usage-days are simply absent, never plotted as 0% (0/0 is
 *    "no data", not "0% person-attributed").
 */
export function computeAttributionTrend(
  rows: readonly UsageDayRow[],
  options?: { weeks?: number },
): AttributionTrend {
  const maxWeeks = options?.weeks ?? DEFAULT_TREND_WEEKS;
  const known = new Set<string>(ATTRIBUTION_LEVELS);
  const weekMap = new Map<string, WeekBucket>();

  for (const row of rows) {
    if (!known.has(row.attribution)) continue;
    const level = row.attribution as AttributionLevel;
    const wk = weekStartUtc(row.day);
    let bucket = weekMap.get(wk);
    if (!bucket) {
      bucket = {
        total: 0,
        person: 0,
        byLevel: { person: 0, key_project: 0, account: 0 },
      };
      weekMap.set(wk, bucket);
    }
    bucket.total += 1;
    bucket.byLevel[level] += 1;
    if (level === "person") bucket.person += 1;
  }

  if (weekMap.size === 0) {
    return { kind: "empty" };
  }

  // Most recent `maxWeeks` weeks that have usage, chronological.
  const weeks = [...weekMap.keys()].sort().slice(-maxWeeks);

  const trend: AttributionTrendPoint[] = weeks.map((wk) => {
    const b = weekMap.get(wk)!;
    return {
      weekStart: wk,
      personDays: b.person,
      totalDays: b.total,
      pct: pctOf(b.person, b.total),
    };
  });

  // Headline currentPct + byLevel aggregate over the SAME displayed weeks, so
  // the big number and the trend can never tell different stories about the
  // same span.
  let totalDays = 0;
  let personDays = 0;
  const levelDays: Record<AttributionLevel, number> = {
    person: 0,
    key_project: 0,
    account: 0,
  };
  for (const wk of weeks) {
    const b = weekMap.get(wk)!;
    totalDays += b.total;
    personDays += b.person;
    for (const level of ATTRIBUTION_LEVELS) {
      levelDays[level] += b.byLevel[level];
    }
  }

  const byLevel = {} as AttributionByLevel;
  for (const level of ATTRIBUTION_LEVELS) {
    byLevel[level] = {
      days: levelDays[level],
      pct: pctOf(levelDays[level], totalDays),
    };
  }

  let delta: AttributionCoverageDelta;
  if (trend.length < 2) {
    delta = { kind: "first" };
  } else {
    const first = trend[0];
    const last = trend[trend.length - 1];
    delta = {
      kind: "delta",
      currentPct: last.pct,
      previousPct: first.pct,
      deltaPct: round1(last.pct - first.pct),
      weeksApart: weeksBetween(first.weekStart, last.weekStart),
      previousWeekStart: first.weekStart,
    };
  }

  return {
    kind: "measured",
    currentPct: pctOf(personDays, totalDays),
    personDays,
    totalDays,
    byLevel,
    trend,
    delta,
  };
}
