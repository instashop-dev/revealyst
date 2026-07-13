import type { DiversityComparison } from "./workflow-diversity";

// W5-F deliverable (1): the milestone/positive insight kind (Spec V4 §7.3, §8.4).
//
// Milestones are the FIRST celebratory surface in the product — "positive-first
// becomes real" (§8.4). A milestone is a grounded, measured achievement drawn
// from signals the page already has in hand; it invents no number and no claim
// (invariant b). Pure: no React, no I/O, no clock, no storage.
//
// ── v0 is recompute-on-read, NO storage (the §8.4 decision) ────────────────────
// Every milestone here is recomputed from rows already in the caller's flat
// batch (the G10 perf law — never a new request-time query). "Show-once"
// semantics would need a state table under the §15.2 law; v0 is
// BADGE-UNTIL-SUPERSEDED instead: a milestone keeps rendering until the
// comparison that produced it no longer holds. That is why every detector
// compares against a real PRIOR baseline (last period's breadth, the prior
// trend max) rather than a fixed zero — a fixed-zero baseline would re-fire the
// same milestone forever (the exact `isNewBest` trap: `current >= best` claimed
// a "new best" every week on a flat trend).
//
// ── Strictness inherits `isNewBest`'s `>` (never `>=`) ─────────────────────────
// A tie with the prior baseline is NOT a new achievement. `new-best` is gated by
// the caller's strict `isNewBest` (src/lib/digest-content.ts `scoreLine`);
// `feature-breadth` rides W5-E's `compareWorkflowDiversity`, whose
// `crossedMilestone` requires `current >= T AND previous < T` — the crossing is
// strict in `previous`, so a threshold already reached last period never re-fires.
//
// ── The NO-STREAK decision (§8.4, founder sign-off §9(3); recorded here) ────────
// Weekly consistency with forgiveness is rendered as NARRATIVE COPY ONLY — no
// streak counter UI, no streak flame, no daily anything. The Duolingo NOT-list
// (XP / leagues / streak flames / hearts) is a review-blocker (§8.4, tripwire
// rule 7). So the `weekly-cadence` milestone below carries NO number in its copy
// (it never says "4 weeks running"): it states the RHYTHM, not a count to
// protect. `activeWeeks` gates whether it fires; it is never rendered.

export type MilestoneKind =
  | "new-best"
  | "feature-breadth"
  | "first-agent-session"
  | "weekly-cadence";

export type Milestone = {
  kind: MilestoneKind;
  /** Positive-first headline. */
  title: string;
  /** Grounded one-liner — states the measured fact, never a benchmark. */
  body: string;
  /** Presentational prominence within the milestone list (higher first). NOT a
   * benchmark, NOT derived from any dataset — purely "which celebration leads."
   * The agentic transition (the depth signal the top maturity levels rest on)
   * leads, then breadth, then a per-score new high, then the weekly rhythm. */
  weight: number;
};

/** How many milestones surface at once — a celebration, not a confetti cannon.
 * Milestone spam is a named risk (§3 W5-F); the cap + weight order tame it. */
export const MAX_MILESTONES = 3;

/** The weekly-consistency narrative fires only once there are at least this
 * many recent active weeks — "with forgiveness" (gaps allowed; the caller counts
 * weeks that HAD activity, not an unbroken run). Presentational threshold only. */
export const WEEKLY_CADENCE_MIN_WEEKS = 3;

const MILESTONE_WEIGHTS: Record<MilestoneKind, number> = {
  "first-agent-session": 40,
  "feature-breadth": 30,
  "new-best": 20,
  "weekly-cadence": 10,
};

/** All milestone prose (G7 — prose is a claim surface, kept in one sweepable
 * place). Every string is grounded in a measured fact the caller passes and
 * compares only against the workspace's own past — never an industry figure,
 * threshold, or "typical org" (invariant b; the shared BANNED_PHRASING sweep). */
export const MILESTONE_COPY = {
  firstAgentSession: {
    title: "Agents showed up in your work",
    body: "Agentic work appeared in your recent activity for the first time in the period tracked — the depth signal the most advanced AI use is built on.",
  },
  featureBreadth: (distinctCount: number, threshold: number) => ({
    title: "You're spanning more of your AI tools",
    body: `You've now used ${distinctCount} distinct workflow${
      distinctCount === 1 ? "" : "s"
    }, crossing the ${threshold}-workflow mark. Breadth across features is one of the steadiest signals that AI is becoming part of how you work.`,
  }),
  newBest: (label: string, value: number) => ({
    title: `New high for ${label}`,
    body: `Your ${label} score reached ${value} — its highest in the period tracked. Measured against your own past, never a benchmark.`,
  }),
  weeklyCadence: {
    title: "A steady weekly rhythm",
    // NO count here — the no-streak decision (§8.4): narrative only, nothing to
    // protect, no daily nag. States the rhythm, celebrates forgiveness explicitly
    // (and deliberately avoids even naming streak mechanics).
    body: "You've kept coming back to your AI tools week after week. Consistency compounds more than intensity — this is a rhythm to enjoy, not a run to keep alive.",
  },
} as const;

/**
 * Detect the celebratory milestones for one subject/period from already-derived
 * facts. Each input is OPTIONAL — a caller passes only what its own flat batch
 * honestly supports, and absence yields no milestone (never a fabricated one).
 * Deterministic; ordered by presentational weight and capped at `MAX_MILESTONES`.
 */
export function detectMilestones(input: {
  /** Scores at a STRICT new high this period — the caller derives these from the
   * same `isNewBest` (`>`, prior points only) the digest uses, so a flat/tied
   * trend never produces one. */
  newBests?: readonly { label: string; value: number }[];
  /** W5-E's breadth comparator (src/lib/workflow-diversity.ts). A milestone
   * fires ONLY when `crossedMilestone !== null` (a threshold newly reached this
   * period, strict in `previous`). */
  breadth?: DiversityComparison | null;
  /** True when agentic work is measured AND newly appeared (the caller owns the
   * "newly" gate against its own window — see the companion wiring). */
  firstAgentSession?: boolean;
  /** Count of recent weeks WITH activity (forgiveness: gaps allowed). Gates the
   * weekly-consistency narrative; NEVER rendered as a number (no-streak decision). */
  activeWeeks?: number | null;
}): Milestone[] {
  const out: Milestone[] = [];

  if (input.firstAgentSession) {
    out.push({
      kind: "first-agent-session",
      ...MILESTONE_COPY.firstAgentSession,
      weight: MILESTONE_WEIGHTS["first-agent-session"],
    });
  }

  if (input.breadth && input.breadth.crossedMilestone !== null) {
    const copy = MILESTONE_COPY.featureBreadth(
      input.breadth.current,
      input.breadth.crossedMilestone,
    );
    out.push({
      kind: "feature-breadth",
      ...copy,
      weight: MILESTONE_WEIGHTS["feature-breadth"],
    });
  }

  for (const nb of input.newBests ?? []) {
    const copy = MILESTONE_COPY.newBest(nb.label, nb.value);
    out.push({ kind: "new-best", ...copy, weight: MILESTONE_WEIGHTS["new-best"] });
  }

  if ((input.activeWeeks ?? 0) >= WEEKLY_CADENCE_MIN_WEEKS) {
    out.push({
      kind: "weekly-cadence",
      title: MILESTONE_COPY.weeklyCadence.title,
      body: MILESTONE_COPY.weeklyCadence.body,
      weight: MILESTONE_WEIGHTS["weekly-cadence"],
    });
  }

  // Stable order: weight desc, then kind for determinism on ties.
  out.sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind));
  return out.slice(0, MAX_MILESTONES);
}
