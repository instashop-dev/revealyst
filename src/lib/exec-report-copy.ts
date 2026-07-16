// Monthly executive-report COPY (W6-F, G7 — prose is a claim surface). ALL
// user-facing prose the monthly board memo renders lives here so the subject,
// intro, per-number lines, and footer share ONE reviewed source and can't drift
// across the composer (src/lib/exec-report.ts), the email renderer
// (src/lib/exec-report-email.ts), the export route, or the tests. Same
// glossary-module discipline as narrative-copy.ts / budget-alert-copy.ts /
// maturity-glossary.ts.
//
// The memo is a MEMO, not a chart wall (Spec V4 §5.4): a short plain-prose
// summary a CTO forwards to a board. Zero LLM (G6) — every sentence is a
// template FUNCTION filled with a MEASURED value the composer derived from the
// maturity / spend / attribution reads. Honesty discipline (invariant b / G2 /
// G4), inherited verbatim from the surfaces these numbers already ship on:
//  - The maturity LEVEL is MODELED over uncalibrated thresholds — the copy says
//    "modeled" / "a leading indicator", never a certified fact or a percentile.
//  - Quarter-over-quarter trajectory is WITHHELD (not fabricated) when the prior
//    window has no comparable measured usage — the two notComparable states are
//    first-class sentences here, never a "flat" default.
//  - Spend is VENDOR-REPORTED only (never estimated/derived blended into the
//    threshold), month-to-date, framed "so far this month" — never a final bill.
//  - Attribution coverage is what the VENDOR attributed to a specific person —
//    the copy says "attributed to a specific person", never "identity-resolved".
//  - Aggregate-only: no named individual, no per-person number, ever.

import type { ConfidenceTier } from "./maturity";
import type { MaturityLevelValue } from "./maturity-glossary";

/** UTC "July 2026" month label from a "YYYY-MM" key. */
export function execReportMonthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`execReportMonthLabel expects YYYY-MM, got "${monthKey}"`);
  }
  return new Date(`${monthKey}-01T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** UTC "Jun 30" day label — matches narrative prose (narrative-copy.ts). */
export function execReportDayLabel(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Whole-dollar approximation for memo prose ("$1,900", not "$1,900.00"). */
export function execReportApproxDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Human labels for the four confidence tiers — rendered as a small tag next to
 * each board number so the reader never mistakes a modeled/directional signal
 * for a measured fact (G2). */
// Confidence labels are homed in maturity-glossary.ts (the maturity copy
// module) and re-exported for this module's existing consumers — the memo
// deliberately shares the dashboard's vocabulary rather than owning a copy.
export { CONFIDENCE_TIER_LABEL } from "./maturity-glossary";

export const EXEC_REPORT_COPY = {
  /** Subject — names the month, never a private number (inbox-preview privacy). */
  subject: (monthLabel: string): string =>
    `Your ${monthLabel} AI adoption memo — Revealyst`,

  /** Hidden preview text — value-free framing. */
  preheader:
    "A one-page executive summary of your team's AI adoption this month — measured, with the gaps named, not estimated.",

  title: "Monthly AI adoption memo",

  /** Lead paragraph naming the workspace and month. Sets the honest frame. */
  intro: (orgName: string, monthLabel: string): string =>
    `Here is your ${monthLabel} AI adoption summary for ${orgName}. Every figure below is measured from the tools you've connected; where a number can't be measured honestly, we say so rather than estimate it.`,

  /** Section headings the memo lays out in order. */
  headings: {
    summary: "In brief",
    maturity: "Maturity",
    board: "The board numbers",
    notMeasured: "What we deliberately don't measure",
  },

  /** Maturity level line — three honest states (placed / no data / stale),
   * mirroring maturity-glossary's MATURITY_LEVEL_(NONE|STALE)_COPY. */
  maturity: {
    placed: (name: string, level: MaturityLevelValue): string =>
      `Your AI maturity level this month is ${name} (L${level}). This is a modeled reading of how sophisticated your AI usage is — a leading indicator, not a measure of realized business outcomes.`,
    none: "There isn't enough data to place a maturity level this month. A level needs people we can see and usage days to measure — we don't show a placeholder rung when the data isn't there.",
    stale: "Your maturity level is withheld this month: no connected tool has synced inside the report's window, so the quiet weeks are unobserved, not measured. Re-syncing your connections brings it current.",
  },

  /** Quarter-over-quarter trajectory — the two withheld (notComparable) states
   * are first-class sentences, never a fabricated "flat" (LOAD-BEARING). */
  trajectory: {
    up: (fromName: string, toName: string, levels: number): string =>
      `Quarter over quarter, your level rose ${levelWord(levels)} — from ${fromName} to ${toName}.`,
    down: (fromName: string, toName: string, levels: number): string =>
      `Quarter over quarter, your level slipped ${levelWord(levels)} — from ${fromName} to ${toName}.`,
    held: (name: string): string =>
      `Quarter over quarter, your level held at ${name}.`,
    /** One side couldn't be placed (insufficient), so no delta is claimed. */
    oneSideUnplaced:
      "We can't show a quarter-over-quarter level move this month, because one of the two quarters didn't have enough data to place a level.",
    notComparableInsufficient:
      "There's no comparable prior quarter yet, so we're not showing a quarter-over-quarter move — the earlier window has no measured usage to compare against.",
    notComparablePartial:
      "We're not showing a quarter-over-quarter move this month: your data doesn't yet cover enough of the prior quarter to compare honestly — doing so would compare against your own onboarding.",
  },

  /** Plateau check — a directional read of the org's own recent trend. */
  plateau: {
    growing: "Recent weekly usage is still growing, not flattening.",
    flattened:
      "Recent weekly usage has flattened out — a directional prompt to look, not a verdict that anything is wrong.",
    insufficient:
      "There aren't enough complete weeks of usage yet to say whether recent usage is growing or flattening.",
    stale:
      "We're withholding the plateau read this month: the most recent sync predates the weeks it would judge, so their silence is unobserved, not a real slowdown.",
  },

  /** Spend-governance line — vendor-reported, month-to-date, never a bill. */
  spend: {
    withBudgetSpent: (p: {
      reported: string;
      limit: string;
      pctUsed: number;
    }): string =>
      `Vendor-reported AI spend so far this month is ${p.reported} — ${p.pctUsed}% of your ${p.limit} monthly budget.`,
    withBudgetNoSpend: (p: { limit: string }): string =>
      `No vendor-reported AI spend has been recorded this month against your ${p.limit} monthly budget.`,
    noBudgetSpent: (p: { reported: string }): string =>
      `Vendor-reported AI spend so far this month is ${p.reported}. No monthly budget is set.`,
    noBudgetNoSpend:
      "No vendor-reported AI spend has been recorded this month, and no monthly budget is set.",
    /** Appended when derived/estimated spend exists — labeled, never summed in. */
    estimatedAside: (p: { estimated: string }): string =>
      ` A further ${p.estimated} of estimated (not vendor-billed) usage is tracked separately and not counted toward the budget.`,
    basis:
      "Spend counts vendor-reported figures only (not estimated usage), measured from the first of the month to today. Vendor cost reports are day-grain and can be restated — treat this as a close guide, not a final bill.",
  },

  /** Honesty-gap (attribution-coverage) trend — the honesty machinery as
   * visible progress. "attributed to a specific person", never "resolved". */
  honesty: {
    empty:
      "There isn't enough attributed usage yet to show an attribution-coverage trend.",
    first: (p: { currentPct: number }): string =>
      `In the latest measured week, ${p.currentPct}% of usage was attributed by the vendor to a specific person — the first week we can measure this.`,
    up: (p: {
      currentPct: number;
      previousPct: number;
      previousWeekLabel: string;
    }): string =>
      `Attribution coverage is improving: in the latest measured week, ${p.currentPct}% of usage was attributed to a specific person, up from ${p.previousPct}% the week of ${p.previousWeekLabel}.`,
    down: (p: {
      currentPct: number;
      previousPct: number;
      previousWeekLabel: string;
    }): string =>
      `Attribution coverage slipped: in the latest measured week, ${p.currentPct}% of usage was attributed to a specific person, down from ${p.previousPct}% the week of ${p.previousWeekLabel}.`,
    flat: (p: { currentPct: number }): string =>
      `Attribution coverage held steady: in the latest measured week, ${p.currentPct}% of usage was attributed to a specific person.`,
  },

  /** Value strings for the eight board numbers — honest empties never fabricate
   * a zero (G4). Labels + caveats come from maturity-glossary's
   * MATURITY_NUMBER_COPY; these are only the measured VALUE strings. */
  values: {
    activationMeasured: (p: {
      pct: number;
      active: number;
      known: number;
    }): string =>
      `${p.pct}% (${p.active} of ${p.known} ${plural(p.known, "person", "people")} active)`,
    activationNoPeople: "Not enough people to measure yet",
    benchmarkModeled: (p: { orgValue: number; peerMedian: number }): string =>
      `Adoption score ${p.orgValue} vs a modeled peer median of ${p.peerMedian}`,
    benchmarkNone: "No adoption score yet to compare",
    concentration: (p: { topCount: number; topSharePct: number }): string =>
      `The heaviest-using ${p.topCount} ${plural(p.topCount, "person", "people")} account for ${p.topSharePct}% of attributed prompts`,
    concentrationNone: "Not enough attributed usage to measure concentration",
    costPerActiveUser: (p: { dollars: string; active: number }): string =>
      `${p.dollars} per active person (${p.active} active)`,
    costPerActiveUserNone:
      "Not enough data — needs both vendor-reported spend and active people",
    toolSprawl: (p: {
      active: number;
      connected: number;
      idle: number;
    }): string =>
      `${p.active} of ${p.connected} connected ${plural(p.connected, "tool", "tools")} active${p.idle > 0 ? ` (${p.idle} idle)` : ""}`,
    agenticMeasured: (p: { ratePct: number }): string =>
      `${p.ratePct}% of active days used an agent`,
    agenticNoData: "No agent-capable telemetry from the connected tools yet",
    agenticNoActivity: "No identity-resolved activity to measure yet",
  },

  footer: {
    dataAsOf: (dayLabel: string): string =>
      `Data as of ${dayLabel} (the freshest successful sync across your connected tools).`,
    dataNever:
      "No connected tool has synced successfully yet, so this memo has no measured data to report.",
    manage:
      "You're receiving this monthly memo because you're an admin of this Revealyst workspace. An admin can turn the monthly memo off anytime in Settings.",
    honesty:
      "Every number here traces to real, vendor-reported usage. Revealyst never estimates ROI or a bill, and never ranks named individuals on a shared report.",
  },
} as const;

/** "a level" / "two levels" — the level-count phrase the trajectory line uses. */
function levelWord(levels: number): string {
  const n = Math.abs(levels);
  if (n === 1) return "a level";
  const words = ["zero", "one", "two", "three", "four"];
  return `${words[n] ?? n} levels`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
