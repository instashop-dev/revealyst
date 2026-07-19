import { SCORE_SLUGS, type ScoreSlug } from "./metrics-glossary";
import { CAPABILITY_CURRICULUM_ORDER } from "./capability-curriculum";

// The initiative library (Team Manager Dashboard P2, ADR 0062) — the §8
// starter templates a manager can launch an initiative from. A CODED registry
// (the capability-curriculum.ts / glossary pattern), NOT a DB table: the
// content lives in code and stays pure, so there is no migration and no risk of
// a stored-prose claim surface (W3-N). `initiatives.template_slug` references a
// key here; a test pins every binding to a REAL score/capability slug.
//
// Plain-English and honest (product principle): each template names a concrete
// management move and the change it aims for, never a productivity/ROI promise
// (invariant b) and never gamified vocabulary (Spec V4 §8.4 — a banned-phrasing
// sweep guards this).

export type InitiativeTemplate = {
  /** Stable template id (== initiatives.template_slug). */
  slug: string;
  /** Short manager-facing name. */
  title: string;
  /** 1-2 plain sentences: what the initiative does. */
  summary: string;
  /** What measurably changes if it works — descriptive, never a promise. */
  expectedChange: string;
  /** The capability it advances (a real `capabilities.slug`), or null. */
  capabilitySlug: string | null;
  /** The score it aims to move (a real ScoreSlug), or null. At least one of
   * capabilitySlug / scoreSlug is set on every template. */
  scoreSlug: ScoreSlug | null;
};

/** Ordered template slugs (the order the launch picker renders them). */
export const INITIATIVE_TEMPLATE_ORDER: readonly string[] = [
  "build-one-repeatable-workflow",
  "spread-expert-workflow",
  "improve-consistency",
  "activate-underused-tool",
  "reduce-overlap",
  "agentic-pilot",
  "function-playbook",
];

export const INITIATIVE_LIBRARY: Record<string, InitiativeTemplate> = {
  "build-one-repeatable-workflow": {
    slug: "build-one-repeatable-workflow",
    title: "Build one repeatable workflow",
    summary:
      "Pick a single task the team does often and turn it into a shared, reliable way of using AI for it — a prompt, a checklist, a small guide.",
    expectedChange:
      "More of the team uses AI on the same recurring task the same way, so depth of use rises rather than one-off experiments.",
    capabilitySlug: "consistent-daily-use",
    scoreSlug: "fluency",
  },
  "spread-expert-workflow": {
    slug: "spread-expert-workflow",
    title: "Spread an expert's workflow",
    summary:
      "Take what your strongest AI users already do well and help the rest of the team pick it up — a short walkthrough, a paired session, a written note.",
    expectedChange:
      "A capability that a few people rely on becomes something more of the team can do, so it's less concentrated in one or two experts.",
    capabilitySlug: "feature-breadth",
    scoreSlug: "fluency",
  },
  "improve-consistency": {
    slug: "improve-consistency",
    title: "Make AI part of the daily routine",
    summary:
      "Help people reach for AI on more days, not just occasionally — small nudges, a shared starting habit, removing friction to opening the tool.",
    expectedChange:
      "AI use spreads across more days of the week, so day-to-day adoption steadies rather than coming in bursts.",
    capabilitySlug: "consistent-daily-use",
    scoreSlug: "adoption",
  },
  "activate-underused-tool": {
    slug: "activate-underused-tool",
    title: "Activate an underused tool or feature",
    summary:
      "Choose one connected tool or feature the team has but barely uses, and give people a real task to try it on.",
    expectedChange:
      "Usage widens beyond one or two features, so the team draws on more of what the connected tools can do.",
    capabilitySlug: "feature-breadth",
    scoreSlug: "adoption",
  },
  "reduce-overlap": {
    slug: "reduce-overlap",
    title: "Reduce overlapping tools and spend",
    summary:
      "Look at where two tools do the same job or seats sit unused, and rightsize what the team pays for against what it actually uses.",
    expectedChange:
      "Spend lines up better with real usage — fewer idle seats and less duplicated tooling.",
    capabilitySlug: "cost-efficient-usage",
    scoreSlug: "efficiency",
  },
  "agentic-pilot": {
    slug: "agentic-pilot",
    title: "Run an agent-assisted pilot",
    summary:
      "Try an agent mode on a bounded, real piece of work with a small group, and capture what worked and what didn't before widening it.",
    expectedChange:
      "A slice of work shifts to agent-assisted, giving an honest read on where it helps before any broader rollout.",
    capabilitySlug: "agentic-delivery",
    scoreSlug: "fluency",
  },
  "function-playbook": {
    slug: "function-playbook",
    title: "Write a starting playbook",
    summary:
      "Draft a short, shared starting guide for how this team uses AI — the handful of tasks worth routing through it and how to get going.",
    expectedChange:
      "New and existing members have a clear on-ramp, so foundational AI use spreads more evenly across the team.",
    capabilitySlug: "ai-coding-foundations",
    scoreSlug: "adoption",
  },
};

/** True iff `slug` is a known initiative-library template. */
export function isInitiativeTemplate(slug: unknown): slug is string {
  return typeof slug === "string" && slug in INITIATIVE_LIBRARY;
}

/** The valid capability slugs an initiative may target (the 9-capability seed). */
export const INITIATIVE_CAPABILITY_SLUGS: readonly string[] =
  CAPABILITY_CURRICULUM_ORDER;

/** The valid score slugs an initiative may target. */
export const INITIATIVE_SCORE_SLUGS: readonly ScoreSlug[] = SCORE_SLUGS;
