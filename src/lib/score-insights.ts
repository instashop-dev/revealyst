import type { PeriodGrain } from "../contracts/scores";
import type { ScoreComponent } from "../contracts/scores";
import type { SpikeSignal } from "./anomaly";
import { plateauAttentionCopy, spikeAttentionCopy } from "./anomaly-glossary";
import {
  COACHING_GUIDANCE_SUFFIX,
  findCoachingRecommendation,
  type CoachingRecommendation,
} from "./coaching-recommendations";
import type { PlateauResult } from "./plateau";
import type { DefinitionRow, ScoreRow } from "./dashboard-read";
import type { ScoreTrendPoint } from "./dashboard-trends";
import {
  componentLabel,
  describeCalculation,
  HONESTY_GAP_GLOSSARY,
  SCORE_GLOSSARY,
  type HonestyGapKind,
  type ScoreSlug,
} from "./metrics-glossary";
import { vendorLabel } from "./vendor-labels";

// Pure derivation helpers for the metrics-UX redesign (score deltas,
// per-person deltas, reading bands, component-detail rows, and the
// "what needs attention" list). No React, no I/O.

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ─── Score-trend delta ───

export type DeltaResult =
  | { kind: "delta"; current: number; previous: number; delta: number; previousPeriodLabel: string }
  | { kind: "first" }
  | { kind: "notComparable"; reason: "grain" | "definitionVersion" };

function periodLabel(point: ScoreTrendPoint): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return point.periodStart === point.periodEnd
    ? fmt(point.periodStart)
    : `${fmt(point.periodStart)}–${fmt(point.periodEnd)}`;
}

/**
 * Compares the last two points of one score's trend (chronological — the
 * caller passes a single ScoreTrend's `points`, already one slug).
 *
 * `ScoreTrendPoint` (src/lib/dashboard-trends.ts) carries `periodGrain` and
 * `definitionVersion` straight from the stored score_results/definition
 * rows, so comparability is an exact check, not a heuristic: a grain change
 * (week vs. month vs. rolling_28d) or a definition-version change within the
 * same slug both fail safe into `notComparable` rather than being diffed as
 * if they were the same measurement.
 */
/** The ONE pair-selection rule every "compare against the previous period"
 * surface shares: sort by periodEnd, take the last two. `deriveDelta` and
 * `teamScoreDropAttribution` both go through here, so the pair a delta was
 * computed from and the pair a drop's driver is diagnosed from can never be
 * two different pairs (F1.3). */
function lastTwoByPeriodEnd<T extends { periodEnd: string }>(
  rows: readonly T[],
): { previous: T; current: T } | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return {
    previous: sorted[sorted.length - 2],
    current: sorted[sorted.length - 1],
  };
}

export function deriveDelta(points: readonly ScoreTrendPoint[]): DeltaResult {
  const pair = lastTwoByPeriodEnd(points);
  if (!pair) {
    return { kind: "first" };
  }
  const { previous, current } = pair;
  if (previous.periodGrain !== current.periodGrain) {
    return { kind: "notComparable", reason: "grain" };
  }
  if (previous.definitionVersion !== current.definitionVersion) {
    return { kind: "notComparable", reason: "definitionVersion" };
  }
  return {
    kind: "delta",
    current: current.value,
    previous: previous.value,
    delta: round4(current.value - previous.value),
    previousPeriodLabel: periodLabel(previous),
  };
}

export type FormattedDelta = {
  text: string;
  direction: "up" | "down" | "none";
  srText: string;
};

/**
 * Formats an already-narrowed `{ kind: "delta" }` result into display text —
 * integer-rounded signed magnitude ("+6"/"-4"), an accessible direction, and
 * a full-sentence screen-reader string. A round-to-zero delta is direction
 * "none" with text "no change" — NEVER an up-arrow "+0", which would claim a
 * change that didn't happen. Callers with a full `DeltaResult` narrow to this
 * kind first (the "first"/"notComparable" kinds render their own copy, not a
 * magnitude). "Previous period" phrasing is used consistently here — never
 * "prior period of the same length".
 */
export function formatDelta(
  delta: Extract<DeltaResult, { kind: "delta" }>,
): FormattedDelta {
  // Symmetric half-away-from-zero rounding, NOT Math.round directly:
  // Math.round(-0.5) is -0 (JS rounds .5 toward +Infinity), which would make
  // a -0.5 delta render as "no change" while +0.5 renders "▲ +1" — an
  // asymmetric honesty bug, not just a cosmetic one.
  const rounded = Math.sign(delta.delta) * Math.round(Math.abs(delta.delta));
  const direction: FormattedDelta["direction"] =
    rounded > 0 ? "up" : rounded < 0 ? "down" : "none";
  const text =
    direction === "none" ? "no change" : `${rounded > 0 ? "+" : ""}${rounded}`;
  const srText =
    direction === "none"
      ? `Score is unchanged versus the previous period (${delta.previousPeriodLabel}).`
      : `Score ${direction === "up" ? "increased" : "decreased"} by ${Math.abs(rounded)} point${
          Math.abs(rounded) === 1 ? "" : "s"
        } versus the previous period (${delta.previousPeriodLabel}).`;
  return { text, direction, srText };
}

// ─── Person-level delta ───

/** The ONE previous-row selection rule for the personal self-view:
 * person-level rows of this slug's known definitions at the same grain,
 * latest by periodEnd. `personDeltaResult` and `personScoreDropAttribution`
 * both go through here, so the row a personal delta was diffed against and
 * the row a drop's driver is diagnosed from can never be two different rows
 * (F1.3). */
function latestMatchingPersonRow(args: {
  prevRows: readonly ScoreRow[];
  definitions: readonly DefinitionRow[];
  slug: ScoreSlug;
  grain: PeriodGrain;
}): ScoreRow | null {
  const defIds = new Set(
    args.definitions.filter((d) => d.slug === args.slug).map((d) => d.id),
  );
  const matches = args.prevRows.filter(
    (row) =>
      row.subjectLevel === "person" &&
      row.periodGrain === args.grain &&
      defIds.has(row.definitionId),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, row) =>
    row.periodEnd > best.periodEnd ? row : best,
  );
}

/**
 * The personal self-view's delta mechanism: compares a person's current
 * score value against the latest person-level row for the same slug/grain
 * among `prevRows` (rows from the PREVIOUS period only — the caller fetches
 * that window), narrowed into the same `DeltaResult` shape `deriveDelta`
 * produces for the team dashboard's trend-based delta.
 *
 * `currentValue === null` → `null` (no delta to show at all — never a
 * fabricated comparison). No prior row among `prevRows` → `{ kind: "first" }`
 * (never 0 — absence of a prior score is not "no change", it's "nothing to
 * compare against", same honesty rule the engine applies to missing metric
 * rows). Otherwise the matched row's definition version is checked against
 * `currentVersion`: any mismatch, OR the matched row's definition being
 * unresolvable (a dangling `definitionId`), OR `currentVersion` itself being
 * `undefined` all fail SAFE into `{ kind: "notComparable", reason:
 * "definitionVersion" }` — a dangling/unknown version must never silently
 * produce a delta as if it were a same-definition comparison.
 */
export function personDeltaResult(args: {
  currentValue: number | null;
  currentVersion: number | undefined;
  prevRows: readonly ScoreRow[];
  definitions: readonly DefinitionRow[];
  slug: ScoreSlug;
  grain: PeriodGrain;
  previousPeriodLabel: string;
}): DeltaResult | null {
  if (args.currentValue === null) {
    return null;
  }
  const latest = latestMatchingPersonRow(args);
  if (!latest) {
    return { kind: "first" };
  }
  const previousVersion = args.definitions.find(
    (d) => d.id === latest.definitionId,
  )?.version;
  if (
    args.currentVersion === undefined ||
    previousVersion === undefined ||
    previousVersion !== args.currentVersion
  ) {
    return { kind: "notComparable", reason: "definitionVersion" };
  }
  return {
    kind: "delta",
    current: args.currentValue,
    previous: latest.value,
    delta: round4(args.currentValue - latest.value),
    previousPeriodLabel: args.previousPeriodLabel,
  };
}

// ─── Score-drop attribution inputs (F1.3) ───

/** The raw facts a surfaced score drop needs to (maybe) name its driving
 * component — versions + stored breakdowns of the SAME two rows the delta was
 * computed from. Built ONLY via `teamScoreDropAttribution` /
 * `personScoreDropAttribution` below, which share their pair/row selection
 * with `deriveDelta`/`personDeltaResult` — so the named driver can never
 * desynchronize from the delta shown beside it. */
export type ScoreDropAttribution = {
  currentVersion: number | undefined;
  previousVersion: number | undefined;
  currentComponents: unknown;
  previousComponents: unknown;
};

/** Team-dashboard selector: given one slug's TEAM-level score rows (any
 * order), picks the same last-two-by-periodEnd pair `deriveDelta` compares
 * (via the shared `lastTwoByPeriodEnd`) and returns their versions +
 * breakdowns. `undefined` when there's no pair — the drop then renders
 * un-attributed. */
export function teamScoreDropAttribution<
  T extends { periodEnd: string; definitionVersion: number; components: unknown },
>(rows: readonly T[]): ScoreDropAttribution | undefined {
  const pair = lastTwoByPeriodEnd(rows);
  if (!pair) return undefined;
  return {
    currentVersion: pair.current.definitionVersion,
    previousVersion: pair.previous.definitionVersion,
    currentComponents: pair.current.components,
    previousComponents: pair.previous.components,
  };
}

/** Personal self-view selector: resolves the previous row through the same
 * `latestMatchingPersonRow` selection `personDeltaResult` diffs against, and
 * its version through the same definitions list. `undefined` when there's no
 * prior row — the drop then renders un-attributed. */
export function personScoreDropAttribution(args: {
  currentVersion: number | undefined;
  currentComponents: unknown;
  prevRows: readonly ScoreRow[];
  definitions: readonly DefinitionRow[];
  slug: ScoreSlug;
  grain: PeriodGrain;
}): ScoreDropAttribution | undefined {
  const latest = latestMatchingPersonRow(args);
  if (!latest) return undefined;
  return {
    currentVersion: args.currentVersion,
    previousVersion: args.definitions.find((d) => d.id === latest.definitionId)
      ?.version,
    currentComponents: args.currentComponents,
    previousComponents: latest.components,
  };
}

// ─── Reading bands ───

export type ScoreTone = "low" | "building" | "strong";

/**
 * Per-slug guidance text lives in the glossary now (`SCORE_GLOSSARY[slug]
 * .interpretBands`, src/lib/metrics-glossary.ts) — one copy source shared by
 * this card-facing helper AND the methodology page's "How to read it, by
 * range" lines, so the two surfaces can't drift into telling different
 * stories about the same score. Banded by the same rounded three-way split
 * (0–39 / 40–69 / 70–100) used for every score — NOT derived from any
 * benchmark, dataset, or "typical" org. Guidance is framing only; it never
 * states a threshold or comparison as fact (invariant b), and it never
 * references the component breakdown UI — the card adds that sentence
 * itself, only when there is a breakdown to point at (see score-card.tsx).
 */
export function interpretScore(
  value: number,
  slug: ScoreSlug,
): { tone: ScoreTone; guidance: string } {
  const tone: ScoreTone = value < 40 ? "low" : value < 70 ? "building" : "strong";
  return { tone, guidance: SCORE_GLOSSARY[slug].interpretBands[tone] };
}

// ─── Component detail rows ───

export type ComponentDetailRow = {
  key: string;
  label: string;
  /** "ratio" components are omitted (never floored to 0) when either side has
   * no rows; "plain" components floor to 0 on no rows (both intentional —
   * see src/scoring/evaluate.ts and CLAUDE.md's scoring engine rule). */
  kind: "ratio" | "plain";
  omitted: boolean;
  raw?: number;
  normalized?: number;
  weight: number;
  contribution?: number;
  calcSimple: string;
};

type BreakdownEntry = { raw: number; normalized: number; weight: number; contribution: number };

function isBreakdownEntry(value: unknown): value is BreakdownEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.raw === "number" &&
    typeof v.normalized === "number" &&
    typeof v.weight === "number" &&
    typeof v.contribution === "number"
  );
}

/**
 * One row per component of the LIVE definition. A component present in the
 * definition but absent from the stored breakdown is `omitted: true` (the
 * ratio-honesty rule in src/scoring/evaluate.ts — a ratio missing one side
 * is left out of the breakdown entirely, never a fabricated 0) and carries
 * no raw/normalized/contribution.
 */
export function formatComponentDetail(
  defComponents: readonly ScoreComponent[],
  breakdown: Record<string, unknown> | null | undefined,
): ComponentDetailRow[] {
  return defComponents.map((component) => {
    const label = componentLabel(component.key);
    const calcSimple = describeCalculation(component).simple;
    const kind: ComponentDetailRow["kind"] = "metric" in component ? "plain" : "ratio";
    const entry = breakdown?.[component.key];
    if (isBreakdownEntry(entry)) {
      return {
        key: component.key,
        label,
        kind,
        omitted: false,
        raw: entry.raw,
        normalized: entry.normalized,
        weight: entry.weight,
        contribution: entry.contribution,
        calcSimple,
      };
    }
    return {
      key: component.key,
      label,
      kind,
      omitted: true,
      weight: component.weight,
      calcSimple,
    };
  });
}

// ─── Attention list ───

export type AttentionItem = {
  severity: "action" | "info";
  title: string;
  body: string;
  href?: string;
  /** Set on coaching-recommendation items (F1.1 — a "Guidance" affordance) and
   * on the F2.3 early-warning kinds (`anomaly` = spend/prompt spike, `plateau`
   * = declining active-people cohort). Absent (undefined) on every other item
   * kind, so `AttentionItem` stays backward-compatible. */
  kind?: "recommendation" | "anomaly" | "plateau";
};

/** A same-grain score drop below this many points is treated as worth a
 * callout. Presentational threshold only — not a benchmark, not derived from
 * any dataset; purely "is this drop big enough to be worth surfacing above
 * the fold." Adjustable without changing any stored data. */
const MEANINGFUL_SCORE_DROP = 10;

/** Coaching recommendations (F1.1) only fire for a component whose normalized
 * value sits in the bottom reading band — the same 0–39 "low" cut
 * `interpretScore` uses — AND that carries non-trivial weight. Presentational
 * thresholds only; not benchmarks, not derived from any dataset. */
const RECOMMENDATION_WEAK_NORMALIZED_MAX = 40;
const RECOMMENDATION_MIN_WEIGHT = 0.2;
/** At most this many recommendations surface at once — guidance is a nudge,
 * not a checklist; more than two buries the real alerts above it. */
const MAX_RECOMMENDATIONS = 2;

type ScoredAttentionItem = AttentionItem & { impact: number };

/** Coerces a stored `components` jsonb (typed on the team path, `unknown` on
 * the person-level raw-row path) into an iterable record — or `null` when it
 * isn't an object, so a malformed breakdown yields no driver rather than a
 * throw. */
function asComponentRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** A driver is only NAMED when its own contribution fall explains at least
 * this share of the total score drop. Without a floor, a 2-point component
 * dip would get blamed for a 32-point drop whose real cause lies elsewhere
 * (e.g. a component that stopped being measurable) — naming it would be a
 * fabricated causal claim (invariant b). Presentational threshold only. */
const DRIVER_MATERIALITY_FACTOR = 0.5;

/** F2.3 early-warning impacts. Both are "info" severity (directional — never
 * an action directive, per G2), and both sort ABOVE coaching recommendations
 * (impact 1) and the other info signals (gaps 10, shared accounts 8, drops
 * ≥10) but BELOW every "action" item (connection error 100, unresolved usage
 * 50+) — an unusual-spend flag is prominent but not a fault. A spike sorts just
 * above a plateau (a sudden money spike reads as more urgent than a slow
 * cohort slide). Presentational only. */
const ANOMALY_ITEM_IMPACT = 30;
const PLATEAU_ITEM_IMPACT = 25;

/**
 * Diagnoses what the two stored breakdowns can honestly say about a score
 * drop (F1.3). Only components MEASURED (a valid breakdown entry) on BOTH
 * sides are eligible as the `worstFaller` — and only ones that actually LOST
 * contribution (a large RISER never outranks a small faller). A component
 * measured last period but missing/invalid this period sets `newlyUnmeasured`
 * — that asymmetry is itself a knowable fact the drop copy states instead of
 * guessing a driver (a comparison with a vanished component can't honestly
 * rank fallers). Returns `null` when either record is malformed. Version
 * comparability is the caller's gate (a cross-definition-version diff must
 * never reach here).
 */
function diagnoseDropDrivers(
  currentComponents: unknown,
  previousComponents: unknown,
): {
  worstFaller: { key: string; contributionDelta: number } | null;
  newlyUnmeasured: boolean;
} | null {
  const current = asComponentRecord(currentComponents);
  const previous = asComponentRecord(previousComponents);
  if (!current || !previous) return null;
  let worstFaller: { key: string; contributionDelta: number } | null = null;
  let newlyUnmeasured = false;
  for (const [key, prevValue] of Object.entries(previous)) {
    if (!isBreakdownEntry(prevValue)) continue;
    const curValue = current[key];
    if (!isBreakdownEntry(curValue)) {
      // Measured last period, not measurable this period — knowable, honest,
      // and disqualifying for driver-naming (see doc comment).
      newlyUnmeasured = true;
      continue;
    }
    const contributionDelta = round4(curValue.contribution - prevValue.contribution);
    // Only a component that actually LOST contribution can drive a drop.
    if (contributionDelta >= 0) continue;
    if (!worstFaller || contributionDelta < worstFaller.contributionDelta) {
      worstFaller = { key, contributionDelta };
    }
  }
  return { worstFaller, newlyUnmeasured };
}

export type AttentionConnection = { label: string; status: "error" | "paused" };

/**
 * Shapes a raw connections list into `deriveAttention`'s `connections`
 * input — the identical `.filter(status is error/paused).map(...)` chain
 * both dashboard/page.tsx call sites (personal self-view and team overview)
 * used to repeat verbatim. `id` is dropped from the output shape: neither
 * this function nor `deriveAttention` ever read it, only `label`/`status`.
 */
export function connectionAttentionInputs(
  connections: { vendor: string; status: string; id: string }[],
): AttentionConnection[] {
  return connections
    .filter((c) => c.status === "error" || c.status === "paused")
    .map((c) => ({
      label: vendorLabel(c.vendor),
      status: c.status as "error" | "paused",
    }));
}

/**
 * Builds the "what needs attention" list from dashboard-view inputs. Ordered
 * by severity (`action` before `info`), then by a presentational impact
 * score within each severity tier — not part of the returned shape. Only the
 * single largest same-grain score drop is surfaced, and only when it clears
 * `MEANINGFUL_SCORE_DROP`; smaller drops are noise at this altitude.
 */
export function deriveAttention(input: {
  /** Caller passes a display label (e.g. via `connectionAttentionInputs`),
   * never the raw vendor slug — this function must not interpolate an
   * internal slug into user-facing copy. "paused" connections surface as an
   * "info" item (syncing is intentionally stopped, not broken); "error"
   * stays "action". */
  connections: AttentionConnection[];
  /** The unresolved-usage/reconcile callout's gate lives IN HERE, not in how
   * the caller shapes its input — see CLAUDE.md's gate-check finding
   * pattern ("a new call site forgot a guard its siblings already had").
   * Passing the raw facts and gating centrally means a future caller can't
   * silently ship the callout without the admin-only, no-scores-yet guard
   * simply by forgetting to replicate the ternary a sibling call site used. */
  unresolvedUsage?: { count: number; viewerIsAdmin: boolean; scoresExist: boolean };
  gaps: { kind: string; detail?: string }[];
  sharedAccountCount: number;
  /** F1.3 — each drop may optionally carry the versions + breakdowns of the
   * two rows its delta was computed from (built via `teamScoreDropAttribution`
   * / `personScoreDropAttribution`, which share their row selection with the
   * delta helpers). Gating is central, here (not the caller's): a driver is
   * named only when `currentVersion === previousVersion` (the `notComparable`
   * discipline), measured on both sides, AND material (its own fall explains
   * ≥ `DRIVER_MATERIALITY_FACTOR` of the drop). A component measured last
   * period but not this period yields the honest stopped-being-measurable
   * copy instead. Otherwise — and when `attribution` is omitted — the plain
   * un-attributed drop copy (fully backward-compatible). */
  scoreDrops: {
    slug: ScoreSlug;
    delta: number;
    attribution?: ScoreDropAttribution;
  }[];
  /** F1.1 — per-score component rows (from `formatComponentDetail`) for the
   * scores that currently exist. Gating for coaching recommendations lives
   * HERE (measured-and-weak), not in how the caller shapes its input — same
   * "gate centrally, pass raw facts" pattern as `unresolvedUsage`. Omitted (or
   * empty) → no recommendations, so a no-scores-yet dashboard gets none. */
  scoreComponents?: { slug: ScoreSlug; components: ComponentDetailRow[] }[];
  /** F2.3 (I2) — spend/prompt spikes ALREADY gated by src/lib/anomaly.ts
   * (`detectDailySpike` handles the G5 staleness gate + the statistical
   * floors, so only genuine spikes reach here — the "gate centrally, pass raw
   * facts" pattern: the detector IS the gate). Each is a directional "info"
   * item that sorts above coaching recommendations. Aggregate/org-level only —
   * a spike is an org daily total, never a named person. Omitted/empty → no
   * anomaly items. */
  anomalies?: SpikeSignal[];
  /** F2.3 (I3) — a detected plateau (declining active-people cohort) or null.
   * The caller passes ONLY the `plateau` kind (src/lib/plateau.ts gates
   * staleness/insufficiency/no-plateau). Directional "info" item, org-level. */
  plateau?: Extract<PlateauResult, { kind: "plateau" }> | null;
}): AttentionItem[] {
  const items: ScoredAttentionItem[] = [];

  for (const connection of input.connections) {
    if (connection.status === "error") {
      items.push({
        severity: "action",
        title: `${connection.label} connection needs attention`,
        body: `The ${connection.label} connection has been failing to sync — its numbers may be stale until it's reconnected.`,
        href: "/connections",
        impact: 100,
      });
    } else {
      items.push({
        severity: "info",
        title: `${connection.label} connection paused`,
        body: `Syncing is paused for ${connection.label} — data stops updating until it's resumed.`,
        href: "/connections",
        impact: 6,
      });
    }
  }

  const unresolved = input.unresolvedUsage;
  if (
    unresolved &&
    unresolved.count > 0 &&
    unresolved.viewerIsAdmin &&
    !unresolved.scoresExist
  ) {
    items.push({
      severity: "action",
      title: "Unresolved usage found",
      body: `${unresolved.count} account${unresolved.count === 1 ? "" : "s"} from your tools ${unresolved.count === 1 ? "isn't" : "aren't"} linked to a person yet, so Adoption, Fluency, and Efficiency can't compute for ${unresolved.count === 1 ? "it" : "them"}.`,
      href: "/reconcile",
      impact: 50 + unresolved.count,
    });
  }

  // Deduped by kind+detail, not kind alone — two vendors hitting the same
  // gap kind with different details are both real, distinct facts; only an
  // exact repeat (same kind, same detail) collapses to one item.
  const seenGapKeys = new Set<string>();
  for (const gap of input.gaps) {
    const dedupeKey = `${gap.kind}::${gap.detail ?? ""}`;
    if (seenGapKeys.has(dedupeKey)) continue;
    seenGapKeys.add(dedupeKey);
    const meta = HONESTY_GAP_GLOSSARY[gap.kind as HonestyGapKind] as
      | { label: string; shortWhat: string }
      | undefined;
    items.push({
      severity: "info",
      title: meta?.label ?? gap.kind,
      body: gap.detail ?? meta?.shortWhat ?? gap.kind,
      impact: 10,
    });
  }

  if (input.sharedAccountCount > 0) {
    items.push({
      severity: "info",
      title: "Shared accounts detected",
      body: `${input.sharedAccountCount} account${input.sharedAccountCount === 1 ? "" : "s"} look${input.sharedAccountCount === 1 ? "s" : ""} like more than one person is using ${input.sharedAccountCount === 1 ? "it" : "them"} — adoption for those people is likely undercounted.`,
      href: "/reconcile",
      impact: 8,
    });
  }

  const biggestDrop = [...input.scoreDrops]
    .filter((d) => d.delta <= -MEANINGFUL_SCORE_DROP)
    .sort((a, b) => a.delta - b.delta)[0];
  if (biggestDrop) {
    const label = biggestDrop.slug[0].toUpperCase() + biggestDrop.slug.slice(1);
    const roundedDrop = Math.round(Math.abs(biggestDrop.delta));
    const points = `${roundedDrop} point${roundedDrop === 1 ? "" : "s"}`;
    // Diagnose a driver ONLY across a same-definition-version pair — a
    // version change makes contributions incomparable (invariant b), so the
    // drop is reported un-attributed rather than blamed on a component whose
    // meaning may have changed.
    const attribution = biggestDrop.attribution;
    const diagnosis =
      attribution &&
      attribution.currentVersion !== undefined &&
      attribution.previousVersion !== undefined &&
      attribution.currentVersion === attribution.previousVersion
        ? diagnoseDropDrivers(
            attribution.currentComponents,
            attribution.previousComponents,
          )
        : null;
    const plainBody = `${label} fell ${points} versus the previous period of the same kind.`;
    let body = plainBody;
    if (diagnosis?.newlyUnmeasured) {
      // Honest omission copy: a component measured last period stopped being
      // measurable this period. That asymmetry is a knowable, grounded fact —
      // and it makes ranking the measured fallers dishonest, so no driver is
      // ever named alongside it (never causal: "isn't pinned", not "caused").
      body = `${plainBody} A part of this score that was measured last period isn't measurable this period, so the drop isn't pinned on any one part.`;
    } else if (
      diagnosis?.worstFaller &&
      Math.abs(diagnosis.worstFaller.contributionDelta) >=
        DRIVER_MATERIALITY_FACTOR * Math.abs(biggestDrop.delta)
    ) {
      // Materiality floor: name the driver only when its own fall explains at
      // least DRIVER_MATERIALITY_FACTOR of the total drop — a small dip is
      // never blamed for a drop it can't account for.
      body = `${label} fell ${points} versus the previous period of the same kind — the part that dropped most was ${componentLabel(diagnosis.worstFaller.key)}.`;
    }
    items.push({
      severity: "info",
      title: `${label} dropped`,
      body,
      impact: roundedDrop,
    });
  }

  // F2.3 early warnings (I2 spikes, I3 plateau). These arrive ALREADY gated by
  // the detectors (staleness + statistical floors in anomaly.ts; staleness +
  // insufficiency in plateau.ts) — deriveAttention only formats them. Both are
  // directional "info" items sorting above coaching recommendations.
  for (const signal of input.anomalies ?? []) {
    const copy = spikeAttentionCopy(signal);
    items.push({
      severity: "info",
      kind: "anomaly",
      title: copy.title,
      body: copy.body,
      impact: ANOMALY_ITEM_IMPACT,
    });
  }
  if (input.plateau) {
    const copy = plateauAttentionCopy(input.plateau);
    items.push({
      severity: "info",
      kind: "plateau",
      title: copy.title,
      body: copy.body,
      impact: PLATEAU_ITEM_IMPACT,
    });
  }

  // Coaching recommendations (F1.1) sort BELOW every real signal: impact 1 is
  // under paused connections (6), gaps (10), shared accounts (8), and any
  // surfaced drop (≥10). Candidates are deduped by underlying SIGNAL before
  // the cap — adoption.active_days and fluency.depth read the same 0–20
  // `active_day` count (tool_coverage/breadth likewise share `feature_used`),
  // so when both are weak they'd tie and burn both slots on near-identical
  // advice, cutting distinct guidance. Weakest entry per signal group wins;
  // then at most MAX_RECOMMENDATIONS, weakest first.
  if (input.scoreComponents && input.scoreComponents.length > 0) {
    const candidates: {
      recommendation: CoachingRecommendation;
      normalized: number;
    }[] = [];
    for (const score of input.scoreComponents) {
      for (const row of score.components) {
        // Measured (not omitted) AND meaningfully weak (bottom band, non-
        // trivial weight). An omitted component has no normalized value — it's
        // "no data yet", never "measured low", so it's never coached on.
        if (row.omitted || row.normalized === undefined) continue;
        if (row.normalized >= RECOMMENDATION_WEAK_NORMALIZED_MAX) continue;
        if (row.weight < RECOMMENDATION_MIN_WEIGHT) continue;
        const recommendation = findCoachingRecommendation(score.slug, row.key);
        if (recommendation) {
          candidates.push({ recommendation, normalized: row.normalized });
        }
      }
    }
    candidates.sort((a, b) => a.normalized - b.normalized);
    const seenSignalGroups = new Set<string>();
    const distinct = candidates.filter(({ recommendation }) => {
      if (seenSignalGroups.has(recommendation.signalGroup)) return false;
      seenSignalGroups.add(recommendation.signalGroup);
      return true;
    });
    for (const { recommendation } of distinct.slice(0, MAX_RECOMMENDATIONS)) {
      items.push({
        severity: "info",
        kind: "recommendation",
        title: recommendation.title,
        body: `${recommendation.body} ${COACHING_GUIDANCE_SUFFIX}`,
        impact: 1,
      });
    }
  }

  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "action" ? -1 : 1;
    return b.impact - a.impact;
  });

  return items.map(({ impact: _impact, ...rest }) => rest);
}
