// Weekly-digest copy (F2.2, G7 — prose is a claim surface). ALL digest prose
// lives here as a glossary-style constant module so subject lines, section
// headers, staleness annotations, and the footer share one reviewed source and
// can't drift across the email renderer, tests, or a future preview surface.
//
// Honesty discipline (invariant b):
//  - The subject leaks NO metric value (inbox-preview privacy) — it is generic.
//  - Nothing here states a comparison, threshold, or number as fact; the
//    numbers come from the same honest deltas the dashboard renders (first /
//    notComparable render as "first week tracked", never a fabricated 0%).
//  - Staleness copy is grounded in `connections.last_success_at` only (G5).

import type { DigestLane } from "./digest-content";

/** Generic subject — never interpolates a score, delta, or count (privacy). */
export const DIGEST_SUBJECT = "Your Revealyst weekly digest";

/** Sender-side preheader (hidden preview text) — also value-free. */
export const DIGEST_PREHEADER =
  "Your team's AI-adoption trends from the past week.";

export const DIGEST_COPY = {
  /** Greeting line, lane-aware framing. */
  intro: {
    personal:
      "Here's how your AI adoption moved over the past four weeks — measured against your own past, never a benchmark.",
    team: "Here's how your team's AI adoption moved over the past four weeks — aggregate trends only, measured against your own past.",
  } satisfies Record<DigestLane, string>,

  sections: {
    movement: "Recent movement",
    scores: "Score trends",
    personalBest: "Personal best",
    /** W5-F: the digest as Growth-Journey channel — the celebratory section. */
    growthJourney: "Your growth journey",
    focus: "What to focus on",
    freshness: "Data freshness",
    /** TCI Phase 2-F (ADR 0050): the manager team-brief section (team lane, for
     * manager recipients). */
    teamBrief: "Your team this week",
  },

  /** TCI Phase 2-F (ADR 0050) manager team-brief sub-labels. Plain English,
   * aggregate framing — never a per-person value. */
  teamBrief: {
    lead: "A quick, aggregate read on how your team is doing — never any one person's data.",
    maturity: "Team AI health",
    coverage: "Where the team is strong",
    movement: "What moved this month",
    insights: "Worth your attention",
    coverageRow: (label: string, mastered: number, total: number) =>
      `${label}: ${mastered} of ${total} at a strong level`,
    movementRow: (
      label: string,
      direction: "up" | "down" | "flat",
      masteredNow: number,
      masteredBefore: number,
    ) =>
      direction === "up"
        ? `${label}: up from ${masteredBefore} to ${masteredNow}`
        : direction === "down"
          ? `${label}: down from ${masteredBefore} to ${masteredNow}`
          : `${label}: steady at ${masteredNow}`,
  },

  /** W5-F kind-aware labels for the "What to focus on" section: a coaching rec
   * is tagged as optional GUIDANCE, visually distinct from a must-act alert like
   * a failing connection (errata §1.2(7)). */
  focusLabels: {
    guidance: "Guidance",
    actionNeeded: "Needs attention",
  },

  /** W5-F growth-journey lead — a positive, forward framing above the
   * milestones. Lane-agnostic and true for both cohorts. */
  growthJourneyLead:
    "Progress worth noticing this period — measured against your own past.",

  /** T1.1: the body return-to-companion CTA (distinct from the footer's
   * "Manage digest settings" link). Plain English, no jargon. The team lane
   * gets honest wording — /dashboard shows a team overview there, not a
   * personal companion (rendered copy is a claim surface, invariant b). */
  cta: {
    openCompanion: "Open your companion",
    openDashboard: "Open your dashboard",
  },

  /** Movement metric labels — aggregate quantities, no per-person values. */
  movementLabels: {
    reported_spend: "Reported spend",
    active_people: "Active people",
    active_days: "Active days",
  },

  /** Honest delta framing for the score and movement rows. */
  firstWeek: "first week tracked",
  notComparable: "not comparable to the previous period",
  noChange: "no change",

  /** Personal-best line (personal lane only). Grounded in the stored trend's
   * own maximum within the digest's ~six-month lookback — never a benchmark
   * or "typical" org, never an all-time claim (the window is
   * DIGEST_WINDOW_DAYS, not full history), and no "week" claim (the stored
   * points are month/rolling-28d grain periods, not weeks). */
  newPersonalBest: (slug: string, value: number) =>
    `New personal best for ${slug}: ${value} — your highest in the last six months.`,
  personalBestSoFar: (slug: string, value: number) =>
    `Your best ${slug} score in the last six months is ${value}.`,

  /** "Data as of" line — always shown. */
  dataAsOf: (date: string) => `Data as of ${date}.`,
  dataAsOfNone:
    "No connected tool has synced recently, so this digest may be incomplete.",

  /** Per-channel staleness annotation (G5): grounded in last_success_at. */
  channelStale: (tool: string, sinceDate: string) =>
    `${tool} hasn't synced since ${sinceDate} — its numbers may be stale.`,
  channelNeverSynced: (tool: string) =>
    `${tool} hasn't completed a sync yet, so it isn't reflected here.`,

  footer: {
    // Lane-agnostic and TRUE for both cohorts: a personal owner may be
    // receiving this via the default-on lane without ever touching Settings,
    // so "because you enabled it" would be a false claim for them (G7).
    why: "You're receiving this because the weekly digest is on for your Revealyst workspace — you can manage it anytime in Settings.",
    manage: "Manage digest settings",
    unsubscribe: "Unsubscribe",
    honesty:
      "Every number here traces to real, attributed usage. Trends compare your workspace against its own past — Revealyst never ranks you against other companies.",
  },
} as const;

/** Human date for the "data as of" / staleness lines (UTC, e.g. "Jul 7, 2026"). */
export function digestDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
