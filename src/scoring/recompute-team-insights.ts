import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import type { TeamInsightRow } from "../db/org-scope/team-insights";
import { SYNC_STALE_AFTER_DAYS } from "../lib/agent-sync";
import { isUsableConnection } from "../lib/onboarding-guide";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "../lib/segments";
import {
  deriveTeamInsights,
  MAX_OPEN_INSIGHTS,
  type CapabilityPriorInput,
  type TeamInsightCandidate,
} from "../lib/team-insights";
import { CAPABILITY_STATE_CONSTANTS } from "./capability-state";
import { periodFor, previousDay } from "./periods";

// TCI Phase 2-F aggregate manager-insight reducer (ADR 0050): the I/O half of
// the feed. Runs as a PARALLEL step in the poller `score-recompute` slot AFTER
// recomputeCapabilityHistory (it reads the fresh history the rollup just wrote,
// for the period-over-period movement categories). DETERMINISTIC — NO LLM
// (tripwire): the pure `deriveTeamInsights` decides the insights; this reducer
// only supplies batch-once aggregates and applies the dismissed-exclusion + cap
// + delete-stale/upsert lifecycle.
//
// Perf (mirrors recompute-capability-history): ALL reads batched ONCE for the
// whole org — the query count is INDEPENDENT of person count and history depth.
// Idempotent: two runs with the same aggregates converge to the same open feed
// (natural-key upsert refreshes params in place; a dismissed subject stays
// dismissed and never re-opens; a resolved condition's open row is deleted).

export type TeamInsightsSummary = {
  /** OPEN insights in the feed after this pass (≤ MAX_OPEN_INSIGHTS). */
  openInsights: number;
  /** Candidates the generator produced before the dismissed-exclusion + cap. */
  candidates: number;
  periodStart: string;
};

function keyOf(category: string, subject: string): string {
  return `${category}::${subject}`;
}

export async function recomputeTeamInsights(
  db: Db,
  orgId: string,
  options: { asOfDay: string; now?: Date },
): Promise<TeamInsightsSummary> {
  const { asOfDay } = options;
  const now = options.now ?? new Date();
  const scoped = forOrg(db, orgId);
  const period = periodFor("month", asOfDay);
  const priorPeriod = periodFor("month", previousDay(period.periodStart));
  const minPeople = SEGMENT_MIN_PEOPLE_TO_NAME;

  // One batched read set for the whole org (person-count-independent):
  const [coverageMap, history, people, peopleWithState, connections, existing] =
    await Promise.all([
      scoped.mastery.coverageCounts(
        CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD,
      ),
      scoped.capabilityHistory.list(),
      scoped.people.list(),
      scoped.mastery.personIdsWithState(),
      scoped.connections.list(),
      scoped.teamInsights.list(),
    ]);

  // Prior-period mastered/represented per capability (org-wide rows, team_id
  // null) — the movement axis. From the SAME history the dashboard growth card
  // reads (shared source), so a movement insight can't disagree with the chart.
  const prior = new Map<string, CapabilityPriorInput>();
  for (const row of history) {
    if (row.teamId !== null) continue; // org-wide series only
    if (row.periodStart !== priorPeriod.periodStart) continue;
    prior.set(row.capabilitySlug, {
      capabilitySlug: row.capabilitySlug,
      masteredBefore: row.masteredCount,
      representedBefore: row.representedCount,
    });
  }

  // Connection freshness (data_incomplete): usable connections, and how many of
  // those haven't synced within the staleness window (null lastSuccess counts
  // as stale). Count-only.
  const cutoff = now.getTime() - SYNC_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const usable = connections.filter((c) => isUsableConnection(c));
  const staleConnectionCount = usable.filter((c) => {
    const at = c.lastSuccessAt
      ? c.lastSuccessAt instanceof Date
        ? c.lastSuccessAt
        : new Date(c.lastSuccessAt)
      : null;
    return at === null || at.getTime() < cutoff;
  }).length;

  const ranked = deriveTeamInsights({
    coverage: [...coverageMap.entries()].map(([capabilitySlug, c]) => ({
      capabilitySlug,
      mastered: c.mastered,
      withState: c.withState,
    })),
    prior,
    totalPeople: people.length,
    peopleWithState: peopleWithState.size,
    connectedCount: usable.length,
    staleConnectionCount,
    minPeople,
  });

  // Exclude dismissed subjects (sticky) BEFORE the cap, so a dismissal frees a
  // slot for the next-ranked candidate rather than leaving a hole. Keyed on
  // (category, subject) — the natural key minus the org/team.
  const dismissedKeys = new Set(
    existing
      .filter((r) => r.status === "dismissed")
      .map((r) => keyOf(r.category, r.subject)),
  );
  const chosen: TeamInsightCandidate[] = ranked
    .filter((c) => !dismissedKeys.has(keyOf(c.category, c.subject)))
    .slice(0, MAX_OPEN_INSIGHTS);
  const keepKeys = new Set(chosen.map((c) => keyOf(c.category, c.subject)));

  // Delete open (new/viewed) rows whose condition is no longer in the chosen
  // set — the feed reflects current reality. Dismissed rows are never deleted
  // (sticky), so they keep suppressing their subject on later runs.
  const staleOpenIds = existing
    .filter(
      (r: TeamInsightRow) =>
        r.status !== "dismissed" && !keepKeys.has(keyOf(r.category, r.subject)),
    )
    .map((r) => r.id);

  await scoped.teamInsights.deleteByIds(staleOpenIds);
  await scoped.teamInsights.upsertGenerated(
    chosen.map((c) => ({
      teamId: null,
      category: c.category,
      severity: c.severity,
      subject: c.subject,
      params: c.params,
      periodStart: period.periodStart,
    })),
  );

  return {
    openInsights: chosen.length,
    candidates: ranked.length,
    periodStart: period.periodStart,
  };
}
