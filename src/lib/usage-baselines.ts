import { addUtcDays } from "./raw-metric-delta";

// F2.3 / research M8 — retention & consistency curves. Pure derivation over
// `active_day` metric_records the dashboard view already fetched, identity-
// resolved in JS from `identities.all()` — NEVER from person-level score rows
// (Team orgs don't have them). No React, no I/O.
//
// Three curves over one window:
//   • weeklyActive   — distinct active PEOPLE per week + person-days (retention).
//   • cadence        — per-person active-day counts over the window (how
//                      consistently each person shows up).
//   • activation     — new-user activation curve: people bucketed by the week
//                      of their FIRST seen active day (earliest metric day).
//
// Aggregate-only by construction (§7 team-surface rule): every output is a
// count, a week bucket, or an org-relative summary stat — there are NO person
// ids, pseudonyms, names, or per-named-person values anywhere in these types,
// so nothing here can become a leaderboard and nothing changes what
// `assertTeamOnlyPseudonymized` must inspect.
//
// Honesty rules (invariant b / G4), mirrored from usage-distribution.ts:
//  - Subjects with NO identity link are EXCLUDED from all per-person math
//    (never guessed into a person) and tallied as `unresolvedSubjects`.
//  - Subjects linked to MORE THAN ONE person (shared accounts) are ALSO
//    excluded — copying a shared account's days to each linked person would
//    fabricate per-person cadence.
//  - A week with NO resolved active person-days is omitted from `weeklyActive`
//    (a chart must not plot 0 when the honest story might be "not syncing").
//    `materializeMeasuredZeroWeeks` fills those weeks in as MEASURED zeros for
//    the plateau detector, which gates on channel freshness FIRST — see its
//    doc comment for why that makes the zeros measured, not missing.
//  - Weeks the window only PARTIALLY covers are `complete: false`, so
//    consumers drop them: the current week (a Tuesday's two-day sample is not
//    a full week's cohort) AND the leading week when the window starts
//    mid-week (its sliced-off days would undercount it — review F4).
//  - Fewer than MIN_PEOPLE_FOR_BASELINE resolved people → the honest
//    "insufficient" kinds, never a two-person "curve".
//  - The activation curve's first-seen day is the earliest day WITHIN THE
//    FETCHED ROWS (see the HORIZON NOTE on `computeUsageBaselines`) — a person
//    whose real first day predates the fetched horizon reads as "new" in the
//    first in-window week; the caller's window is far wider than the plateau
//    detector needs, so this fails toward over-counting the oldest bucket, not
//    toward fabricating a recent activation spike.

/** Below this many resolved active people, curves are not shown — too few
 * points for a weekly cohort or a cadence distribution to mean anything, and
 * small groups risk de-anonymizing individuals. Matches
 * MIN_PEOPLE_FOR_DISTRIBUTION (usage-distribution.ts) so the whole F1.2/F2.3
 * per-person story shares one floor. */
export const MIN_PEOPLE_FOR_BASELINE = 4;

/** Default headline span: 12 whole weeks of history. Callers may pass wider
 * rows (the dashboard fetches 180d); anything older than `weeks*7` days ending
 * at `windowTo` is sliced off so every curve measures the window the copy
 * states. */
export const BASELINE_WINDOW_WEEKS = 12;

type MetricRow = { subjectId: string; day: string; value: number };
type IdentityLink = { subjectId: string; personId: string };

/** UTC Monday (`YYYY-MM-DD`) of the week containing `day`. Monday-anchored so a
 * bucket reads as a work week — shared idiom with agentic-adoption.ts. */
export function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return addUtcDays(day, -backToMonday);
}

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Jun 2–8" for the inclusive span `start`..`end` (both `YYYY-MM-DD`). */
export function weekSpanLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const endTxt = endDate.toLocaleDateString("en-US", {
    month: startDate.getUTCMonth() === endDate.getUTCMonth() ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${fmtDay(start)}–${endTxt}`;
}

/** One week bucket of the retention curve. `activePeople` is DISTINCT resolved
 * people with ≥1 active day that week; `activePersonDays` is distinct
 * (person, day) pairs — both aggregate counts, never a named person. */
export type WeeklyActivePoint = {
  /** UTC Monday of the week, `YYYY-MM-DD`. */
  weekStart: string;
  /** Human label for the covered span, e.g. "Jun 2–8" (its REAL span for a
   * partially-covered week, never the full week range). */
  label: string;
  activePeople: number;
  activePersonDays: number;
  /** False for a week the window only PARTIALLY covers — either the week
   * containing `windowTo` when its Sunday is after `windowTo` (the current,
   * still-accumulating week), or the LEADING week containing `windowFrom`
   * when `windowFrom` isn't its Monday: its early days were sliced off with
   * the window, so its counts UNDERCOUNT the real week. Treating that
   * truncated leading bucket as complete fabricated a "rise into the peak"
   * for the plateau detector on any non-Monday request date (review F4). */
  complete: boolean;
};

/** Per-person active-day cadence over the window — a descriptive summary of the
 * org's OWN spread, not a calibrated cutoff. */
export type CadenceSummary =
  | { available: false; resolvedPeople: number; windowDays: number }
  | {
      available: true;
      resolvedPeople: number;
      windowDays: number;
      /** Median / p90 active-day count across resolved people. */
      medianActiveDays: number;
      p90ActiveDays: number;
      maxActiveDays: number;
      /** Mean active days per resolved active person. */
      meanActiveDays: number;
    };

export type ActivationPoint = {
  /** UTC Monday of the first-seen week. */
  weekStart: string;
  label: string;
  /** People whose earliest active day (within the fetched rows) fell in this
   * week. */
  newPeople: number;
};

export type UsageBaselines = {
  windowFrom: string;
  windowTo: string;
  /** Distinct resolved people active anywhere in the window. */
  resolvedPeople: number;
  /** Distinct in-window subjects with NO identity link — excluded from every
   * per-person count, disclosed so a surface can say so. */
  unresolvedSubjects: number;
  /** Chronological weekly retention buckets (weeks with zero resolved activity
   * omitted here — `materializeMeasuredZeroWeeks` fills them in for the
   * plateau detector, whose staleness gate makes those zeros measured). The
   * first/last points may be partially-covered weeks (`complete: false`).
   * Empty when fewer than {@link MIN_PEOPLE_FOR_BASELINE} people. */
  weeklyActive: WeeklyActivePoint[];
  cadence: CadenceSummary;
  /** New-person activation curve, chronological. Empty when insufficient. */
  activation: ActivationPoint[];
};

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes the retention/consistency/activation curves from pre-fetched
 * `active_day` rows plus the org's identity links, over the last
 * `weeks` whole weeks ending at `windowTo`.
 *
 * HORIZON NOTE: "first seen" is the earliest day among the ROWS PASSED IN (the
 * caller's fetched window). A person whose real first active day predates that
 * horizon reads as activating in the first in-window week. The dashboard's
 * 180-day horizon is far wider than the 12-week curve, so this only inflates
 * the OLDEST activation bucket, never fabricates a recent activation spike.
 */
export function computeUsageBaselines(input: {
  activeDayRows: readonly MetricRow[];
  identityLinks: readonly IdentityLink[];
  /** Inclusive window end (`YYYY-MM-DD`, UTC) — "today" for the dashboard. */
  windowTo: string;
  weeks?: number;
}): UsageBaselines {
  const weeks = input.weeks ?? BASELINE_WINDOW_WEEKS;
  const from = addUtcDays(input.windowTo, -(weeks * 7 - 1));
  const windowTo = input.windowTo;

  const subjectToPeople = new Map<string, string[]>();
  for (const link of input.identityLinks) {
    const list = subjectToPeople.get(link.subjectId);
    if (list) list.push(link.personId);
    else subjectToPeople.set(link.subjectId, [link.personId]);
  }
  const unresolvedSubjects = new Set<string>();
  const exclusiveOwner = (subjectId: string): string | null => {
    const people = subjectToPeople.get(subjectId);
    if (!people) {
      unresolvedSubjects.add(subjectId);
      return null;
    }
    if (people.length > 1) return null; // shared — excluded, not tallied here
    return people[0];
  };

  // person -> set of active days (in window); person -> earliest active day.
  const daysByPerson = new Map<string, Set<string>>();
  const firstSeenByPerson = new Map<string, string>();
  for (const row of input.activeDayRows) {
    if (row.value <= 0) continue;
    if (row.day < from || row.day > windowTo) continue;
    const personId = exclusiveOwner(row.subjectId);
    if (personId === null) continue;
    let set = daysByPerson.get(personId);
    if (!set) {
      set = new Set();
      daysByPerson.set(personId, set);
    }
    set.add(row.day);
    const prevFirst = firstSeenByPerson.get(personId);
    if (prevFirst === undefined || row.day < prevFirst) {
      firstSeenByPerson.set(personId, row.day);
    }
  }

  const resolvedPeople = daysByPerson.size;
  const base = {
    windowFrom: from,
    windowTo,
    resolvedPeople,
    unresolvedSubjects: unresolvedSubjects.size,
  };
  if (resolvedPeople < MIN_PEOPLE_FOR_BASELINE) {
    return {
      ...base,
      weeklyActive: [],
      cadence: { available: false, resolvedPeople, windowDays: weeks * 7 },
      activation: [],
    };
  }

  // ── Weekly retention buckets over person-days. ──
  const weekBuckets = new Map<
    string,
    { people: Set<string>; personDays: Set<string> }
  >();
  const bucket = (weekStart: string) => {
    let w = weekBuckets.get(weekStart);
    if (!w) {
      w = { people: new Set(), personDays: new Set() };
      weekBuckets.set(weekStart, w);
    }
    return w;
  };
  for (const [personId, days] of daysByPerson) {
    for (const day of days) {
      const w = bucket(weekStartUtc(day));
      w.people.add(personId);
      w.personDays.add(`${personId}|${day}`);
    }
  }
  const currentWeekStart = weekStartUtc(windowTo);
  const currentWeekComplete = addUtcDays(currentWeekStart, 6) <= windowTo;
  const weeklyActive: WeeklyActivePoint[] = [...weekBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => {
      const isCurrent = weekStart === currentWeekStart;
      // Truncated at the FRONT: the window starts mid-week, so this bucket
      // only saw the week's tail (review F4 — an undercounted leading week
      // must not read as a real, complete low week).
      const isTruncatedLeading = weekStart < from;
      const complete = (!isCurrent || currentWeekComplete) && !isTruncatedLeading;
      const startDay = isTruncatedLeading ? from : weekStart;
      const endDay =
        isCurrent && !currentWeekComplete ? windowTo : addUtcDays(weekStart, 6);
      return {
        weekStart,
        label: weekSpanLabel(startDay, endDay),
        activePeople: w.people.size,
        activePersonDays: w.personDays.size,
        complete,
      };
    });

  // ── Per-person cadence. ──
  const perPersonDays = [...daysByPerson.values()].map((s) => s.size);
  const cadence: CadenceSummary = {
    available: true,
    resolvedPeople,
    windowDays: weeks * 7,
    medianActiveDays: percentile(perPersonDays, 50),
    p90ActiveDays: percentile(perPersonDays, 90),
    maxActiveDays: Math.max(...perPersonDays),
    meanActiveDays: round2(
      perPersonDays.reduce((a, b) => a + b, 0) / perPersonDays.length,
    ),
  };

  // ── Activation curve: first-seen week -> new-person count. ──
  const newByWeek = new Map<string, number>();
  for (const firstDay of firstSeenByPerson.values()) {
    const wk = weekStartUtc(firstDay);
    newByWeek.set(wk, (newByWeek.get(wk) ?? 0) + 1);
  }
  const activation: ActivationPoint[] = [...newByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, newPeople]) => ({
      weekStart,
      label: weekSpanLabel(weekStart, addUtcDays(weekStart, 6)),
      newPeople,
    }));

  return { ...base, weeklyActive, cadence, activation };
}

/** The COMPLETE weekly retention points only (drops the partial current week
 * AND the truncated leading week) — weeks with data, no zeros materialized. */
export function completeWeeklyActive(
  baselines: Pick<UsageBaselines, "weeklyActive">,
): WeeklyActivePoint[] {
  return baselines.weeklyActive.filter((w) => w.complete);
}

/**
 * The plateau detector's input series (review F1): every FULLY-COVERED
 * calendar week from the first complete week with resolved activity through
 * the last complete week before `windowTo`, with activity-less weeks
 * materialized as MEASURED ZEROS. `weeklyActive` itself keeps the omission
 * (a chart shouldn't plot weeks as 0 when the honest story might be "not
 * syncing") — but the plateau detector gates on `connections.lastSuccessAt`
 * staleness BEFORE reading this series, and under a fresh, successfully-
 * syncing channel a calendar week in which no resolved person had an active
 * day IS a measured "zero people active", not missing data. Without the
 * zeros, a total collapse (everyone quitting) produced NO weekly points and
 * the plateau detector saw nothing — the exact scenario an early-warning
 * system exists for.
 *
 * Leading zero weeks (before the org's first resolved activity) are NOT
 * materialized: before adoption started, "zero people" conflates "not using
 * AI yet" with "stopped using AI" — and a fabricated 0→N ramp would
 * manufacture the rise-into-peak the detector requires. Trailing and interior
 * gaps are the measured zeros.
 */
export function materializeMeasuredZeroWeeks(
  baselines: Pick<UsageBaselines, "weeklyActive" | "windowTo">,
): WeeklyActivePoint[] {
  const complete = completeWeeklyActive(baselines);
  if (complete.length === 0) return [];
  const byStart = new Map(complete.map((w) => [w.weekStart, w]));
  const firstWeek = complete[0].weekStart;
  const currentWeekStart = weekStartUtc(baselines.windowTo);
  const lastCompleteWeek =
    addUtcDays(currentWeekStart, 6) <= baselines.windowTo
      ? currentWeekStart
      : addUtcDays(currentWeekStart, -7);
  if (lastCompleteWeek < firstWeek) return complete;
  const out: WeeklyActivePoint[] = [];
  for (
    let weekStart = firstWeek;
    weekStart <= lastCompleteWeek;
    weekStart = addUtcDays(weekStart, 7)
  ) {
    out.push(
      byStart.get(weekStart) ?? {
        weekStart,
        label: weekSpanLabel(weekStart, addUtcDays(weekStart, 6)),
        activePeople: 0,
        activePersonDays: 0,
        complete: true,
      },
    );
  }
  return out;
}
