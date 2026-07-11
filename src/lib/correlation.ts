// F2.4 "Moved-together" surfaces (research I4) — pure, no React, no I/O.
//
// Answers ONE deliberately-modest question for a few fixed metric pairs: over
// recent complete weeks, how often did the two measures move in the SAME
// direction week-over-week? This is a DIRECTIONAL agreement share, NOT a
// correlation coefficient — no Pearson r, no covariance, no significance test,
// nothing dressed as statistics (the plan's explicit guardrail). It is the
// honest floor of "these seem to move together", and every surface rendering it
// must label it directional and stay rigorously non-causal (see narrative-copy
// CORRELATION_COPY — no "drives"/"because"/"causes").
//
// Honesty rules baked in (invariant b / G4):
//  - A week is only "measured" for a series when it has real rows that week —
//    weeks with no rows are ABSENT, never counted as a 0 (mirrors
//    agentic-adoption / attribution-trend: 0/0 is "no data", not "measured
//    zero"). "Both measured" = the week appears in both series.
//  - Only COMPLETE weeks count (weekStart + 6 ≤ windowTo) — the current partial
//    week is excluded, so a two-day sample can't masquerade as a week's move.
//  - A week-over-week change is only compared between CALENDAR-ADJACENT measured
//    weeks (7 days apart); a gap is never bridged into a fake transition.
//  - A FLAT week on either side (no change) has no direction, so that transition
//    is EXCLUDED from the denominator entirely (documented decision) — "moved
//    the same way" is only counted where both sides actually moved.
//  - Fewer than CORRELATION_MIN_WEEKS overlapping measured weeks, OR zero
//    comparable (non-flat, adjacent) transitions → `insufficient` (the panel
//    shows an honest "not enough overlapping weeks yet", never a fabricated %).
//
// Person-scoped inputs (active people, agentic share) are identity-resolved to
// PERSON-days the same way the rest of the dashboard resolves them — subjects
// with no identity link are excluded, never guessed. Everything returned is
// aggregate-only (percentages + week counts, no subject/person identifier), so
// it does not change what the team-dashboard privacy predicate inspects.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Overlapping complete weeks a pair needs before any agreement % is honest.
 * Six weeks yields up to five week-over-week transitions — enough to say
 * "moved together in N of M" without over-reading a two-point coincidence.
 * Presentation threshold only; not derived from any dataset. */
export const CORRELATION_MIN_WEEKS = 6;

/** Comparable (both-sides-moved, adjacent) transitions a pair needs before the
 * agreement share renders. The week floor alone is not enough (review F4): a
 * series flat in 8 of 9 weeks passes the week count yet yields ONE comparable
 * transition — "moved the same way in 1 of 1 recent weeks" is a coin flip
 * dressed as a pattern. Presentation threshold only. */
export const CORRELATION_MIN_COMPARABLE = 3;

/** Trailing weeks the panel buckets into. Bounds the read to a recent slice
 * (the dashboard already fetches ~180d of rows). */
export const CORRELATION_WINDOW_WEEKS = 16;

/** The fixed metric pairs the panel reports — a closed set (the plan calls for
 * 2–3 fixed pairs, never an open pairwise matrix that would invite fishing for
 * a coincidental match). */
export type CorrelationPairKey =
  | "active_people__spend"
  | "agentic_share__prompts"
  | "active_people__prompts";

export const CORRELATION_PAIRS: readonly CorrelationPairKey[] = [
  "active_people__spend",
  "agentic_share__prompts",
  "active_people__prompts",
];

export type CorrelationResult =
  | {
      kind: "insufficient";
      pair: CorrelationPairKey;
      /** Overlapping complete weeks measured on both sides (< the week floor,
       * or with fewer than CORRELATION_MIN_COMPARABLE comparable transitions). */
      weeks: number;
    }
  | {
      kind: "measured";
      pair: CorrelationPairKey;
      /** Same-direction share of comparable week-over-week transitions, 0–100
       * (integer). DIRECTIONAL, never a correlation coefficient. */
      agreementPct: number;
      /** Transitions where BOTH sides moved (non-flat, adjacent weeks) — the
       * denominator. */
      comparableWeeks: number;
      /** Of those, transitions where both moved the SAME way — the numerator. */
      agreeingWeeks: number;
      /** Overlapping complete weeks measured on both sides. */
      weeks: number;
    };

/** One weekly series: week-start (UTC Monday, YYYY-MM-DD) → value. A week is
 * present ONLY when it had real data — absence means "no data that week", never
 * a measured 0. */
export type WeeklySeries = Map<string, number>;

function round(n: number): number {
  return Math.round(n);
}

function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** UTC Monday (YYYY-MM-DD) of the week containing `day`. */
function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const backToMonday = (d.getUTCDay() + 6) % 7; // Mon→0 … Sun→6
  return addDays(day, -backToMonday);
}

/**
 * Direction-agreement over two weekly series. Walks the overlapping (present in
 * both) complete weeks in chronological order and counts, among CALENDAR-
 * ADJACENT week pairs where BOTH sides moved (non-flat), how many moved the
 * same way.
 *
 * `insufficient` when there are fewer than `CORRELATION_MIN_WEEKS` overlapping
 * measured weeks OR fewer than `CORRELATION_MIN_COMPARABLE` comparable
 * transitions survive (e.g. mostly-flat series) — a share over one or two
 * transitions is a coin flip dressed as a pattern (review F4).
 */
export function computeCorrelation(
  pair: CorrelationPairKey,
  a: WeeklySeries,
  b: WeeklySeries,
): CorrelationResult {
  const common = [...a.keys()].filter((w) => b.has(w)).sort();
  const weeks = common.length;
  let comparable = 0;
  let agreeing = 0;
  for (let i = 1; i < common.length; i++) {
    const prevW = common[i - 1];
    const curW = common[i];
    // Only compare calendar-adjacent measured weeks — never bridge a gap.
    if (addDays(prevW, 7) !== curW) continue;
    const dirA = Math.sign(a.get(curW)! - a.get(prevW)!);
    const dirB = Math.sign(b.get(curW)! - b.get(prevW)!);
    // A flat side has no direction — excluded from the denominator (documented
    // decision: "moved together" is only counted where both actually moved).
    if (dirA === 0 || dirB === 0) continue;
    comparable += 1;
    if (dirA === dirB) agreeing += 1;
  }
  if (weeks < CORRELATION_MIN_WEEKS || comparable < CORRELATION_MIN_COMPARABLE) {
    return { kind: "insufficient", pair, weeks };
  }
  return {
    kind: "measured",
    pair,
    agreementPct: round((agreeing / comparable) * 100),
    comparableWeeks: comparable,
    agreeingWeeks: agreeing,
    weeks,
  };
}

// ─── Series builders (from pre-fetched dashboard rows) ───

type OrgRow = { day: string; value: number };
type SubjectRow = { subjectId: string; day: string; value: number };
type IdentityLink = { subjectId: string; personId: string };

/** True when `weekStart`'s full 7 days are on/before `windowTo` (a complete
 * week). Also bounds the trailing window to `weeks` complete weeks. */
function completeWeekFilter(
  windowTo: string,
  weeks: number,
): (weekStart: string) => boolean {
  const earliestStart = addDays(weekStartUtc(windowTo), -7 * weeks);
  return (weekStart) =>
    addDays(weekStart, 6) <= windowTo && weekStart >= earliestStart;
}

/** Org-level sum per complete week; a week is present only when it had ≥1 row
 * (so a no-data week is absent, never a summed 0). */
function sumByWeek(
  rows: readonly OrgRow[],
  keep: (weekStart: string) => boolean,
): WeeklySeries {
  const out: WeeklySeries = new Map();
  for (const r of rows) {
    const wk = weekStartUtc(r.day);
    if (!keep(wk)) continue;
    out.set(wk, (out.get(wk) ?? 0) + r.value);
  }
  return out;
}

/** Distinct identity-resolved people active per complete week. Rows with a
 * value ≤ 0 or no identity link are excluded (never guessed onto a person). */
function distinctPeopleByWeek(
  rows: readonly SubjectRow[],
  personBySubject: Map<string, string>,
  keep: (weekStart: string) => boolean,
): WeeklySeries {
  const perWeek = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.value <= 0) continue;
    const personId = personBySubject.get(r.subjectId);
    if (personId === undefined) continue;
    const wk = weekStartUtc(r.day);
    if (!keep(wk)) continue;
    let set = perWeek.get(wk);
    if (!set) {
      set = new Set();
      perWeek.set(wk, set);
    }
    set.add(personId);
  }
  const out: WeeklySeries = new Map();
  for (const [wk, set] of perWeek) out.set(wk, set.size);
  return out;
}

/** Person-day set per complete week (`personId|day`), identity-resolved. */
function personDaysByWeek(
  rows: readonly SubjectRow[],
  personBySubject: Map<string, string>,
  keep: (weekStart: string) => boolean,
): Map<string, Set<string>> {
  const perWeek = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.value <= 0) continue;
    const personId = personBySubject.get(r.subjectId);
    if (personId === undefined) continue;
    const wk = weekStartUtc(r.day);
    if (!keep(wk)) continue;
    let set = perWeek.get(wk);
    if (!set) {
      set = new Set();
      perWeek.set(wk, set);
    }
    set.add(`${personId}|${r.day}`);
  }
  return perWeek;
}

export type CorrelationSeries = {
  activePeople: WeeklySeries;
  spend: WeeklySeries;
  agenticShare: WeeklySeries;
  prompts: WeeklySeries;
};

/**
 * Builds the four weekly series the fixed pairs read, from rows the dashboard
 * already fetched. Agentic share is agentic person-days ÷ active person-days
 * per week (present only when there were active person-days that week — 0/0 is
 * "no data", not "0% agentic"). Everything is identity-resolved and
 * aggregate-only.
 */
export function buildCorrelationSeries(input: {
  windowTo: string;
  weeks?: number;
  spendReportedRows: readonly OrgRow[];
  activeDayRows: readonly SubjectRow[];
  agentActiveRows: readonly SubjectRow[];
  promptRows: readonly OrgRow[];
  identities: readonly IdentityLink[];
}): CorrelationSeries {
  const weeks = input.weeks ?? CORRELATION_WINDOW_WEEKS;
  const keep = completeWeekFilter(input.windowTo, weeks);
  const personBySubject = new Map<string, string>();
  for (const link of input.identities) {
    personBySubject.set(link.subjectId, link.personId);
  }

  const activePeople = distinctPeopleByWeek(
    input.activeDayRows,
    personBySubject,
    keep,
  );
  const spend = sumByWeek(input.spendReportedRows, keep);
  const prompts = sumByWeek(input.promptRows, keep);

  const activeDaysByWeek = personDaysByWeek(
    input.activeDayRows,
    personBySubject,
    keep,
  );
  const agenticDaysByWeek = personDaysByWeek(
    input.agentActiveRows,
    personBySubject,
    keep,
  );
  const agenticShare: WeeklySeries = new Map();
  for (const [wk, active] of activeDaysByWeek) {
    // Denominator: the union of active and agentic person-days (an agentic day
    // is an active day by definition, but a vendor may not co-emit the active
    // flag — same union rule as computeAgenticAdoption).
    const union = new Set(active);
    const agentic = agenticDaysByWeek.get(wk);
    if (agentic) for (const k of agentic) union.add(k);
    if (union.size === 0) continue; // no active person-days → absent, not 0%
    const agenticCount = agentic ? [...agentic].filter((k) => union.has(k)).length : 0;
    agenticShare.set(wk, round((agenticCount / union.size) * 100));
  }

  return { activePeople, spend, agenticShare, prompts };
}

/**
 * The full "moved together" panel: the fixed pairs, each resolved to
 * `measured` or `insufficient`. Pure over pre-fetched rows — zero DB reads.
 */
export function computeCorrelationPanel(input: {
  windowTo: string;
  weeks?: number;
  spendReportedRows: readonly OrgRow[];
  activeDayRows: readonly SubjectRow[];
  agentActiveRows: readonly SubjectRow[];
  promptRows: readonly OrgRow[];
  identities: readonly IdentityLink[];
}): CorrelationResult[] {
  const s = buildCorrelationSeries(input);
  const seriesFor: Record<CorrelationPairKey, [WeeklySeries, WeeklySeries]> = {
    active_people__spend: [s.activePeople, s.spend],
    agentic_share__prompts: [s.agenticShare, s.prompts],
    active_people__prompts: [s.activePeople, s.prompts],
  };
  return CORRELATION_PAIRS.map((pair) =>
    computeCorrelation(pair, ...seriesFor[pair]),
  );
}
