import {
  ATTRIBUTION_LEVELS,
  type AttributionLevel,
} from "../contracts/attribution";

// F1.7 "Honesty-gap trend" — the honesty machinery made into visible progress:
// what share of tracked usage the vendors attribute to a SPECIFIC individual,
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
// UTC calendar day). The headline `currentPct` = person-attributed usage-days ÷
// all usage-days IN THE LATEST WEEK of usage — the same weekly basis every
// trend point and the "up from" delta use, so the headline can never read
// against a different denominator than the delta it sits next to. The
// multi-week aggregate is returned separately (`windowPct`, `personDays`,
// `totalDays`, `byLevel`) as explicitly labeled secondary context.
//
// Attribution is the frozen ladder (person > key_project > account,
// src/contracts/attribution.ts). "person" means the VENDOR reported the row at
// per-individual granularity (assigned at ingest by the connector) — it does
// NOT mean that individual has been identity-resolved to a tracked person in
// /reconcile. Copy on any surface rendering this must say "person-attributed" /
// "attributed by the vendor to a specific individual", never
// "identity-resolved" (invariant b — that would overclaim what the numerator
// measures).

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
 *
 * Both endpoints are WEEKLY shares — the same basis as the headline
 * `currentPct` — so "N%, up from M%" always compares like with like. No
 * relative "N weeks ago" figure is carried: measured against the last usage
 * week it lies whenever a connector is stale (usage stops, "weeks ago" stays
 * frozen), and measured against today it drifts the moment the card is cached
 * — callers render the absolute `previousWeekStart` date instead.
 */
export type AttributionCoverageDelta =
  | {
      kind: "delta";
      /** Most-recent displayed week's pct (identical to the headline). */
      currentPct: number;
      /** Earliest displayed week's pct — the "up from" figure. */
      previousPct: number;
      /** currentPct − previousPct, signed, 1 d.p. */
      deltaPct: number;
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
      /** HEADLINE: person-attributed share of the LATEST displayed week's
       * usage-days, 0–100 (1 d.p.). Same weekly basis as `trend` points and
       * `delta` endpoints — equal to `trend[trend.length - 1].pct` by
       * construction. */
      currentPct: number;
      /** Monday (UTC) of the week `currentPct` measures. */
      currentWeekStart: string;
      /** SECONDARY context: person-attributed share across ALL displayed
       * weeks' usage-days, 0–100 (1 d.p.). Equal to `byLevel.person.pct` by
       * construction. Renderers must label this as the multi-week aggregate
       * — never present it as "current". */
      windowPct: number;
      /** Aggregate usage-day counts across all displayed weeks. */
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

type WeekBucket = {
  total: number;
  person: number;
  byLevel: Record<AttributionLevel, number>;
};

/**
 * Attribution-coverage trend over pre-fetched usage-day rows (recommend
 * `active_day` metric_records). Buckets usage-days into UTC ISO weeks, keeps
 * the most recent `weeks` weeks that actually have usage, and reports the
 * person-attributed share of the latest week (headline) + per week + the
 * window aggregate and ladder breakdown (secondary context).
 *
 * Honesty rules baked in:
 *  - No usage rows at all → `{ kind: "empty" }` (the card shows an honest
 *    empty state — why it's empty + what fills it, never a teaser number).
 *  - A single measured week → `delta: { kind: "first" }` (no "up from" claim).
 *  - Weeks with zero usage-days are simply absent, never plotted as 0% (0/0 is
 *    "no data", not "0% person-attributed").
 *  - Headline and delta endpoints are all weekly shares — one shared-key burst
 *    in a middle week can depress the window aggregate, but it can never make
 *    the headline contradict the "up from" endpoints (they are the same
 *    series).
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

  // Window aggregate + byLevel over the SAME displayed weeks — secondary
  // context only; the headline is the latest week's share (below).
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

  const latest = trend[trend.length - 1];

  let delta: AttributionCoverageDelta;
  if (trend.length < 2) {
    delta = { kind: "first" };
  } else {
    const first = trend[0];
    delta = {
      kind: "delta",
      currentPct: latest.pct,
      previousPct: first.pct,
      deltaPct: round1(latest.pct - first.pct),
      previousWeekStart: first.weekStart,
    };
  }

  return {
    kind: "measured",
    currentPct: latest.pct,
    currentWeekStart: latest.weekStart,
    windowPct: pctOf(personDays, totalDays),
    personDays,
    totalDays,
    byLevel,
    trend,
    delta,
  };
}
