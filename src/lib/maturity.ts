import type { forOrg } from "../db/org-scope";
import {
  computeAgenticAdoption,
  type AgenticAdoption,
} from "./agentic-adoption";
import { resolveBenchmarkSource, type BenchmarkSummary } from "./benchmarks";
import { costPerUnit, type CostPerUnit } from "./spend-governance";
import {
  resolvePerPersonUsage,
  summarizeUsageConcentration,
  type UsageConcentration,
} from "./usage-distribution";
import type { MaturityLevelValue } from "./maturity-glossary";

// AI Maturity Model v1 (F2.1 / research §10) — the market's first
// telemetry-derived maturity model, composed as a PURE lib over existing
// org-scoped readers. No React, no I/O in the compute path (readMaturityView
// is the only DB-touching function and does ONE flat Promise.all, G10). No
// new tables, no new org-scope methods, NO ADR: v1 recomputes at request time
// from unpurged metric_records. If request-time compute later proves too slow,
// persisting a history table is a FUTURE ADR + G9 registration — deliberately
// not done here.
//
// Honesty invariants (invariant b / G2 / G4):
//  - Three AXES (Breadth / Depth / Consistency) are computed from MEASURED
//    usage. Each axis is a weighted blend of components; a component whose
//    ratio has no denominator (e.g. no agent-capable telemetry, no feature
//    rows) is OMITTED and the remaining weights renormalized — never floored
//    to a fabricated 0. An axis with no available component is `insufficient`,
//    not zero.
//  - The five-rung LEVEL is a MODELED mapping over UNCALIBRATED thresholds
//    (every threshold is a named const below). Surfaces label the level
//    modeled/directional; the axis numbers themselves are measured.
//  - Level L0 (Dormant) is a MEASURED low (people exist, few active), distinct
//    from `insufficient` (no people/usage to measure at all). The two never
//    collapse.
//  - Trajectory reuses the notComparable discipline: with no usage in the
//    prior window we can't tell "org didn't exist yet" from "measured zero",
//    so the comparison is withheld rather than fabricated.
//  - Group C refusals (shadow AI, ROI/time-saved, per-person quality) are
//    NEVER computed — they render as named "what we don't measure" content
//    from maturity-glossary.ts, a differentiator, not estimates.
//  - Team surfaces are aggregate-only: every number here is a count, share, or
//    org-level ratio — no named individual anywhere.

type OrgScope = ReturnType<typeof forOrg>;

// ─── Uncalibrated tuning constants (all NAMED, all directional) ──────────────

/** The trailing window each period covers: 12 whole weeks (a quarter), the
 * same grain as the agentic window so the two agree. The prior window of the
 * same length immediately precedes it and drives the QoQ trajectory. */
export const MATURITY_WINDOW_DAYS = 84;

/** Distinct in-use tool features at which the Breadth feature-coverage
 * component saturates to 100. Directional — not a calibrated target. */
export const BREADTH_FEATURE_TARGET = 6;

/** Breadth blend weights (activation is the dominant reach signal). */
export const BREADTH_WEIGHTS = { activation: 0.6, featureCoverage: 0.4 } as const;
/** Depth blend weights (agentic share is the dominant sophistication signal). */
export const DEPTH_WEIGHTS = {
  agenticShare: 0.5,
  multiFeatureDays: 0.25,
  concurrency: 0.25,
} as const;

/** Activation-percent cut points for the level base (research §10 signatures:
 * <20% Dormant, 20–50% Trial, 50–80% Adopted, >80% Embedded/Amplified). */
export const ACTIVATION_L1_MIN = 20;
export const ACTIVATION_L2_MIN = 50;
export const ACTIVATION_L3_MIN = 80;

/** Consistency an org must clear to HOLD Embedded (L3) — below it, high
 * activation without a steady weekly cadence is spiky Trial/Adopted use, so
 * the level is held at Adopted (L2). */
export const CONSISTENCY_SUSTAINED_MIN = 50;
/** Consistency + Depth an org must clear, on top of L3, to reach Amplified
 * (L4): uniform steady use AND real agentic/multi-tool depth. */
export const CONSISTENCY_AMPLIFIED_MIN = 70;
export const DEPTH_AMPLIFIED_MIN = 50;

/** A day-of-activity counts toward peak-concurrency depth when more than one
 * agent ran at once. */
const CONCURRENCY_MIN = 2;
/** A person-day counts as "multi-feature" at this many distinct features. */
const MULTI_FEATURE_MIN = 2;

/** Plateau check needs at least this many complete weeks of usage to compare a
 * recent half against an earlier half; fewer → insufficient (never a verdict
 * from a couple of weeks). */
export const PLATEAU_MIN_WEEKS = 6;
/** Below this fractional week-over-week growth between the earlier and recent
 * halves, recent usage is read as plateaued (flat or declining). Directional. */
export const PLATEAU_GROWTH_MIN = 0.05;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
/** UTC Monday (YYYY-MM-DD) of the week containing `day`. */
function weekStartUtc(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const backToMonday = (d.getUTCDay() + 6) % 7;
  return addDays(day, -backToMonday);
}

// ─── Minimal pre-fetched row shapes (structural subsets of the readers) ──────

export type IdentityLinkLike = { subjectId: string; personId: string };
export type MetricRowLike = {
  subjectId: string;
  day: string;
  value: number;
  connectionId?: string;
  sourceConnector?: string;
};
export type FeatureRowLike = {
  subjectId: string;
  day: string;
  dim: string;
  value: number;
};
export type SignalRowLike = {
  subjectId: string;
  day: string;
  peakConcurrency: number | null;
};
export type PromptRowLike = { subjectId: string; day: string; value: number };
export type ConnectionLike = {
  id: string;
  vendor: string;
  status: string;
  displayName: string;
  lastSuccessAt: Date | string | null;
};

// ─── Axis result types ───────────────────────────────────────────────────────

export type AxisComponent = { key: string; value: number; weight: number };

/** One 0–100 axis, or `insufficient` when no component had a denominator. */
export type MaturityAxis =
  | { available: false }
  | { available: true; value: number; components: AxisComponent[] };

export type MaturityAxes = {
  breadth: MaturityAxis;
  depth: MaturityAxis;
  consistency: MaturityAxis;
  /** Raw activation ratio (active people ÷ known people), 0–100 — the level
   * base and the activation CTO number both read this. null when there are no
   * known people to divide by (activation, and therefore the level, is then
   * `insufficient`, not 0). */
  activationPct: number | null;
  activePeople: number;
  knownPeople: number;
};

type Window = { from: string; to: string };

// ─── Per-window axis math ─────────────────────────────────────────────────────

function personBySubjectMap(
  links: readonly IdentityLinkLike[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of links) m.set(l.subjectId, l.personId);
  return m;
}

const inWin = (day: string, w: Window) => day >= w.from && day <= w.to;

/** Distinct `${personId}|${day}` keys for value>0 rows in the window that
 * resolve to a person (unresolved subjects are excluded, never guessed). */
function resolvedPersonDays(
  rows: readonly MetricRowLike[],
  w: Window,
  personBySubject: Map<string, string>,
): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.value <= 0 || !inWin(r.day, w)) continue;
    const person = personBySubject.get(r.subjectId);
    if (person === undefined) continue;
    keys.add(`${person}|${r.day}`);
  }
  return keys;
}

function blend(components: AxisComponent[]): MaturityAxis {
  if (components.length === 0) return { available: false };
  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  if (totalWeight <= 0) return { available: false };
  const value = round1(
    components.reduce((a, c) => a + clamp100(c.value) * c.weight, 0) /
      totalWeight,
  );
  return { available: true, value, components };
}

/** Number of whole-ish weeks the window spans (its day count ÷ 7). */
function windowWeeks(w: Window): number {
  const days =
    Math.round(
      (new Date(`${w.to}T00:00:00Z`).getTime() -
        new Date(`${w.from}T00:00:00Z`).getTime()) /
        DAY_MS,
    ) + 1;
  return Math.max(1, Math.round(days / 7));
}

export function computeAxes(input: {
  window: Window;
  knownPeople: number;
  identityLinks: readonly IdentityLinkLike[];
  activeDayRows: readonly MetricRowLike[];
  agentActiveRows: readonly MetricRowLike[];
  featureRows: readonly FeatureRowLike[];
  signalRows: readonly SignalRowLike[];
}): MaturityAxes {
  const { window: w, knownPeople } = input;
  const personBySubject = personBySubjectMap(input.identityLinks);

  // ── Active people (person-resolved active days) ──
  const activeKeys = resolvedPersonDays(input.activeDayRows, w, personBySubject);
  const activePersons = new Set<string>();
  for (const k of activeKeys) activePersons.add(k.slice(0, k.indexOf("|")));
  const activePeople = activePersons.size;
  const activationPct =
    knownPeople > 0 ? round1((activePeople / knownPeople) * 100) : null;

  // ── Breadth ──
  const breadthComponents: AxisComponent[] = [];
  if (activationPct !== null) {
    breadthComponents.push({
      key: "activation",
      value: activationPct,
      weight: BREADTH_WEIGHTS.activation,
    });
  }
  const featureRowsInWin = input.featureRows.filter(
    (r) => r.value > 0 && inWin(r.day, w),
  );
  if (featureRowsInWin.length > 0) {
    const distinctFeatures = new Set(featureRowsInWin.map((r) => r.dim));
    breadthComponents.push({
      key: "feature_coverage",
      value: clamp100((distinctFeatures.size / BREADTH_FEATURE_TARGET) * 100),
      weight: BREADTH_WEIGHTS.featureCoverage,
    });
  }
  const breadth = blend(breadthComponents);

  // ── Depth ──
  const depthComponents: AxisComponent[] = [];
  // Agentic share (person-days): agentic ÷ (active ∪ agentic) — the same
  // union-denominator definition as computeAgenticAdoption, so an agent-only
  // day whose active flag a vendor didn't co-emit still counts, and the rate
  // stays ≤ 100%. Available ONLY when agent-capable telemetry exists in the
  // window (else omitted, never a measured 0% — G4).
  const agentKeys = resolvedPersonDays(
    input.agentActiveRows,
    w,
    personBySubject,
  );
  if (agentKeys.size > 0) {
    const union = new Set(activeKeys);
    for (const k of agentKeys) union.add(k);
    if (union.size > 0) {
      depthComponents.push({
        key: "agentic_share",
        value: round1((agentKeys.size / union.size) * 100),
        weight: DEPTH_WEIGHTS.agenticShare,
      });
    }
  }
  // Multi-feature days: share of active person-days touching ≥2 distinct
  // features. Available only when feature telemetry AND active days exist.
  if (featureRowsInWin.length > 0 && activeKeys.size > 0) {
    const featuresByPersonDay = new Map<string, Set<string>>();
    for (const r of featureRowsInWin) {
      const person = personBySubject.get(r.subjectId);
      if (person === undefined) continue;
      const key = `${person}|${r.day}`;
      let set = featuresByPersonDay.get(key);
      if (!set) {
        set = new Set();
        featuresByPersonDay.set(key, set);
      }
      set.add(r.dim);
    }
    let multi = 0;
    for (const key of activeKeys) {
      if ((featuresByPersonDay.get(key)?.size ?? 0) >= MULTI_FEATURE_MIN) {
        multi += 1;
      }
    }
    depthComponents.push({
      key: "multi_feature_days",
      value: round1((multi / activeKeys.size) * 100),
      weight: DEPTH_WEIGHTS.multiFeatureDays,
    });
  }
  // Peak concurrency: share of subject-days (that report concurrency at all)
  // with ≥2 agents running at once. Available only when some signal row in the
  // window has a non-null peakConcurrency (many connectors emit none — absence
  // is not zero).
  const concurrencyDays = input.signalRows.filter(
    (r) => inWin(r.day, w) && r.peakConcurrency !== null,
  );
  if (concurrencyDays.length > 0) {
    const concurrent = concurrencyDays.filter(
      (r) => (r.peakConcurrency ?? 0) >= CONCURRENCY_MIN,
    ).length;
    depthComponents.push({
      key: "concurrency",
      value: round1((concurrent / concurrencyDays.length) * 100),
      weight: DEPTH_WEIGHTS.concurrency,
    });
  }
  const depth = blend(depthComponents);

  // ── Consistency ──
  // Mean over active people of (distinct active weeks ÷ total weeks in window).
  const totalWeeks = windowWeeks(w);
  const consistencyComponents: AxisComponent[] = [];
  if (activePeople >= 1 && totalWeeks >= 2) {
    const weeksByPerson = new Map<string, Set<string>>();
    for (const key of activeKeys) {
      const person = key.slice(0, key.indexOf("|"));
      const day = key.slice(key.indexOf("|") + 1);
      let set = weeksByPerson.get(person);
      if (!set) {
        set = new Set();
        weeksByPerson.set(person, set);
      }
      set.add(weekStartUtc(day));
    }
    let ratioSum = 0;
    for (const set of weeksByPerson.values()) {
      ratioSum += Math.min(1, set.size / totalWeeks);
    }
    consistencyComponents.push({
      key: "active_week_ratio",
      value: round1((ratioSum / weeksByPerson.size) * 100),
      weight: 1,
    });
  }
  const consistency = blend(consistencyComponents);

  return {
    breadth,
    depth,
    consistency,
    activationPct,
    activePeople,
    knownPeople,
  };
}

// ─── Level mapping (MODELED over uncalibrated thresholds) ─────────────────────

/** The placed level, or `null` when activation can't be computed (no known
 * people) — the honest `insufficient` state, NOT an L0. */
export function mapLevel(axes: MaturityAxes): MaturityLevelValue | null {
  const a = axes.activationPct;
  if (a === null) return null;
  const consistency = axes.consistency.available
    ? axes.consistency.value
    : null;
  const depth = axes.depth.available ? axes.depth.value : null;

  let level: MaturityLevelValue =
    a < ACTIVATION_L1_MIN
      ? 0
      : a < ACTIVATION_L2_MIN
        ? 1
        : a < ACTIVATION_L3_MIN
          ? 2
          : 3;

  // Embedded (L3) requires a sustained weekly cadence: without consistency
  // evidence, or below the bar, high activation is still spiky Adopted use.
  if (level === 3 && (consistency === null || consistency < CONSISTENCY_SUSTAINED_MIN)) {
    level = 2;
  }
  // Amplified (L4): sustained cadence + real agentic/multi-tool depth on L3.
  if (
    level === 3 &&
    consistency !== null &&
    consistency >= CONSISTENCY_AMPLIFIED_MIN &&
    depth !== null &&
    depth >= DEPTH_AMPLIFIED_MIN
  ) {
    level = 4;
  }
  return level;
}

// ─── Trajectory (QoQ) ─────────────────────────────────────────────────────────

function axisDelta(current: MaturityAxis, prior: MaturityAxis): number | null {
  if (!current.available || !prior.available) return null;
  return round1(current.value - prior.value);
}

export type MaturityTrajectory =
  // No usage in the prior window — can't distinguish "org didn't exist yet"
  // from "measured zero", so the comparison is withheld (notComparable).
  | { kind: "notComparable"; reason: "insufficientHistory" }
  | {
      kind: "comparable";
      priorLevel: MaturityLevelValue | null;
      currentLevel: MaturityLevelValue | null;
      /** current − prior level (both placed), or null when either is
       * insufficient. */
      levelDelta: number | null;
      breadthDelta: number | null;
      depthDelta: number | null;
      consistencyDelta: number | null;
      priorWindow: Window;
    };

// ─── The eight board numbers ─────────────────────────────────────────────────

export type ConfidenceTier =
  | "measured"
  | "modeled"
  | "directional"
  | "not_measured";

export type ActivationNumber = {
  confidence: "measured";
  activePeople: number;
  knownPeople: number;
  /** null when there are no known people to divide by (G4). */
  activationPct: number | null;
  /** Dark-seat waste is NOT derivable from existing data (no seat counts, no
   * per-seat licence cost) — surfaced as an explicit not-measured state, never
   * estimated (a differentiator, per the plan). */
  darkSeat: { confidence: "not_measured"; reason: string };
};

export type AdoptionVsBenchmarkNumber = {
  confidence: "modeled";
  benchmark: BenchmarkSummary | null;
};

export type MaturityNumber = {
  confidence: "modeled";
  level: MaturityLevelValue | null;
  axes: MaturityAxes;
  trajectory: MaturityTrajectory;
};

export type PlateauNumber =
  | { confidence: "directional"; kind: "insufficient"; weeks: number }
  | {
      confidence: "directional";
      kind: "measured";
      plateaued: boolean;
      earlierMean: number;
      recentMean: number;
      /** (recentMean − earlierMean) ÷ earlierMean, signed. */
      changePct: number;
      weeks: number;
    };

export type ConcentrationNumber = {
  confidence: "directional";
  concentration: UsageConcentration;
};

export type CostPerActiveUserNumber = {
  confidence: "measured";
  /** null (omitted) when either side of the ratio is missing (G4). */
  cost: CostPerUnit | null;
  activePeople: number;
};

export type ToolSprawlNumber = {
  confidence: "measured";
  connectedTools: number;
  activeTools: number;
  idleTools: number;
};

export type AgenticShareNumber = {
  confidence: "measured";
  agentic: AgenticAdoption;
};

export type MaturityNumbers = {
  activation: ActivationNumber;
  adoptionVsBenchmark: AdoptionVsBenchmarkNumber;
  maturity: MaturityNumber;
  plateau: PlateauNumber;
  concentration: ConcentrationNumber;
  costPerActiveUser: CostPerActiveUserNumber;
  toolSprawl: ToolSprawlNumber;
  agenticShare: AgenticShareNumber;
};

export type MaturityView = {
  /** The window the axes/level/numbers cover (ends yesterday; today is a
   * partial UTC day mid-ingestion and is excluded). */
  currentWindow: Window;
  level: MaturityLevelValue | null;
  axes: MaturityAxes;
  numbers: MaturityNumbers;
  /** Freshest successful sync across connections, ISO string — the "data as
   * of" line. null when nothing has synced. */
  dataAsOf: string | null;
};

// ─── Plateau helper (own small directional slope check — deliberately NOT
// deriveAttention / the anomaly machinery, per the F2.1 constraint) ───────────

/** Weekly person-day counts over the window's COMPLETE weeks, chronological.
 * A "plateau" splits these into an earlier and a recent half and compares
 * their means. */
export function computePlateau(weeklyPersonDays: readonly number[]): PlateauNumber {
  const weeks = weeklyPersonDays.length;
  if (weeks < PLATEAU_MIN_WEEKS) {
    return { confidence: "directional", kind: "insufficient", weeks };
  }
  const half = Math.floor(weeks / 2);
  const earlier = weeklyPersonDays.slice(0, half);
  const recent = weeklyPersonDays.slice(weeks - half);
  const mean = (xs: readonly number[]) =>
    xs.reduce((a, b) => a + b, 0) / xs.length;
  const earlierMean = round1(mean(earlier));
  const recentMean = round1(mean(recent));
  if (earlierMean <= 0) {
    // Nothing to grow FROM — not a plateau, just no earlier baseline.
    return { confidence: "directional", kind: "insufficient", weeks };
  }
  const changePct = round1(((recentMean - earlierMean) / earlierMean) * 1000) / 10;
  const plateaued = (recentMean - earlierMean) / earlierMean < PLATEAU_GROWTH_MIN;
  return {
    confidence: "directional",
    kind: "measured",
    plateaued,
    earlierMean,
    recentMean,
    changePct,
    weeks,
  };
}

/** Per-complete-week person-day counts over the window, chronological. A week
 * counts only when it lies wholly inside the window (both its Monday and its
 * Sunday within [from,to]); partial endpoint weeks are dropped so a lone
 * partial week can't read as a collapse or a spike. */
function weeklyPersonDayCounts(
  personDayKeys: Set<string>,
  w: Window,
): number[] {
  const byWeek = new Map<string, number>();
  for (const key of personDayKeys) {
    const day = key.slice(key.indexOf("|") + 1);
    const week = weekStartUtc(day);
    if (week < w.from || addDays(week, 6) > w.to) continue; // complete weeks only
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return [...byWeek.keys()].sort().map((wk) => byWeek.get(wk)!);
}

// ─── The pure composite ───────────────────────────────────────────────────────

export type MaturityInput = {
  /** Inclusive window end anchor — "today" (partial). Windows end yesterday. */
  windowTo: string;
  knownPeople: number;
  identityLinks: readonly IdentityLinkLike[];
  /** All rows below span BOTH the current and prior windows (fetched once over
   * the combined span, sliced per-window here — keeps readMaturityView at
   * round-trip depth 1). */
  activeDayRows: readonly MetricRowLike[];
  agentActiveRows: readonly MetricRowLike[];
  featureRows: readonly FeatureRowLike[];
  signalRows: readonly SignalRowLike[];
  promptRows: readonly PromptRowLike[];
  spendRows: readonly MetricRowLike[];
  connections: readonly ConnectionLike[];
  /** Latest team-level adoption score value (0–100), or null — feeds the
   * modeled benchmark comparison. */
  adoptionScore: number | null;
};

/** Current + prior windows ending at `windowTo − 1` (today excluded). */
export function maturityWindows(windowTo: string): {
  current: Window;
  prior: Window;
  fullSpan: Window;
} {
  if (!DAY_RE.test(windowTo)) {
    throw new Error(`maturityWindows expects YYYY-MM-DD, got "${windowTo}"`);
  }
  const currentTo = addDays(windowTo, -1);
  const currentFrom = addDays(currentTo, -(MATURITY_WINDOW_DAYS - 1));
  const priorTo = addDays(currentFrom, -1);
  const priorFrom = addDays(priorTo, -(MATURITY_WINDOW_DAYS - 1));
  return {
    current: { from: currentFrom, to: currentTo },
    prior: { from: priorFrom, to: priorTo },
    fullSpan: { from: priorFrom, to: currentTo },
  };
}

export function computeMaturity(input: MaturityInput): MaturityView {
  const { current, prior } = maturityWindows(input.windowTo);
  const personBySubject = personBySubjectMap(input.identityLinks);

  const axes = computeAxes({
    window: current,
    knownPeople: input.knownPeople,
    identityLinks: input.identityLinks,
    activeDayRows: input.activeDayRows,
    agentActiveRows: input.agentActiveRows,
    featureRows: input.featureRows,
    signalRows: input.signalRows,
  });
  const level = mapLevel(axes);

  // ── Trajectory: recompute axes over the prior window. Withheld when the
  // prior window has NO usage (can't tell "didn't exist" from "measured 0"). ──
  const priorActiveKeys = resolvedPersonDays(
    input.activeDayRows,
    prior,
    personBySubject,
  );
  const priorHasUsage =
    priorActiveKeys.size > 0 ||
    input.activeDayRows.some((r) => r.value > 0 && inWin(r.day, prior));
  let trajectory: MaturityTrajectory;
  if (!priorHasUsage) {
    trajectory = { kind: "notComparable", reason: "insufficientHistory" };
  } else {
    const priorAxes = computeAxes({
      window: prior,
      knownPeople: input.knownPeople,
      identityLinks: input.identityLinks,
      activeDayRows: input.activeDayRows,
      agentActiveRows: input.agentActiveRows,
      featureRows: input.featureRows,
      signalRows: input.signalRows,
    });
    const priorLevel = mapLevel(priorAxes);
    trajectory = {
      kind: "comparable",
      priorLevel,
      currentLevel: level,
      levelDelta:
        priorLevel !== null && level !== null ? level - priorLevel : null,
      breadthDelta: axisDelta(axes.breadth, priorAxes.breadth),
      depthDelta: axisDelta(axes.depth, priorAxes.depth),
      consistencyDelta: axisDelta(axes.consistency, priorAxes.consistency),
      priorWindow: prior,
    };
  }

  // ── Number 1: activation (measured) + dark-seat (not measured) ──
  const activation: ActivationNumber = {
    confidence: "measured",
    activePeople: axes.activePeople,
    knownPeople: axes.knownPeople,
    activationPct: axes.activationPct,
    darkSeat: {
      confidence: "not_measured",
      reason:
        "Idle paid-seat spend needs seat counts and per-seat licence cost, which no connected tool reports today. We don't estimate it — activation above shows who is active, not how many seats sit idle.",
    },
  };

  // ── Number 2: adoption vs benchmark (modeled fixture source) ──
  const benchmarks = resolveBenchmarkSource().forScores([
    { slug: "adoption", value: input.adoptionScore },
  ]);
  const adoptionVsBenchmark: AdoptionVsBenchmarkNumber = {
    confidence: "modeled",
    benchmark: benchmarks[0] ?? null,
  };

  // ── Number 3: maturity level + trajectory (modeled) ──
  const maturity: MaturityNumber = {
    confidence: "modeled",
    level,
    axes,
    trajectory,
  };

  // ── Number 4: plateau flag (directional, own slope check) ──
  const currentActiveKeys = resolvedPersonDays(
    input.activeDayRows,
    current,
    personBySubject,
  );
  const plateau = computePlateau(
    weeklyPersonDayCounts(currentActiveKeys, current),
  );

  // ── Number 5: concentration (directional, reused) ──
  const currentUsage = resolvePerPersonUsage({
    activeDayRows: input.activeDayRows.filter((r) => inWin(r.day, current)),
    promptRows: input.promptRows.filter((r) => inWin(r.day, current)),
    identities: [...input.identityLinks],
  });
  const concentration: ConcentrationNumber = {
    confidence: "directional",
    concentration: summarizeUsageConcentration(
      currentUsage.perPerson,
      currentUsage.excluded.unresolvedPrompts +
        currentUsage.excluded.sharedPrompts,
    ),
  };

  // ── Number 6: cost per active user (measured, reported-only, ratio-honest) ──
  const reportedCents = input.spendRows
    .filter((r) => inWin(r.day, current))
    .reduce((a, r) => a + r.value, 0);
  const costPerActiveUser: CostPerActiveUserNumber = {
    confidence: "measured",
    cost: costPerUnit(reportedCents, axes.activePeople),
    activePeople: axes.activePeople,
  };

  // ── Number 7: tool sprawl (measured) ──
  const connectedTools = input.connections.length;
  const activeConnectionIds = new Set<string>();
  for (const r of input.activeDayRows) {
    if (r.value > 0 && inWin(r.day, current) && r.connectionId) {
      activeConnectionIds.add(r.connectionId);
    }
  }
  const toolSprawl: ToolSprawlNumber = {
    confidence: "measured",
    connectedTools,
    activeTools: activeConnectionIds.size,
    idleTools: Math.max(0, connectedTools - activeConnectionIds.size),
  };

  // ── Number 8: agentic share (measured, reused directly at windowTo) ──
  const agenticShare: AgenticShareNumber = {
    confidence: "measured",
    agentic: computeAgenticAdoption({
      agentActiveRows: input.agentActiveRows,
      activeDayRows: input.activeDayRows,
      identityLinks: [...input.identityLinks],
      windowTo: input.windowTo,
    }),
  };

  // ── Data-as-of: freshest successful sync ──
  let dataAsOf: string | null = null;
  for (const c of input.connections) {
    if (c.lastSuccessAt === null) continue;
    const iso =
      c.lastSuccessAt instanceof Date
        ? c.lastSuccessAt.toISOString()
        : new Date(c.lastSuccessAt).toISOString();
    if (dataAsOf === null || iso > dataAsOf) dataAsOf = iso;
  }

  return {
    currentWindow: current,
    level,
    axes,
    numbers: {
      activation,
      adoptionVsBenchmark,
      maturity,
      plateau,
      concentration,
      costPerActiveUser,
      toolSprawl,
      agenticShare,
    },
    dataAsOf,
  };
}

// ─── The DB-touching reader (ONE flat Promise.all — round-trip depth 1, G10) ──

/**
 * Reads everything the maturity report needs in a SINGLE flat Promise.all
 * (round-trip depth 1 on Workers→Hyperdrive→Neon, the same discipline as
 * readDashboardView). Every read goes through the org-scoped repository
 * (`forOrg`); this function adds NO new org-scope method. The window-scoped
 * metric reads span BOTH the current and prior windows at once so the QoQ
 * trajectory recompute costs no extra round trip — the pure `computeMaturity`
 * slices per-window in JS.
 *
 * `windowTo` is caller-supplied (YYYY-MM-DD, UTC — "today") so the windows are
 * deterministic and testable.
 */
export async function readMaturityView(
  scope: OrgScope,
  windowTo: string,
): Promise<MaturityView> {
  const { fullSpan, current } = maturityWindows(windowTo);
  const [
    people,
    identities,
    connections,
    activeDayRows,
    agentActiveRows,
    featureRows,
    signalRows,
    promptRows,
    spendRows,
    scoreRows,
    definitions,
  ] = await Promise.all([
    scope.people.list(),
    scope.identities.all(),
    scope.connections.list(),
    scope.metrics.records({
      metricKey: "active_day",
      from: fullSpan.from,
      to: fullSpan.to,
      dim: "",
    }),
    scope.metrics.records({
      metricKey: "agent_active",
      from: fullSpan.from,
      to: fullSpan.to,
    }),
    scope.metrics.records({
      metricKey: "feature_used",
      from: fullSpan.from,
      to: fullSpan.to,
    }),
    scope.metrics.allSignals({ from: fullSpan.from, to: fullSpan.to }),
    scope.metrics.records({
      metricKey: "prompts",
      from: fullSpan.from,
      to: fullSpan.to,
    }),
    // Spend is summed over the CURRENT window only (cost-per-active-user), but
    // fetched over the full span here to keep the Promise.all uniform; the
    // pure path slices to `current`.
    scope.metrics.records({
      metricKey: "spend_cents",
      from: fullSpan.from,
      to: fullSpan.to,
    }),
    // Latest team-level adoption score feeds the modeled benchmark; the wide
    // window catches the most recent scored period regardless of grain.
    scope.scores.results({
      subjectLevel: "team",
      from: fullSpan.from,
      to: current.to,
    }),
    scope.scores.definitions(),
  ]);

  // Latest team adoption score value by periodEnd. Raw score_results carry
  // `definitionId`, not the slug, so resolve slug via the definitions map
  // (results() orders by periodStart — scan for the max periodEnd on adoption).
  const slugByDefinition = new Map(definitions.map((d) => [d.id, d.slug]));
  let adoptionScore: number | null = null;
  let latestEnd = "";
  for (const row of scoreRows) {
    if (slugByDefinition.get(row.definitionId) !== "adoption") continue;
    if (row.periodEnd >= latestEnd) {
      latestEnd = row.periodEnd;
      adoptionScore = row.value;
    }
  }

  return computeMaturity({
    windowTo,
    knownPeople: people.length,
    identityLinks: identities,
    activeDayRows,
    agentActiveRows,
    featureRows,
    signalRows,
    promptRows,
    spendRows,
    connections,
    adoptionScore,
  });
}
