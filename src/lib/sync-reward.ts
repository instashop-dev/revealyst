// SYNC-003 same-click reward, server-side mirror. The CLI composes the
// canonical version in `packages/revealyst-agent/src/reward.ts`
// (`composeSyncReward`) from the just-built on-device batch, which carries
// per-day and per-model breakdowns. The web app has no such build coupling
// to that package (confirmed: nothing under src/ imports from
// packages/revealyst-agent today — see the same convention in
// `src/lib/data-confidence.ts`'s comment-only cross-reference), so this
// module is a SEPARATE, pure implementation kept in sync by comment
// cross-reference, not by shared code. If the CLI's copy or thresholds
// change, update this file to match.
//
// Server-side we only have what the connections page already fetched: the
// persisted `connector_runs` aggregate (records/signals/subjects counts +
// window — see `SyncTransparencyPanel`'s `LastSyncFacts`). No per-day or
// per-model breakdown survives to that table, so we can mirror only ONE of
// the CLI's three superlative tiers:
//
//   - "breadth" (>=2 distinct models) — NOT derivable: no model breakdown
//     is persisted server-side.
//   - "busiest day" — NOT derivable: no per-day record counts are
//     persisted server-side.
//   - "consistency" (>=3 active days) — derivable IF the batch had exactly
//     one subject. The agent's summarizer
//     (`packages/revealyst-agent/src/summarize.ts`) emits exactly one
//     day-signal row per (subject, day), so `signalsUpserted` equals the
//     count of distinct active days whenever `subjectsSeen === 1` (the
//     ordinary case — the local agent describes one person). With more
//     than one subject, "active days" can't be recovered from the
//     aggregate alone, so we stay honest and say nothing rather than guess.
//
// Honesty gate (invariant b): thin or unattributable data -> `null`, never
// a fabricated positive.

export type SyncRewardFacts = {
  records: number;
  signals: number;
  subjects: number;
};

/** Mirrors reward.ts `pickPositive`'s consistency threshold. */
const MIN_CONSISTENT_DAYS = 3;

/** The honesty-gated "one thing you did well" line for a completed manual
 * sync, or null when the already-fetched facts don't genuinely support one.
 * Pure — no I/O, no new queries; operates only on data the connections page
 * already has in hand. */
export function deriveSyncPositive(facts: SyncRewardFacts): string | null {
  if (facts.records <= 0 || facts.signals <= 0) {
    return null;
  }
  // More than one subject makes "active days" ambiguous from these
  // aggregates alone (see module doc) — never guess.
  if (facts.subjects !== 1) {
    return null;
  }
  const activeDays = facts.signals;
  if (activeDays >= MIN_CONSISTENT_DAYS) {
    return `Here's one thing you did well: ${activeDays} active days in this window — steady, consistent practice.`;
  }
  return null;
}
