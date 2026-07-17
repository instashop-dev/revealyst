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

/** Consistency (review F4): a person's cadence denominator is the weeks they
 * COULD have been active — from their first active week in the window to the
 * window end — never the full window for a mid-window joiner (dividing a new
 * hire's 4 perfect weeks by 12 reads as a 33% cadence and structurally locks a
 * hiring org out of the sustained-cadence levels). Floored at this many weeks
 * so a brand-new joiner's single active week doesn't read as a perfect 100%
 * cadence off a one-week sample. */
export const CONSISTENCY_MIN_WEEKS_PER_PERSON = 4;

/** Trajectory (review F3): the prior window is a comparable quarter only when
 * resolved usage covers MOST of it — at least this many of its 12 weeks must
 * contain resolved person-day usage. An org whose data starts two weeks before
 * the current window must render "not comparable — the window predates your
 * data", never a fabricated "up a level vs the prior quarter". */
export const TRAJECTORY_MIN_PRIOR_WEEKS = 8;

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
/** A people-table row, reduced to what the maturity math needs. `createdAt`
 * lets the PRIOR window's activation divide by the people known AS OF that
 * window's end instead of today's headcount (review F3) — a person added last
 * week must not deflate last quarter's activation. A missing/null createdAt is
 * treated as always-known: dropping such a person entirely would shrink the
 * denominator and INFLATE activation, so the conservative (larger-denominator)
 * reading is the honest default. */
export type PersonLike = { createdAt?: Date | string | null };

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
  // Clamped to 100 (review F11): identity links can resolve active persons the
  // people snapshot doesn't cover (deleted rows, out-of-window createdAt
  // filtering), and a >100% activation share is never a fact worth rendering.
  const activationPct =
    knownPeople > 0
      ? Math.min(100, round1((activePeople / knownPeople) * 100))
      : null;

  // ── Breadth ──
  const breadthComponents: AxisComponent[] = [];
  if (activationPct !== null) {
    breadthComponents.push({
      key: "activation",
      value: activationPct,
      weight: BREADTH_WEIGHTS.activation,
    });
  }
  // Review F6: coverage counts only features from subjects RESOLVED to a
  // person — the same person-resolution guard its sibling multi-feature
  // component already applied (an unlinked ci-bot's features must not widen
  // "their work"). Sibling-guard diff per the CLAUDE.md gate-check pattern.
  const featureRowsInWin = input.featureRows.filter(
    (r) =>
      r.value > 0 && inWin(r.day, w) && personBySubject.has(r.subjectId),
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
  // Peak concurrency (review F2): RESOLVED person-days only — a signal row
  // whose subject has no identity link is EXCLUDED, never guessed onto a
  // person, the same rule every other component follows. (Pre-fix this was
  // the ONE unresolved-counting component, and renormalization could make an
  // unlinked ci-bot's peakConcurrency 100% of Depth.) A person-day counts as
  // concurrent when ANY of that person's subjects reported ≥2 agents at once
  // that day; the denominator is the resolved person-days that report
  // concurrency at all (many connectors emit none — absence is not zero).
  const peakByPersonDay = new Map<string, number>();
  for (const r of input.signalRows) {
    if (!inWin(r.day, w) || r.peakConcurrency === null) continue;
    const person = personBySubject.get(r.subjectId);
    if (person === undefined) continue;
    const key = `${person}|${r.day}`;
    const prev = peakByPersonDay.get(key);
    if (prev === undefined || r.peakConcurrency > prev) {
      peakByPersonDay.set(key, r.peakConcurrency);
    }
  }
  if (peakByPersonDay.size > 0) {
    let concurrent = 0;
    for (const peak of peakByPersonDay.values()) {
      if (peak >= CONCURRENCY_MIN) concurrent += 1;
    }
    depthComponents.push({
      key: "concurrency",
      value: round1((concurrent / peakByPersonDay.size) * 100),
      weight: DEPTH_WEIGHTS.concurrency,
    });
  }
  const depth = blend(depthComponents);

  // ── Consistency ──
  // Mean over active people of (distinct active weeks ÷ the weeks that person
  // COULD have been active). Review F4: the per-person denominator runs from
  // that person's FIRST active week in the window to the window end — capped
  // at the window length, floored at CONSISTENCY_MIN_WEEKS_PER_PERSON — so a
  // mid-window joiner with a perfect cadence since they started scores as
  // steady, not as "absent for the weeks before they existed". Dividing every
  // person by the full window structurally locked a hiring org out of the
  // sustained-cadence levels.
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
    const windowEndWeek = weekStartUtc(w.to);
    const weekMs = 7 * DAY_MS;
    let ratioSum = 0;
    for (const set of weeksByPerson.values()) {
      const firstWeek = [...set].sort()[0];
      const weeksSinceFirst =
        Math.round(
          (new Date(`${windowEndWeek}T00:00:00Z`).getTime() -
            new Date(`${firstWeek}T00:00:00Z`).getTime()) /
            weekMs,
        ) + 1;
      const denom = Math.min(
        totalWeeks,
        Math.max(CONSISTENCY_MIN_WEEKS_PER_PERSON, weeksSinceFirst),
      );
      ratioSum += Math.min(1, set.size / denom);
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
  // Amplified (L4): sustained cadence + real depth on L3, AND (review F2) the
  // depth blend must contain a MEASURED agentic-share component — depth
  // renormalization means a lone concurrency or multi-feature component could
  // otherwise carry the whole axis, and "Amplified" claims agentic use. The
  // component only exists when ≥1 resolved agentic person-day was measured.
  const hasMeasuredAgentic =
    axes.depth.available &&
    axes.depth.components.some((c) => c.key === "agentic_share");
  if (
    level === 3 &&
    hasMeasuredAgentic &&
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
  // Withheld (notComparable) in two cases: NO resolved usage in the prior
  // window ("insufficientHistory" — can't distinguish "org didn't exist yet"
  // from "measured zero"), or resolved usage covering FEWER than
  // TRAJECTORY_MIN_PRIOR_WEEKS of its weeks ("partialPrior" — the window
  // predates most of the data, so a "quarter" comparison would fabricate a
  // rise out of the org's own onboarding, review F3).
  | { kind: "notComparable"; reason: "insufficientHistory" | "partialPrior" }
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
  /** Review F8: true when the freshest successful sync predates the ENTIRE
   * report window — the window's silence is then unobserved, not measured, so
   * `level` is withheld (null) rather than rendered as a confident "Dormant"
   * off data we don't have. */
  stale: boolean;
};

export type PlateauNumber =
  | { confidence: "directional"; kind: "insufficient"; weeks: number }
  // Review F1: the freshest successful sync predates the start of the recent
  // half being judged — those weeks are UNOBSERVED, not measured zeros, so
  // the growth/plateau verdict is withheld (a stale connector must never
  // render as a collapse OR mask one).
  | { confidence: "directional"; kind: "stale"; weeks: number }
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
  /** Review F8: freshest sync predates the entire window — level withheld,
   * surfaces render the stale state instead of a confident low level. */
  stale: boolean;
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

/** Every complete-week Monday wholly inside [from,to], chronological (a week
 * counts only when both its Monday and Sunday lie within the window; partial
 * endpoint weeks are dropped so a lone partial week can't read as a collapse
 * or a spike). */
function completeWeekMondays(w: Window): string[] {
  let monday = weekStartUtc(w.from);
  if (monday < w.from) monday = addDays(monday, 7);
  const mondays: string[] = [];
  while (addDays(monday, 6) <= w.to) {
    mondays.push(monday);
    monday = addDays(monday, 7);
  }
  return mondays;
}

/** Per-complete-week person-day counts over the window, chronological, one
 * entry per complete week — ZERO-FILLED (review F1): a complete in-window week
 * with no person-day rows is a MEASURED ZERO for a count series, never an
 * omitted point. (Omitting made a dead month read as "Growing" because only
 * the populated early weeks survived into the recent half.) Whether that zero
 * is trustworthy — i.e. whether the connector actually synced those weeks —
 * is a separate staleness gate applied by the caller against `dataAsOf`. */
function weeklyPersonDayCounts(
  personDayKeys: Set<string>,
  mondays: readonly string[],
): number[] {
  const byWeek = new Map<string, number>(mondays.map((m) => [m, 0]));
  for (const key of personDayKeys) {
    const day = key.slice(key.indexOf("|") + 1);
    const week = weekStartUtc(day);
    const prev = byWeek.get(week);
    if (prev !== undefined) byWeek.set(week, prev + 1);
  }
  return mondays.map((m) => byWeek.get(m)!);
}

// ─── The pure composite ───────────────────────────────────────────────────────

export type MaturityInput = {
  /** Inclusive window end anchor — "today" (partial). Windows end yesterday. */
  windowTo: string;
  /** The org's people rows (see PersonLike): the CURRENT window's activation
   * divides by people known as of its end; the PRIOR window's by people known
   * as of ITS end (via createdAt) — review F3. */
  people: readonly PersonLike[];
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

/** YYYY-MM-DD of a Date/ISO-string timestamp. */
function toDay(when: Date | string): string {
  return (when instanceof Date ? when : new Date(when)).toISOString().slice(0, 10);
}

export function computeMaturity(input: MaturityInput): MaturityView {
  const { current, prior } = maturityWindows(input.windowTo);
  const personBySubject = personBySubjectMap(input.identityLinks);

  // ── Data-as-of FIRST: the plateau staleness gate and the F8 stale-level
  // guard both key off the freshest successful sync. ──
  let dataAsOf: string | null = null;
  for (const c of input.connections) {
    if (c.lastSuccessAt === null) continue;
    const iso =
      c.lastSuccessAt instanceof Date
        ? c.lastSuccessAt.toISOString()
        : new Date(c.lastSuccessAt).toISOString();
    if (dataAsOf === null || iso > dataAsOf) dataAsOf = iso;
  }
  const dataAsOfDay = dataAsOf === null ? null : dataAsOf.slice(0, 10);

  // People known as of a window end (review F3): a person added last week must
  // not deflate last quarter's activation denominator. Missing createdAt →
  // always-known (see PersonLike doc comment).
  const knownPeopleAsOf = (day: string): number =>
    input.people.filter(
      (p) => p.createdAt === undefined || p.createdAt === null || toDay(p.createdAt) <= day,
    ).length;

  const axes = computeAxes({
    window: current,
    knownPeople: knownPeopleAsOf(current.to),
    identityLinks: input.identityLinks,
    activeDayRows: input.activeDayRows,
    agentActiveRows: input.agentActiveRows,
    featureRows: input.featureRows,
    signalRows: input.signalRows,
  });
  // Review F8: when the freshest sync predates the ENTIRE window, the window's
  // silence is unobserved, not measured — withhold the level rather than
  // rendering a confident "Dormant" off data we don't have. (dataAsOf === null
  // with no rows resolves to axes-insufficient → level null on its own.)
  const stale = dataAsOfDay !== null && dataAsOfDay < current.from;
  const level = stale ? null : mapLevel(axes);

  // ── Trajectory: recompute axes over the prior window (review F3). Withheld
  // when the prior window has NO resolved usage (can't tell "didn't exist"
  // from "measured 0" — and unresolved-only usage is not the series the axes
  // measure), OR when resolved usage covers fewer than
  // TRAJECTORY_MIN_PRIOR_WEEKS of its weeks (the window predates most of the
  // data — comparing against the org's own onboarding fabricates a rise). ──
  const priorActiveKeys = resolvedPersonDays(
    input.activeDayRows,
    prior,
    personBySubject,
  );
  const priorUsageWeeks = new Set<string>();
  for (const key of priorActiveKeys) {
    priorUsageWeeks.add(weekStartUtc(key.slice(key.indexOf("|") + 1)));
  }
  let trajectory: MaturityTrajectory;
  if (priorActiveKeys.size === 0) {
    trajectory = { kind: "notComparable", reason: "insufficientHistory" };
  } else if (priorUsageWeeks.size < TRAJECTORY_MIN_PRIOR_WEEKS) {
    trajectory = { kind: "notComparable", reason: "partialPrior" };
  } else {
    const priorAxes = computeAxes({
      window: prior,
      knownPeople: knownPeopleAsOf(prior.to),
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
    stale,
  };

  // ── Number 4: plateau flag (directional, own slope check) ──
  const currentActiveKeys = resolvedPersonDays(
    input.activeDayRows,
    current,
    personBySubject,
  );
  const weekMondays = completeWeekMondays(current);
  let plateau = computePlateau(
    weeklyPersonDayCounts(currentActiveKeys, weekMondays),
  );
  // Review F1 staleness gate: if the freshest successful sync predates the
  // start of the recent half being judged, that half's zero-filled weeks are
  // UNOBSERVED, not measured silence — withhold the verdict. A stale
  // connector must never render as a collapse (or mask one as "Growing").
  if (plateau.kind === "measured") {
    const half = Math.floor(weekMondays.length / 2);
    const recentHalfStart = weekMondays[weekMondays.length - half];
    if (dataAsOfDay === null || dataAsOfDay < recentHalfStart) {
      plateau = { confidence: "directional", kind: "stale", weeks: plateau.weeks };
    }
  }

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

  // ── Number 8: agentic share (measured, reused). Review F7: windowTo is
  // `current.to` (yesterday), NOT today — computeAgenticAdoption's own 84-day
  // window then aligns exactly with the report's current window, so this card
  // can never contradict the depth axis computed over the same rows. ──
  const agenticShare: AgenticShareNumber = {
    confidence: "measured",
    agentic: computeAgenticAdoption({
      agentActiveRows: input.agentActiveRows,
      activeDayRows: input.activeDayRows,
      identityLinks: [...input.identityLinks],
      windowTo: current.to,
    }),
  };

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
    stale,
  };
}

// ─── The DB-touching reader (ONE flat Promise.all — round-trip depth 1, G10) ──

type MetricRecordRows = Awaited<ReturnType<OrgScope["metrics"]["records"]>>;
type ScoreResultRows = Awaited<ReturnType<OrgScope["scores"]["results"]>>;

/**
 * JS replica of `scores.results()`'s SQL period predicate — the ONE place it
 * lives (the shared-read pass slices one wide score read per page into what
 * each consumer's narrow read would have returned; hand-copying the
 * comparison per call site is how the slices drift). periodStart ≥ from AND
 * periodEnd ≤ to, optional subjectLevel equality — keep in lockstep with
 * src/db/org-scope/scores.ts `results()`.
 */
export function sliceScoreRows<
  T extends { subjectLevel: string; periodStart: string; periodEnd: string },
>(
  rows: readonly T[],
  filter: { from: string; to: string; subjectLevel?: string },
): T[] {
  return rows.filter(
    (r) =>
      (filter.subjectLevel === undefined ||
        r.subjectLevel === filter.subjectLevel) &&
      r.periodStart >= filter.from &&
      r.periodEnd <= filter.to,
  );
}

/**
 * The union read windows the companion pages (/dashboard Today, /growth)
 * share with readMaturityView — ONE definition so the pages and the perf
 * harness that pins their query budget can never drift apart:
 *  - metricFrom/metricTo: active_day + agent_active span (maturity fullSpan
 *    ∪ the agentic window ending today).
 *  - spendFrom/spendTo: spend_cents span — the upper bound is the CURRENT
 *    MONTH'S END, not today, because dashboardSummary's replaced direct read
 *    ran to period.periodEnd and future-dated rows (e.g. a clock-skewed
 *    agent ingest) must keep counting toward "Spend this month".
 *  - scoreFrom/scoreTo: score-row span covering the delta months AND
 *    maturity's team-score window.
 * All comparisons are lexicographic on YYYY-MM-DD (safe by construction).
 */
export function sharedCompanionReadSpans(input: {
  today: string;
  agenticFrom: string;
  period: { periodStart: string; periodEnd: string };
  prevPeriod: { periodStart: string; periodEnd: string };
}): {
  metricFrom: string;
  metricTo: string;
  spendFrom: string;
  spendTo: string;
  scoreFrom: string;
  scoreTo: string;
} {
  const windows = maturityWindows(input.today);
  const metricFrom =
    windows.fullSpan.from < input.agenticFrom
      ? windows.fullSpan.from
      : input.agenticFrom;
  return {
    metricFrom,
    metricTo: input.today,
    spendFrom: metricFrom,
    spendTo:
      input.period.periodEnd > input.today ? input.period.periodEnd : input.today,
    scoreFrom:
      windows.fullSpan.from < input.prevPeriod.periodStart
        ? windows.fullSpan.from
        : input.prevPeriod.periodStart,
    scoreTo:
      input.period.periodEnd > windows.current.to
        ? input.period.periodEnd
        : windows.current.to,
  };
}

/**
 * Optional pre-fetched inputs (the `dashboardSummary` prefetched pattern):
 * the /dashboard and /growth pages already fetch several of the SAME tables
 * this reader needs in their own depth-1 batch, so they hand the in-flight
 * promises in here instead of paying a duplicate ~one-round-trip-each read
 * per table. Every prefetched row set may be WIDER than this reader's own
 * window/filters — each is sliced below to EXACTLY what the direct read
 * would have returned (same day span, same dim filter, same score-row
 * period/level predicate), so output is byte-identical either way.
 */
export type MaturityPrefetched = {
  people?: ReturnType<OrgScope["people"]["list"]>;
  identities?: ReturnType<OrgScope["identities"]["all"]>;
  connections?: ReturnType<OrgScope["connections"]["list"]>;
  /** `active_day` metric rows covering at least `fullSpan` (any dim — the
   * dim="" slice the direct read applies in SQL happens here in JS). */
  activeDayRows?: Promise<MetricRecordRows>;
  /** `agent_active` rows covering at least `fullSpan`. */
  agentActiveRows?: Promise<MetricRecordRows>;
  /** `spend_cents` rows covering at least `fullSpan`. */
  spendRows?: Promise<MetricRecordRows>;
  /** Score rows (any subject level) covering at least
   * [fullSpan.from, current.to] by the `results()` predicate
   * (periodStart ≥ from AND periodEnd ≤ to) — sliced to team-level here. */
  scoreRows?: Promise<ScoreResultRows>;
  definitions?: ReturnType<OrgScope["scores"]["definitions"]>;
};

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
 * deterministic and testable. `prefetched` (optional) lets the caller share
 * reads it already has in flight — see {@link MaturityPrefetched}.
 */
export async function readMaturityView(
  scope: OrgScope,
  windowTo: string,
  prefetched?: MaturityPrefetched,
): Promise<MaturityView> {
  const { fullSpan, current } = maturityWindows(windowTo);
  const inSpan = (r: { day: string }) =>
    r.day >= fullSpan.from && r.day <= fullSpan.to;
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
    prefetched?.people ?? scope.people.list(),
    prefetched?.identities ?? scope.identities.all(),
    prefetched?.connections ?? scope.connections.list(),
    // The direct read filters dim="" in SQL; the prefetched (dim-unfiltered,
    // possibly wider-span) rows get the identical slice in JS.
    prefetched?.activeDayRows?.then((rows) =>
      rows.filter((r) => (r.dim ?? "") === "" && inSpan(r)),
    ) ??
      scope.metrics.records({
        metricKey: "active_day",
        from: fullSpan.from,
        to: fullSpan.to,
        dim: "",
      }),
    prefetched?.agentActiveRows?.then((rows) => rows.filter(inSpan)) ??
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
    prefetched?.spendRows?.then((rows) => rows.filter(inSpan)) ??
      scope.metrics.records({
        metricKey: "spend_cents",
        from: fullSpan.from,
        to: fullSpan.to,
      }),
    // Latest team-level adoption score feeds the modeled benchmark; the wide
    // window catches the most recent scored period regardless of grain. The
    // prefetched slice replicates the direct read's exact predicate:
    // subjectLevel=team, periodStart ≥ fullSpan.from, periodEnd ≤ current.to.
    prefetched?.scoreRows?.then((rows) =>
      sliceScoreRows(rows, {
        from: fullSpan.from,
        to: current.to,
        subjectLevel: "team",
      }),
    ) ??
      scope.scores.results({
        subjectLevel: "team",
        from: fullSpan.from,
        to: current.to,
      }),
    prefetched?.definitions ?? scope.scores.definitions(),
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
    people,
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
