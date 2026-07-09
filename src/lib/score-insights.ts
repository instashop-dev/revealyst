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
  const rounded = Math.round(delta.delta);
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
 * Per-slug guidance text, keyed by the same rounded three-way split
 * (0–39 / 40–69 / 70–100) used for every score — NOT derived from any
 * benchmark, dataset, or "typical" org. Each string only claims what that
 * particular score measures (a slug-blind guidance string previously
 * rendered Adoption-shaped claims — "usage is broad and consistent" — under
 * Efficiency and Fluency scores too, which is a different signal for each).
 * Guidance is framing only; it never states a threshold or comparison as
 * fact (invariant b), and it never references the component breakdown UI —
 * the card adds that sentence itself, only when there is a breakdown to
 * point at (see score-card.tsx).
 */
const INTERPRET_GUIDANCE: Record<ScoreSlug, Record<ScoreTone, string>> = {
  adoption: {
    low: "There's room to build a more regular habit here, or to reach for more of what's connected.",
    building: "A habit is forming — look for ways to use AI more consistently or broaden which tools or features get used.",
    strong: "Usage is broad and consistent across the period.",
  },
  fluency: {
    low: "Breadth, depth, or how often suggestions get accepted all have room to grow here.",
    building: "Fluency is developing — usage is broadening, or suggestions are starting to land more often.",
    strong: "Usage is broad, regular, and suggestions are landing well.",
  },
  efficiency: {
    low: "Value per dollar is low relative to spend right now — that can mean low usage, but it can also mean spend is high relative to usage, so check the spend figures alongside it.",
    building: "Value per dollar is building relative to spend — usage and spend are starting to balance out.",
    strong: "Value per dollar is strong relative to spend — accepted output and engagement are high for what's being spent.",
  },
};

export function interpretScore(
  value: number,
  slug: ScoreSlug,
): { tone: ScoreTone; guidance: string } {
  const tone: ScoreTone = value < 40 ? "low" : value < 70 ? "building" : "strong";
  return { tone, guidance: INTERPRET_GUIDANCE[slug][tone] };
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
  /** Caller passes a display label (e.g. `vendorLabel(c.vendor)`), never the
   * raw vendor slug — this function must not interpolate an internal slug
   * into user-facing copy. "paused" connections surface as an "info" item
   * (syncing is intentionally stopped, not broken); "error" stays "action". */
  connections: { id: string; label: string; status: "error" | "paused" }[];
  unresolvedSubjects?: number;
  gaps: { kind: string; detail?: string }[];
  sharedAccountCount: number;
  scoreDrops: { slug: ScoreSlug; delta: number }[];
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

  const unresolved = input.unresolvedSubjects ?? 0;
  if (unresolved > 0) {
    items.push({
      severity: "action",
      title: "Unresolved usage found",
      body: `${unresolved} account${unresolved === 1 ? "" : "s"} from your tools ${unresolved === 1 ? "isn't" : "aren't"} linked to a person yet, so Adoption, Fluency, and Efficiency can't compute for ${unresolved === 1 ? "it" : "them"}.`,
      href: "/reconcile",
      impact: 50 + unresolved,
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
    items.push({
      severity: "info",
      title: `${label} dropped`,
      body: `${label} fell ${roundedDrop} point${roundedDrop === 1 ? "" : "s"} versus the previous period of the same kind.`,
      impact: roundedDrop,
    });
  }

  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "action" ? -1 : 1;
    return b.impact - a.impact;
  });

  return items.map(({ impact: _impact, ...rest }) => rest);
}
