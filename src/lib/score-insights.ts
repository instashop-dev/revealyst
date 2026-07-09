import type { PeriodGrain } from "../contracts/scores";
import type { ScoreComponent } from "../contracts/scores";
import type { DefinitionRow, ScoreRow } from "./dashboard-read";
import type { ScoreTrendPoint } from "./dashboard-trends";
import {
  componentLabel,
  describeCalculation,
  HONESTY_GAP_GLOSSARY,
  type HonestyGapKind,
  type ScoreSlug,
} from "./metrics-glossary";

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
export function deriveDelta(points: readonly ScoreTrendPoint[]): DeltaResult {
  if (points.length < 2) {
    return { kind: "first" };
  }
  const sorted = [...points].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const previous = sorted[sorted.length - 2];
  const current = sorted[sorted.length - 1];
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

// ─── Person-level delta ───

/**
 * The latest person-level score for `slug`/`grain` among `prevRows` (rows
 * from the PREVIOUS period only — the caller fetches that window). Returns
 * `null` when absent, never 0 — absence of a prior score is not "no change",
 * it's "nothing to compare against" (same honesty rule the engine applies to
 * missing metric rows).
 */
export function personDelta(
  prevRows: readonly ScoreRow[],
  definitions: readonly DefinitionRow[],
  slug: ScoreSlug,
  grain: PeriodGrain,
): number | null {
  const defIds = new Set(
    definitions.filter((d) => d.slug === slug).map((d) => d.id),
  );
  const matches = prevRows.filter(
    (row) =>
      row.subjectLevel === "person" &&
      row.periodGrain === grain &&
      defIds.has(row.definitionId),
  );
  if (matches.length === 0) {
    return null;
  }
  const latest = matches.reduce((best, row) =>
    row.periodEnd > best.periodEnd ? row : best,
  );
  return latest.value;
}

// ─── Reading bands ───

export type ScoreTone = "low" | "building" | "strong";

/**
 * Presentational reading bands over the 0–100 score range — a rounded
 * three-way split (0–39 / 40–69 / 70–100), NOT derived from any benchmark,
 * dataset, or "typical" org. Guidance text is framing only; it never states
 * a threshold or comparison as fact (invariant b).
 */
export function interpretScore(value: number): { tone: ScoreTone; guidance: string } {
  if (value < 40) {
    return {
      tone: "low",
      guidance:
        "There's room to build a more regular habit here — the component breakdown below shows which part is lowest.",
    };
  }
  if (value < 70) {
    return {
      tone: "building",
      guidance: "A habit is forming — look for ways to broaden which tools or features get used.",
    };
  }
  return {
    tone: "strong",
    guidance: "Usage is broad and consistent across the period — keep an eye on the component breakdown for anything trending down.",
  };
}

// ─── Component detail rows ───

export type ComponentDetailRow = {
  key: string;
  label: string;
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
    const entry = breakdown?.[component.key];
    if (isBreakdownEntry(entry)) {
      return {
        key: component.key,
        label,
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
};

/** A same-grain score drop below this many points is treated as worth a
 * callout. Presentational threshold only — not a benchmark, not derived from
 * any dataset; purely "is this drop big enough to be worth surfacing above
 * the fold." Adjustable without changing any stored data. */
const MEANINGFUL_SCORE_DROP = 10;

type ScoredAttentionItem = AttentionItem & { impact: number };

/**
 * Builds the "what needs attention" list from dashboard-view inputs. Ordered
 * by severity (`action` before `info`), then by a presentational impact
 * score within each severity tier — not part of the returned shape. Only the
 * single largest same-grain score drop is surfaced, and only when it clears
 * `MEANINGFUL_SCORE_DROP`; smaller drops are noise at this altitude.
 */
export function deriveAttention(input: {
  erroredConnections: { id: string; vendor: string }[];
  unresolvedSubjects?: number;
  gaps: { kind: string; detail?: string }[];
  sharedAccountCount: number;
  scoreDrops: { slug: ScoreSlug; delta: number }[];
}): AttentionItem[] {
  const items: ScoredAttentionItem[] = [];

  for (const connection of input.erroredConnections) {
    items.push({
      severity: "action",
      title: `${connection.vendor} connection needs attention`,
      body: `The ${connection.vendor} connection has been failing to sync — its numbers may be stale until it's reconnected.`,
      href: "/connections",
      impact: 100,
    });
  }

  const unresolved = input.unresolvedSubjects ?? 0;
  if (unresolved > 0) {
    items.push({
      severity: "action",
      title: "Unresolved usage found",
      body: `${unresolved} account${unresolved === 1 ? "" : "s"} from your tools ${unresolved === 1 ? "is" : "are"} not linked to a person yet, so ${unresolved === 1 ? "it isn't" : "they aren't"} counted as active people.`,
      href: "/reconcile",
      impact: 50 + unresolved,
    });
  }

  const seenGapKinds = new Set<string>();
  for (const gap of input.gaps) {
    if (seenGapKinds.has(gap.kind)) continue;
    seenGapKinds.add(gap.kind);
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
    items.push({
      severity: "info",
      title: `${label} dropped`,
      body: `${label} fell ${Math.abs(biggestDrop.delta)} points versus the prior period of the same length.`,
      impact: Math.abs(biggestDrop.delta),
    });
  }

  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "action" ? -1 : 1;
    return b.impact - a.impact;
  });

  return items.map(({ impact: _impact, ...rest }) => rest);
}
