import type { DeltaResult } from "./score-insights";

// F1.4 "Agentic adoption rate" (research M6) — pure derivation, no React, no
// I/O. Surfaces the agentic transition: the share of ACTIVE days on which an
// AI agent (not just autocomplete or chat) was used, org-level, with a weekly
// trend. The scored-preset variant is deferred to Phase 4; this is display
// only.
//
// Honesty (G4): a zero-agent-row org is the "no agentic telemetry" state, NOT
// a measured-zero adoption claim — not every connected vendor emits the
// cross-vendor `agent_active` flag (Claude Code / Copilot / Cursor do; OpenAI
// does not). The two empty kinds below keep "nothing synced" and "synced, but
// no agent-capable tool" distinct from a real measured rate.

/** The minimal metric-record shape this module reads — a structural subset of
 * `metric_records` rows (src/db/schema.ts). `value` is the numeric flag/count;
 * a subject-day "counts" when value > 0 (the flag metrics are emitted as 1,
 * never zero-filled — absence is absence). `sourceConnector` drives the
 * per-vendor coverage breakdown; it is optional so tests can omit it. */
export type AgenticMetricRow = {
  subjectId: string;
  day: string;
  value: number;
  sourceConnector?: string;
};

export type AgenticTrendPoint = {
  /** UTC Monday of the ISO-ish week bucket, `YYYY-MM-DD`. */
  weekStart: string;
  /** Human label for the week, e.g. "Jun 2–8". */
  label: string;
  ratePct: number;
  agenticDays: number;
  activeDays: number;
};

export type VendorAgenticCoverage = {
  /** The `source_connector` module id (e.g. "anthropic-console@1"). */
  sourceConnector: string;
  /** Distinct agentic subject-days attributed to this connector. */
  agenticDays: number;
};

export type AgenticAdoption =
  // Nothing synced yet — no active days to measure a rate against.
  | { kind: "noActivity" }
  // Active days exist, but no vendor reported ANY agent activity in the window
  // — the honest "no agent-capable telemetry" state, never a measured 0%.
  | { kind: "noAgenticData"; activeDays: number }
  // A real, measured rate.
  | {
      kind: "measured";
      /** 0–100, rounded to an integer. */
      ratePct: number;
      /** Distinct agentic subject-days (intersected with active days, so the
       * rate can never exceed 100%). */
      agenticDays: number;
      /** Distinct active subject-days — the denominator. */
      activeDays: number;
      /** Weekly buckets, chronological, only weeks with ≥1 active day. */
      trend: AgenticTrendPoint[];
      /** Latest weekly bucket vs the one before it (reuses the shared
       * `DeltaResult` idiom — same-grain, so only `delta`/`first` arise). */
      delta: DeltaResult;
      /** Which connectors contributed agentic days — so a card can avoid
       * implying org-wide agent coverage when only some vendors emit it. */
      coveragePerVendor: VendorAgenticCoverage[];
    };

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Distinct `subjectId|day` keys among rows whose value is positive. */
function subjectDayKeys(rows: readonly AgenticMetricRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.value > 0) keys.add(`${r.subjectId}|${r.day}`);
  }
  return keys;
}

/** UTC Monday (`YYYY-MM-DD`) of the week containing `day`. Weeks are
 * Monday-anchored so a bucket reads as a work week. */
function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  const monday = new Date(d.getTime() - backToMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Jun 2–8" from a Monday week-start. */
function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const startTxt = fmtDay(weekStart);
  const endTxt = new Date(end).toLocaleDateString("en-US", {
    // Same-month weeks show just the end day number; cross-month weeks repeat
    // the month so "May 30–Jun 5" reads correctly.
    month: start.getUTCMonth() === end.getUTCMonth() ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${startTxt}–${endTxt}`;
}

/**
 * Computes the org-level agentic-adoption view from pre-fetched `agent_active`
 * and `active_day` metric rows over a window.
 *
 * Rate = |distinct agentic subject-days ∩ active subject-days| ÷ |distinct
 * active subject-days|. The intersection guarantees the numerator can never
 * exceed the denominator (so the rate is always 0–100%), and it means the rate
 * honestly reads as "of the days people were active with AI, on what share did
 * they reach for an agent" — never inflated by an agent row on a day with no
 * recorded active flag. In practice every vendor that emits `agent_active`
 * emits `active_day` on the same day (verified in the normalizers), so the
 * intersection is a safety floor, not a routine subtractor.
 *
 * Multiple rows for one subject-day (e.g. two connectors both flagging the
 * same person on the same day) collapse to ONE via the set keys — the rate is
 * in subject-days, never in raw rows.
 *
 * Kinds: no active rows → `noActivity`; active rows but zero agent rows →
 * `noAgenticData` (the honest "no agent telemetry" state); otherwise
 * `measured`.
 */
export function computeAgenticAdoption(input: {
  agentActiveRows: readonly AgenticMetricRow[];
  activeDayRows: readonly AgenticMetricRow[];
}): AgenticAdoption {
  const activeKeys = subjectDayKeys(input.activeDayRows);
  const agenticKeysRaw = subjectDayKeys(input.agentActiveRows);

  if (activeKeys.size === 0) {
    return { kind: "noActivity" };
  }
  if (agenticKeysRaw.size === 0) {
    return { kind: "noAgenticData", activeDays: activeKeys.size };
  }

  // Numerator is the intersection — an agentic day only counts toward the rate
  // if it is also an active day.
  const agenticKeys = new Set<string>();
  for (const k of agenticKeysRaw) {
    if (activeKeys.has(k)) agenticKeys.add(k);
  }

  const activeDays = activeKeys.size;
  const agenticDays = agenticKeys.size;
  const ratePct = round2((agenticDays / activeDays) * 100);

  // ── Per-vendor coverage: distinct agentic (∩ active) subject-days per
  // source connector. Only counts rows whose subject-day is in the counted
  // numerator, so it sums consistently with `agenticDays`. A subject-day
  // flagged by two connectors is counted once per connector (it genuinely
  // reflects that both saw agent activity that day). ──
  const perVendor = new Map<string, Set<string>>();
  for (const r of input.agentActiveRows) {
    if (r.value <= 0) continue;
    const key = `${r.subjectId}|${r.day}`;
    if (!agenticKeys.has(key)) continue;
    const vendor = r.sourceConnector ?? "unknown";
    let set = perVendor.get(vendor);
    if (!set) {
      set = new Set<string>();
      perVendor.set(vendor, set);
    }
    set.add(key);
  }
  const coveragePerVendor: VendorAgenticCoverage[] = [...perVendor.entries()]
    .map(([sourceConnector, set]) => ({ sourceConnector, agenticDays: set.size }))
    .sort((a, b) => b.agenticDays - a.agenticDays || a.sourceConnector.localeCompare(b.sourceConnector));

  // ── Weekly trend. Bucket active + agentic subject-days by Monday week; a
  // week with no active days is omitted (never plotted as 0 — that would
  // conflate "no data that week" with "0% agentic"). ──
  const weeks = new Map<string, { active: Set<string>; agentic: Set<string> }>();
  const bucket = (weekStart: string) => {
    let w = weeks.get(weekStart);
    if (!w) {
      w = { active: new Set(), agentic: new Set() };
      weeks.set(weekStart, w);
    }
    return w;
  };
  for (const key of activeKeys) {
    const day = key.slice(key.indexOf("|") + 1);
    bucket(weekStartUtc(day)).active.add(key);
  }
  for (const key of agenticKeys) {
    const day = key.slice(key.indexOf("|") + 1);
    bucket(weekStartUtc(day)).agentic.add(key);
  }
  const trend: AgenticTrendPoint[] = [...weeks.entries()]
    .filter(([, w]) => w.active.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => ({
      weekStart,
      label: weekLabel(weekStart),
      ratePct: round2((w.agentic.size / w.active.size) * 100),
      agenticDays: w.agentic.size,
      activeDays: w.active.size,
    }));

  return {
    kind: "measured",
    ratePct,
    agenticDays,
    activeDays,
    trend,
    delta: weeklyDelta(trend),
    coveragePerVendor,
  };
}

/**
 * Latest weekly bucket vs the one before it, in the shared `DeltaResult` shape
 * (src/lib/score-insights.ts) so the card can reuse `formatDelta`. Weekly
 * buckets are all the same grain with no definition-version concept, so only
 * `first` (fewer than two weeks) and `delta` ever arise — `notComparable` is
 * structurally impossible here, which is why this is a tiny local reducer
 * rather than a call into `deriveDelta` (whose inputs are score-trend points).
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
