import type { DeltaResult } from "./score-insights";

// F1.4 "Agentic adoption rate" (research M6) — pure derivation, no React, no
// I/O. Surfaces the agentic transition: the share of AI-active PERSON-days on
// which an AI agent (not just autocomplete or chat) was used, org-level, with
// a weekly trend. The scored-preset variant is deferred to Phase 4; this is
// display only.
//
// Identity resolution (adversarial-review F1): metric rows arrive keyed by
// SUBJECT (an api key, a vendor account, an email actor …), and one human
// routinely spans several subjects — the Anthropic connector emits the same
// person's same day under an `acct:` usage subject AND an email claude_code
// subject. Counting raw subject-days would dilute that person's 100%-agentic
// day into 50%. So this module resolves subject-days to PERSON-days via the
// org's identity links (the same subject→person mapping readDashboard uses,
// src/lib/dashboard-read.ts) before any counting. Subject-days with NO
// identity link are EXCLUDED from the rate — never guessed onto a person —
// and surfaced as `unresolvedSubjects` so the card can say so (invariant b).
//
// Honesty (G4): a zero-agent-row org is the "no agentic telemetry" state, NOT
// a measured-zero adoption claim — not every connected vendor emits the
// cross-vendor `agent_active` flag (Claude Code / Copilot / Cursor do; OpenAI
// does not). The empty kinds below keep "nothing synced", "nothing linked to
// a person yet", and "synced, but no agent-capable tool" distinct from a real
// measured rate.

/** The minimal metric-record shape this module reads — a structural subset of
 * `metric_records` rows (src/db/schema.ts). `value` is the numeric flag; a
 * subject-day "counts" when value > 0 (the flag metrics are emitted as 1,
 * never zero-filled — absence is absence). `sourceConnector` drives the
 * per-vendor coverage breakdown; it is optional so tests can omit it. */
export type AgenticMetricRow = {
  subjectId: string;
  day: string;
  value: number;
  sourceConnector?: string;
};

/** A subject→person identity link (the `scope.identities.all()` row shape —
 * only the two fields this module needs). */
export type IdentityLinkLike = {
  subjectId: string;
  personId: string;
};

export type AgenticTrendPoint = {
  /** UTC Monday of the week bucket, `YYYY-MM-DD`. */
  weekStart: string;
  /** Human label for the covered span, e.g. "Jun 2–8" ("Jun 8–9" for the
   * partial week-to-date bucket — its real span, never the full week). */
  label: string;
  ratePct: number;
  agenticDays: number;
  activeDays: number;
};

export type VendorAgenticCoverage = {
  /** The `source_connector` module id (e.g. "anthropic-console@1"). */
  sourceConnector: string;
  /** Distinct agentic person-days attributed to this connector. */
  agenticDays: number;
};

export type AgenticAdoption =
  // No identity-resolved activity in the window. `unresolvedSubjects` > 0
  // means usage WAS recorded but none of it is linked to a person yet — the
  // card renders that as its own honest state, not as "no activity".
  | { kind: "noActivity"; unresolvedSubjects: number }
  // Resolved active person-days exist, but no vendor reported ANY agent
  // activity in the window — the honest "no agent-capable telemetry" state,
  // never a measured 0%.
  | { kind: "noAgenticData"; activeDays: number; unresolvedSubjects: number }
  // A real, measured rate.
  | {
      kind: "measured";
      /** 0–100, rounded to two decimals. */
      ratePct: number;
      /** Distinct agentic person-days — the numerator. */
      agenticDays: number;
      /** Distinct AI-active person-days — the denominator (the UNION of
       * person-days with an active flag and person-days with an agent flag:
       * an agentic day IS an active day by definition — see the
       * `computeAgenticAdoption` doc comment). */
      activeDays: number;
      /** Weekly buckets, chronological, COMPLETE weeks only (a week is
       * complete when its Sunday is ≤ the window end). Weeks with no active
       * person-days are omitted, never plotted as 0%. */
      trend: AgenticTrendPoint[];
      /** The current, incomplete week (if it has any active person-days) —
       * kept OUT of `trend` and out of `delta` so a Tuesday render never
       * shows a two-day sample as a full week's rate (review F3). */
      weekToDate: AgenticTrendPoint | null;
      /** Latest complete week vs the one before it (shared `DeltaResult`
       * idiom — same-grain, so only `delta`/`first` arise). */
      delta: DeltaResult;
      /** Which connectors contributed agentic person-days — so a card can
       * avoid implying org-wide agent coverage when only some vendors emit
       * the signal. */
      coveragePerVendor: VendorAgenticCoverage[];
      /** Distinct subjects with in-window activity that are NOT linked to a
       * person — excluded from the rate, disclosed on the card. */
      unresolvedSubjects: number;
    };

/** The headline + trend window: 12 whole weeks. Callers may fetch a wider
 * range (the team dashboard fetches 180d); rows outside the last
 * `AGENTIC_WINDOW_DAYS` days ending at `windowTo` are sliced off here so the
 * team and personal cards measure the same window the copy states (review
 * F7). */
export const AGENTIC_WINDOW_DAYS = 84;

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** UTC Monday (`YYYY-MM-DD`) of the week containing `day`. Weeks are
 * Monday-anchored so a bucket reads as a work week. */
function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return addDays(day, -backToMonday);
}

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Jun 2–8" for the span `start`..`end` (both inclusive `YYYY-MM-DD`). */
function spanLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const endTxt = endDate.toLocaleDateString("en-US", {
    // Same-month spans show just the end day number; cross-month spans repeat
    // the month so "May 30–Jun 5" reads correctly.
    month: startDate.getUTCMonth() === endDate.getUTCMonth() ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${fmtDay(start)}–${endTxt}`;
}

type PersonDayKey = string; // `${personId}|${day}`

function dayOf(key: PersonDayKey): string {
  return key.slice(key.indexOf("|") + 1);
}

/**
 * Computes the org-level agentic-adoption view from pre-fetched `agent_active`
 * and `active_day` metric rows plus the org's identity links.
 *
 * Rate = |distinct agentic person-days| ÷ |distinct active ∪ agentic
 * person-days|, over the last `AGENTIC_WINDOW_DAYS` days ending at
 * `windowTo`.
 *
 * The denominator is the UNION, not `active_day` alone and not an
 * intersection (review F4): an agentic day is an active day by definition,
 * but whether a vendor co-emits `active_day` alongside `agent_active` on the
 * same row set is vendor-data-dependent (Cursor's `isActive` and
 * `agentRequests` are independent report fields, so an agent-only day without
 * the active flag is possible data). The union keeps the rate ≤ 100% by
 * construction without silently dropping a genuine agentic day whose active
 * flag a vendor didn't set.
 *
 * Multiple rows and multiple SUBJECTS for one person-day collapse to ONE via
 * the person-day keys — the rate is in person-days, never in raw rows or
 * subject-days (review F1).
 *
 * Kinds: no resolved person-days → `noActivity` (with the unresolved-subject
 * count, so "nothing linked to a person yet" is distinguishable from "nothing
 * synced"); resolved activity but zero resolved agentic person-days →
 * `noAgenticData`; otherwise `measured`.
 */
export function computeAgenticAdoption(input: {
  agentActiveRows: readonly AgenticMetricRow[];
  activeDayRows: readonly AgenticMetricRow[];
  identityLinks: readonly IdentityLinkLike[];
  /** Inclusive window end (`YYYY-MM-DD`, UTC) — "today" for both dashboards.
   * Also decides which weekly bucket is the incomplete "week to date". */
  windowTo: string;
}): AgenticAdoption {
  const from = addDays(input.windowTo, -(AGENTIC_WINDOW_DAYS - 1));
  const inWindow = (r: AgenticMetricRow) =>
    r.value > 0 && r.day >= from && r.day <= input.windowTo;

  const personBySubject = new Map<string, string>();
  for (const link of input.identityLinks) {
    personBySubject.set(link.subjectId, link.personId);
  }

  // Resolve each row set to person-day keys; collect unresolved subjects.
  const unresolved = new Set<string>();
  const resolve = (rows: readonly AgenticMetricRow[]): Set<PersonDayKey> => {
    const keys = new Set<PersonDayKey>();
    for (const r of rows) {
      if (!inWindow(r)) continue;
      const personId = personBySubject.get(r.subjectId);
      if (personId === undefined) {
        unresolved.add(r.subjectId);
        continue;
      }
      keys.add(`${personId}|${r.day}`);
    }
    return keys;
  };
  const activeKeys = resolve(input.activeDayRows);
  const agenticKeys = resolve(input.agentActiveRows);

  // Denominator: union (see doc comment). Agentic ⊆ union by construction,
  // so the rate is always 0–100%.
  const unionKeys = new Set<PersonDayKey>(activeKeys);
  for (const k of agenticKeys) unionKeys.add(k);

  if (unionKeys.size === 0) {
    return { kind: "noActivity", unresolvedSubjects: unresolved.size };
  }
  if (agenticKeys.size === 0) {
    return {
      kind: "noAgenticData",
      activeDays: unionKeys.size,
      unresolvedSubjects: unresolved.size,
    };
  }

  const activeDays = unionKeys.size;
  const agenticDays = agenticKeys.size;
  const ratePct = round2((agenticDays / activeDays) * 100);

  // ── Per-vendor coverage: distinct agentic person-days per source
  // connector, counting only person-days in the numerator so it sums
  // consistently with `agenticDays`. A person-day flagged by two connectors
  // counts once per connector (both genuinely saw agent activity). ──
  const perVendor = new Map<string, Set<PersonDayKey>>();
  for (const r of input.agentActiveRows) {
    if (!inWindow(r)) continue;
    const personId = personBySubject.get(r.subjectId);
    if (personId === undefined) continue;
    const key = `${personId}|${r.day}`;
    if (!agenticKeys.has(key)) continue;
    const vendor = r.sourceConnector ?? "unknown";
    let set = perVendor.get(vendor);
    if (!set) {
      set = new Set<PersonDayKey>();
      perVendor.set(vendor, set);
    }
    set.add(key);
  }
  const coveragePerVendor: VendorAgenticCoverage[] = [...perVendor.entries()]
    .map(([sourceConnector, set]) => ({ sourceConnector, agenticDays: set.size }))
    .sort(
      (a, b) =>
        b.agenticDays - a.agenticDays ||
        a.sourceConnector.localeCompare(b.sourceConnector),
    );

  // ── Weekly buckets over person-days. A week with no active person-days is
  // omitted (never plotted as 0% — that would conflate "no data that week"
  // with "0% agentic"). The week containing `windowTo` is COMPLETE only when
  // its Sunday ≤ windowTo; an incomplete week is split out as `weekToDate`
  // and never enters the trend line or the delta (review F3 — a two-day
  // sample must not render as a full week's plunge). ──
  const weeks = new Map<
    string,
    { active: Set<PersonDayKey>; agentic: Set<PersonDayKey> }
  >();
  const bucket = (weekStart: string) => {
    let w = weeks.get(weekStart);
    if (!w) {
      w = { active: new Set(), agentic: new Set() };
      weeks.set(weekStart, w);
    }
    return w;
  };
  for (const key of unionKeys) bucket(weekStartUtc(dayOf(key))).active.add(key);
  for (const key of agenticKeys) bucket(weekStartUtc(dayOf(key))).agentic.add(key);

  const currentWeekStart = weekStartUtc(input.windowTo);
  const currentWeekComplete = addDays(currentWeekStart, 6) <= input.windowTo;

  const point = (
    weekStart: string,
    w: { active: Set<PersonDayKey>; agentic: Set<PersonDayKey> },
    endDay: string,
  ): AgenticTrendPoint => ({
    weekStart,
    label: spanLabel(weekStart, endDay),
    ratePct: round2((w.agentic.size / w.active.size) * 100),
    agenticDays: w.agentic.size,
    activeDays: w.active.size,
  });

  const trend: AgenticTrendPoint[] = [];
  let weekToDate: AgenticTrendPoint | null = null;
  for (const [weekStart, w] of [...weeks.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (w.active.size === 0) continue;
    if (weekStart === currentWeekStart && !currentWeekComplete) {
      // Labeled by its REAL covered span ("Jun 8–9"), not the full week
      // range it hasn't covered yet.
      weekToDate = point(weekStart, w, input.windowTo);
    } else {
      trend.push(point(weekStart, w, addDays(weekStart, 6)));
    }
  }

  return {
    kind: "measured",
    ratePct,
    agenticDays,
    activeDays,
    trend,
    weekToDate,
    delta: weeklyDelta(trend),
    coveragePerVendor,
    unresolvedSubjects: unresolved.size,
  };
}

/**
 * Latest complete weekly bucket vs the one before it, in the shared
 * `DeltaResult` shape (src/lib/score-insights.ts). Weekly buckets are all the
 * same grain with no definition-version concept, so only `first` (fewer than
 * two complete weeks) and `delta` ever arise — `notComparable` is
 * structurally impossible here, which is why this is a tiny local reducer
 * rather than a call into `deriveDelta` (whose inputs are score-trend
 * points).
 */
function weeklyDelta(trend: readonly AgenticTrendPoint[]): DeltaResult {
  if (trend.length < 2) return { kind: "first" };
  const previous = trend[trend.length - 2];
  const current = trend[trend.length - 1];
  return {
    kind: "delta",
    current: current.ratePct,
    previous: previous.ratePct,
    delta: round2(current.ratePct - previous.ratePct),
    previousPeriodLabel: previous.label,
  };
}
