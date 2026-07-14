// W6-F "Monthly executive narrative one-pager" (Spec V4 §5.4, §7.1). Composes a
// distributable board MEMO — not a chart wall — from the numbers three existing
// surfaces already ship: the AI-maturity read (the eight board numbers +
// confidence tiers + QoQ trajectory + plateau), the spend-governance read (the
// vendor-reported spend line), and the attribution-coverage trend (the
// honesty-gap line). PURE and TEMPLATE-COMPOSED: no React, no I/O, NO LLM (G6).
// Every sentence is a template from exec-report-copy.ts filled with a measured
// value here — the composer only PICKS a template and fills it, it never invents
// prose or a comparison.
//
// This is a thin WRAPPER that REUSES composeNarrative (src/lib/narrative.ts):
// the memo's opening "In brief" prose is composeNarrative's output verbatim —
// the same honest activity/agentic/spend summary the team-dashboard card
// renders, now carried into a distributable. The exec-only additions (the
// maturity board, the QoQ trajectory, the spend + honesty lines) are layered on
// top. Reusing composeNarrative keeps the intro's honesty rules (first /
// notComparable / no-fabrication) in one tested place.
//
// Honesty (invariant b / G2 / G4) is inherited from the reads, never re-derived:
// a `null` / `notComparable` / `insufficient` input yields an explicit honest
// state (rendered from exec-report-copy.ts), NEVER a fabricated zero or flat.
// The QoQ trajectory's two withheld states are LOAD-BEARING and covered by the
// golden-file tests. Aggregate-only — no named individual, no per-person number.

import type { forOrg } from "../db/org-scope";
import { computeAttributionTrend, type AttributionTrend } from "./attribution-trend";
import {
  CONFIDENCE_TIER_LABEL,
  EXEC_REPORT_COPY,
  execReportApproxDollars,
  execReportDayLabel,
} from "./exec-report-copy";
import { addUtcDays } from "./raw-metric-delta";
import { computeRecentMovement } from "./recent-movement";
import { readMaturityView, type ConfidenceTier, type MaturityView } from "./maturity";
import { readSpendGovernance } from "./spend-governance";
import {
  MATURITY_LEVEL_COPY,
  MATURITY_LEVEL_NONE_COPY,
  MATURITY_LEVEL_STALE_COPY,
  MATURITY_NOT_SCORED,
  MATURITY_NUMBER_COPY,
  type MaturityNumberKey,
  type NotScoredItem,
} from "./maturity-glossary";
import { composeNarrative, type Narrative, type NarrativeInputs } from "./narrative";
import type { SpendGovernanceView } from "./spend-governance";
import { CAPABILITY_STATE_CONSTANTS } from "../scoring/capability-state";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "./segments";

/** One board number as it appears in the memo: the label + caveat come from
 * maturity-glossary (MATURITY_NUMBER_COPY); `value` is the measured string
 * (honest empty when a side is missing); `confidence`/`confidenceLabel` carry
 * the number's own tier so a modeled/directional figure is never read as
 * measured fact (G2). */
export type ExecReportSection = {
  key: MaturityNumberKey;
  label: string;
  value: string;
  confidence: ConfidenceTier;
  confidenceLabel: string;
  caveat: string;
};

export type ExecReport = {
  monthKey: string;
  orgName: string;
  /** "In brief" prose — composeNarrative's sentences, reused verbatim. Empty
   * when nothing is measurable (the memo then renders an honest empty intro,
   * never a teaser). */
  summary: string[];
  /** The maturity level headline (placed / not-enough-data / stale). */
  maturityLine: string;
  /** Quarter-over-quarter trajectory — includes the two honest withheld states. */
  trajectoryLine: string;
  /** Directional plateau read of the org's own recent weekly usage. */
  plateauLine: string;
  /** Vendor-reported month-to-date spend vs budget. */
  spendLine: string;
  /** Attribution-coverage (honesty-gap) trend line. */
  honestyLine: string;
  /** W7-6 follow-up — one aggregate, count-only capability-coverage sentence
   * (the team's strongest capability by share). Empty string when no capability
   * clears the MIN_PEOPLE floor, so renderers skip it. */
  capabilityCoverageLine: string;
  /** The eight board numbers, in the maturity-report grid order. */
  sections: ExecReportSection[];
  /** The "what we deliberately don't measure" differentiator content. */
  notMeasured: NotScoredItem[];
  /** ISO "data as of" of the freshest successful sync, or null. */
  dataAsOf: string | null;
};

export type ExecReportInputs = {
  /** Calendar month the memo covers, "YYYY-MM" (UTC). */
  monthKey: string;
  orgName: string;
  /** The monthly AI-maturity read — source of the 8 board numbers + tiers +
   * trajectory + plateau. */
  maturity: MaturityView;
  /** The spend-governance read — source of the vendor-reported spend line. */
  spend: SpendGovernanceView;
  /** The attribution-coverage trend — source of the honesty-gap line. */
  attribution: AttributionTrend;
  /** Reused → composeNarrative for the "In brief" opening prose. Its own
   * honesty rules apply; attribution is intentionally left OFF these inputs
   * (the memo carries the honesty-gap trend as its own dedicated line, so the
   * narrative close would double it). */
  narrative: NarrativeInputs;
  /** W7-6 follow-up — aggregate, count-only, ALREADY-FLOORED capability coverage
   * (the caller applies the MIN_PEOPLE floor + label join + share sort, exactly
   * as readDashboardView does). Omitted/empty → no coverage line. NEVER carries
   * a person id — it is a count-only rollup. */
  capabilityCoverage?: readonly { label: string; mastered: number; total: number }[];
};

function round(n: number): number {
  return Math.round(n);
}

/** Exact 2-decimal USD (for a per-unit rate like cost-per-active-user). */
function exactUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** The maturity level headline — three honest states. */
function maturityLine(maturity: MaturityView): string {
  const C = EXEC_REPORT_COPY.maturity;
  if (maturity.stale) return C.stale;
  const level = maturity.numbers.maturity.level;
  if (level === null) return C.none;
  return C.placed(MATURITY_LEVEL_COPY[level].name, level);
}

/** Quarter-over-quarter trajectory — the two `notComparable` states are
 * first-class sentences (LOAD-BEARING), never a fabricated "flat". */
function trajectoryLine(maturity: MaturityView): string {
  const C = EXEC_REPORT_COPY.trajectory;
  const t = maturity.numbers.maturity.trajectory;
  if (t.kind === "notComparable") {
    return t.reason === "insufficientHistory"
      ? C.notComparableInsufficient
      : C.notComparablePartial;
  }
  // comparable: a level delta exists only when BOTH quarters placed a level.
  if (t.levelDelta === null || t.priorLevel === null || t.currentLevel === null) {
    return C.oneSideUnplaced;
  }
  const fromName = MATURITY_LEVEL_COPY[t.priorLevel].name;
  const toName = MATURITY_LEVEL_COPY[t.currentLevel].name;
  if (t.levelDelta > 0) return C.up(fromName, toName, t.levelDelta);
  if (t.levelDelta < 0) return C.down(fromName, toName, t.levelDelta);
  return C.held(toName);
}

/** Directional plateau read. */
function plateauLine(maturity: MaturityView): string {
  const C = EXEC_REPORT_COPY.plateau;
  const p = maturity.numbers.plateau;
  if (p.kind === "insufficient") return C.insufficient;
  if (p.kind === "stale") return C.stale;
  return p.plateaued ? C.flattened : C.growing;
}

/** Vendor-reported month-to-date spend vs budget (never estimated/blended). */
function spendLine(spend: SpendGovernanceView): string {
  const C = EXEC_REPORT_COPY.spend;
  const reported = spend.reportedCents;
  const limit = spend.budget?.monthlyLimitCents ?? 0;
  const hasBudget = limit > 0;
  let line: string;
  if (hasBudget && reported > 0) {
    const pctUsed = round(spend.alert?.pctUsed ?? (reported / limit) * 100);
    line = C.withBudgetSpent({
      reported: execReportApproxDollars(reported),
      limit: execReportApproxDollars(limit),
      pctUsed,
    });
  } else if (hasBudget) {
    line = C.withBudgetNoSpend({ limit: execReportApproxDollars(limit) });
  } else if (reported > 0) {
    line = C.noBudgetSpent({ reported: execReportApproxDollars(reported) });
  } else {
    line = C.noBudgetNoSpend;
  }
  // Estimated/derived spend is surfaced ALONGSIDE, labeled, never summed in.
  if (spend.estimatedCents > 0) {
    line += C.estimatedAside({
      estimated: execReportApproxDollars(spend.estimatedCents),
    });
  }
  return line;
}

/** Attribution-coverage (honesty-gap) trend line. */
function honestyLine(attribution: AttributionTrend): string {
  const C = EXEC_REPORT_COPY.honesty;
  if (attribution.kind === "empty") return C.empty;
  const d = attribution.delta;
  if (d.kind === "first") return C.first({ currentPct: attribution.currentPct });
  if (d.deltaPct > 0) {
    return C.up({
      currentPct: d.currentPct,
      previousPct: d.previousPct,
      previousWeekLabel: execReportDayLabel(d.previousWeekStart),
    });
  }
  if (d.deltaPct < 0) {
    return C.down({
      currentPct: d.currentPct,
      previousPct: d.previousPct,
      previousWeekLabel: execReportDayLabel(d.previousWeekStart),
    });
  }
  return C.flat({ currentPct: d.currentPct });
}

/** The eight board numbers, in maturity-report grid order. Each value is the
 * measured string or an explicit honest empty — never a fabricated zero. */
function sections(maturity: MaturityView): ExecReportSection[] {
  const V = EXEC_REPORT_COPY.values;
  const n = maturity.numbers;
  const out: Array<{ key: MaturityNumberKey; confidence: ConfidenceTier; value: string }> = [];

  // 1. Activation (measured).
  out.push({
    key: "activation",
    confidence: n.activation.confidence,
    value:
      n.activation.activationPct === null
        ? V.activationNoPeople
        : V.activationMeasured({
            pct: n.activation.activationPct,
            active: n.activation.activePeople,
            known: n.activation.knownPeople,
          }),
  });

  // 2. Adoption vs benchmark (modeled).
  const bench = n.adoptionVsBenchmark.benchmark;
  out.push({
    key: "adoptionVsBenchmark",
    confidence: n.adoptionVsBenchmark.confidence,
    value:
      bench && bench.orgValue !== null
        ? V.benchmarkModeled({
            orgValue: bench.orgValue,
            peerMedian: bench.peerMedian,
          })
        : V.benchmarkNone,
  });

  // 3. Maturity level (modeled) — mirrors the headline's three states.
  out.push({
    key: "maturity",
    confidence: n.maturity.confidence,
    value: maturity.stale
      ? MATURITY_LEVEL_STALE_COPY.name
      : n.maturity.level === null
        ? MATURITY_LEVEL_NONE_COPY.name
        : `${MATURITY_LEVEL_COPY[n.maturity.level].name} (L${n.maturity.level})`,
  });

  // 4. Plateau (directional).
  out.push({
    key: "plateau",
    confidence: n.plateau.confidence,
    value:
      n.plateau.kind === "insufficient"
        ? "Not enough weeks yet"
        : n.plateau.kind === "stale"
          ? "Withheld — data stale"
          : n.plateau.plateaued
            ? "Flattened"
            : "Growing",
  });

  // 5. Concentration (directional).
  const conc = n.concentration.concentration;
  out.push({
    key: "concentration",
    confidence: n.concentration.confidence,
    value: conc.available
      ? V.concentration({
          topCount: conc.top10Count,
          topSharePct: round(conc.top10SharePct),
        })
      : V.concentrationNone,
  });

  // 6. Cost per active user (measured, ratio-honest).
  out.push({
    key: "costPerActiveUser",
    confidence: n.costPerActiveUser.confidence,
    value:
      n.costPerActiveUser.cost === null
        ? V.costPerActiveUserNone
        : V.costPerActiveUser({
            dollars: exactUsd(n.costPerActiveUser.cost.centsPerUnit),
            active: n.costPerActiveUser.activePeople,
          }),
  });

  // 7. Tool sprawl (measured).
  out.push({
    key: "toolSprawl",
    confidence: n.toolSprawl.confidence,
    value:
      n.toolSprawl.connectedTools === 0
        ? "No tools connected yet"
        : V.toolSprawl({
            active: n.toolSprawl.activeTools,
            connected: n.toolSprawl.connectedTools,
            idle: n.toolSprawl.idleTools,
          }),
  });

  // 8. Agentic share (measured).
  const agentic = n.agenticShare.agentic;
  out.push({
    key: "agenticShare",
    confidence: n.agenticShare.confidence,
    value:
      agentic.kind === "measured"
        ? V.agenticMeasured({ ratePct: round(agentic.ratePct) })
        : agentic.kind === "noAgenticData"
          ? V.agenticNoData
          : V.agenticNoActivity,
  });

  return out.map((s) => ({
    key: s.key,
    label: MATURITY_NUMBER_COPY[s.key].label,
    value: s.value,
    confidence: s.confidence,
    confidenceLabel: CONFIDENCE_TIER_LABEL[s.confidence],
    caveat: MATURITY_NUMBER_COPY[s.key].caveat,
  }));
}

/**
 * Composes the monthly executive memo. Pure, template-only, zero LLM. The "In
 * brief" prose is composeNarrative reused verbatim; the maturity board,
 * trajectory, plateau, spend, and honesty lines are layered on. Every string
 * traces to a measured input via exec-report-copy.ts.
 */
/** One aggregate, count-only capability-coverage sentence — the team's strongest
 * capability by mastered share. Empty when nothing cleared the caller's
 * MIN_PEOPLE floor. Never names a person (a count-only rollup, invariant b). */
function capabilityCoverageLine(
  coverage: ExecReportInputs["capabilityCoverage"],
): string {
  if (!coverage || coverage.length === 0) return "";
  // Caller already sorted by share descending; the first is the strongest.
  const top = coverage[0];
  const also =
    coverage.length > 1
      ? ` Coverage spans ${coverage.length} capabilities in total.`
      : "";
  return `Capability coverage: ${top.mastered} of ${top.total} people show established habits in ${top.label}.${also}`;
}

export function composeExecReport(inputs: ExecReportInputs): ExecReport {
  const narrative: Narrative = composeNarrative(inputs.narrative);
  return {
    monthKey: inputs.monthKey,
    orgName: inputs.orgName,
    summary: narrative.sentences,
    maturityLine: maturityLine(inputs.maturity),
    trajectoryLine: trajectoryLine(inputs.maturity),
    plateauLine: plateauLine(inputs.maturity),
    spendLine: spendLine(inputs.spend),
    honestyLine: honestyLine(inputs.attribution),
    capabilityCoverageLine: capabilityCoverageLine(inputs.capabilityCoverage),
    sections: sections(inputs.maturity),
    notMeasured: MATURITY_NOT_SCORED,
    dataAsOf: inputs.maturity.dataAsOf,
  };
}

type OrgScope = ReturnType<typeof forOrg>;

/** How many trailing days of usage rows the reused narrative + attribution
 * trend need. The attribution trend surfaces up to 12 complete weeks (84 days);
 * 90 gives a small buffer and covers the 8-week movement comparison too. */
export const EXEC_REPORT_USAGE_WINDOW_DAYS = 90;

/**
 * Reads everything the monthly memo needs through the org-scoped repository
 * (`forOrg`) in a flat, concurrent Promise.all (round-trip depth 1, G10 — the
 * same discipline as readMaturityView / readDashboardView), then composes the
 * memo. Both the monthly poller (src/poller/exec-report.ts) AND the on-demand
 * export route call this, so the emailed memo and the downloadable one-pager
 * are byte-for-byte the same composition.
 *
 * `today` is caller-supplied (YYYY-MM-DD, UTC) so the windows are deterministic
 * and testable. The reported month is the month CONTAINING `today − 1`, up to
 * that day: on the 1st (the cron), that's the full month that just ended; an
 * on-demand export mid-month sees the current month-to-date.
 */
export async function readExecReport(
  scope: OrgScope,
  opts: { today: string; orgName: string },
): Promise<ExecReport> {
  const { today, orgName } = opts;
  const reportedMonthEnd = addUtcDays(today, -1);
  const monthKey = reportedMonthEnd.slice(0, 7);
  const usageFrom = addUtcDays(today, -EXEC_REPORT_USAGE_WINDOW_DAYS);

  const [
    maturity,
    spend,
    activeDayRows,
    spendRows,
    identities,
    coverageCounts,
    capabilityLabels,
  ] = await Promise.all([
    readMaturityView(scope, today),
    readSpendGovernance(scope, reportedMonthEnd),
    scope.metrics.records({
      metricKey: "active_day",
      from: usageFrom,
      to: today,
      dim: "",
    }),
    scope.metrics.records({
      metricKey: "spend_cents",
      from: usageFrom,
      to: today,
    }),
    scope.identities.all(),
    // W7-6 follow-up: aggregate capability coverage, count-only, folded into
    // this same depth-1 batch.
    scope.mastery.coverageCounts(CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD),
    scope.capabilities.labels(),
  ]);

  // MIN_PEOPLE-floored, label-joined, share-sorted — the SAME shaping as
  // readDashboardView, so the memo and the dashboard never disagree.
  const capabilityCoverage = [...coverageCounts.entries()]
    .filter(([, c]) => c.withState >= SEGMENT_MIN_PEOPLE_TO_NAME)
    .map(([slug, c]) => ({
      label: capabilityLabels.get(slug) ?? slug,
      mastered: c.mastered,
      total: c.withState,
    }))
    .sort((a, b) => b.mastered / b.total - a.mastered / a.total || a.label.localeCompare(b.label));

  const movement = computeRecentMovement({
    today,
    spendReportedRecords: spendRows,
    activeDayRecords: activeDayRows,
    identities,
  });
  const attribution = computeAttributionTrend(activeDayRows);

  return composeExecReport({
    monthKey,
    orgName,
    maturity,
    spend,
    attribution,
    // Attribution is left OFF the narrative inputs — the memo carries the
    // honesty-gap trend as its own line, so the narrative close would double it.
    narrative: { movement, agentic: maturity.numbers.agenticShare.agentic },
    capabilityCoverage,
  });
}
