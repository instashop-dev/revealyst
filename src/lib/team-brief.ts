import type { CapabilityHistoryRow } from "./capability-history";
import type { CapabilityCoverageRow } from "./capability-coverage";
import {
  renderTeamInsight,
  type RenderableTeamInsight,
} from "./team-insights-glossary";

// PURE weekly team-brief composition (TCI Phase 2-F, ADR 0050). The manager
// brief is a SECTION of the existing weekly digest (no new state table — the
// digest's per-user week-CAS already dedupes a send; a second lane would need a
// schema change, so we fold the brief in for manager recipients instead). This
// composer is aggregate-ONLY: it receives coverage rows, history rows, open
// insights, team score lines, and a connection count — never a person id. Every
// number is built from the SAME sources the team dashboard renders (the shared
// `buildCapabilityCoverage`, the ADR-0046 history, the ADR-0048 feed), so a
// shared-source parity test can pin brief == dashboard for the same inputs.

export type TeamBriefMovement = {
  label: string;
  direction: "up" | "down" | "flat";
  masteredNow: number;
  masteredBefore: number;
};

export type TeamBriefSection = {
  /** The maturity headline: the team's aggregate score snapshot (the same
   * adoption/fluency/efficiency values the dashboard team-health section and
   * the digest's own Score trends show). */
  headline: { label: string; value: number | null }[];
  /** Capability coverage counts (floored, count-only) — dashboard parity. */
  coverage: { label: string; mastered: number; total: number }[];
  /** Period-over-period capability movement from team_capability_history. */
  movement: TeamBriefMovement[];
  /** The open insight feed, rendered to plain-English titles (count-only). */
  insights: { title: string; severity: string }[];
  /** Honest one-line data-confidence disclosure. */
  dataConfidenceLine: string;
};

export type ComposeTeamBriefInput = {
  headline: { label: string; value: number | null }[];
  coverage: readonly CapabilityCoverageRow[];
  /** MIN_PEOPLE-floored, org-wide history rows, oldest period first (the same
   * `capabilityGrowth` the dashboard growth card renders). */
  history: readonly CapabilityHistoryRow[];
  /** The open insight feed rows (category + count-only params). */
  insights: readonly RenderableTeamInsight[];
  /** Severity string carried alongside each insight (for the brief's tag). */
  insightSeverities: readonly string[];
  /** Capability slug → display label. */
  labelFor: (slug: string) => string;
  /** Count of currently-connected tools — the data-confidence line. */
  connectedCount: number;
};

function toolWord(n: number): string {
  return n === 1 ? "tool" : "tools";
}

/**
 * Compose the team-brief section from aggregate inputs. Returns null when there
 * is nothing worth a brief (no coverage, no movement, no insights) so the
 * caller can omit the section entirely rather than mail an empty shell. Pure.
 */
export function composeTeamBrief(
  input: ComposeTeamBriefInput,
): TeamBriefSection | null {
  const coverage = input.coverage.map((c) => ({
    label: c.label,
    mastered: c.mastered,
    total: c.total,
  }));

  // Movement: the two latest periods per capability from the floored history
  // (rows are oldest-first). Only capabilities with ≥2 periods yield a movement
  // row — a single period is not a trend.
  const bySlug = new Map<string, CapabilityHistoryRow[]>();
  for (const r of input.history) {
    const list = bySlug.get(r.capabilitySlug) ?? [];
    list.push(r);
    bySlug.set(r.capabilitySlug, list);
  }
  const movement: TeamBriefMovement[] = [];
  for (const [slug, rows] of bySlug) {
    if (rows.length < 2) continue;
    const now = rows[rows.length - 1];
    const before = rows[rows.length - 2];
    movement.push({
      label: input.labelFor(slug),
      direction:
        now.masteredCount > before.masteredCount
          ? "up"
          : now.masteredCount < before.masteredCount
            ? "down"
            : "flat",
      masteredNow: now.masteredCount,
      masteredBefore: before.masteredCount,
    });
  }
  movement.sort((a, b) => a.label.localeCompare(b.label));

  const insights = input.insights.map((insight, i) => ({
    title: renderTeamInsight(insight, input.labelFor).title,
    severity: input.insightSeverities[i] ?? "info",
  }));

  const dataConfidenceLine =
    input.connectedCount > 0
      ? `Based on aggregate signals from ${input.connectedCount} connected ${toolWord(
          input.connectedCount,
        )}. This brief never shows any individual's data.`
      : "This brief never shows any individual's data.";

  if (coverage.length === 0 && movement.length === 0 && insights.length === 0) {
    return null;
  }

  return {
    headline: input.headline,
    coverage,
    movement,
    insights,
    dataConfidenceLine,
  };
}
