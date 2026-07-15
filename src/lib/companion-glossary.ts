import {
  MATURITY_LEVEL_COPY,
  MATURITY_LEVEL_NONE_COPY,
  MATURITY_LEVEL_STALE_COPY,
  type MaturityLevelValue,
} from "./maturity-glossary";

// W5-C Personal Companion surface copy (Spec V4 §5.2 / §8.4 / §12). Pure data +
// pure builders, no React, no I/O — the same G7 copy-discipline as
// metrics-glossary.ts and maturity-glossary.ts: all new user-facing prose for
// the companion surface lives HERE, one source of truth a content fact-check
// can sweep.
//
// Honesty posture baked in (invariant b):
//  - The companion surface is a COMPOSITION of already-shipped, already-honest
//    parts (the modeled maturity level, the gated coaching recommendations, the
//    measured agentic/spend facts). It invents no new number and no new claim.
//  - LEVEL NAMES AND DEFINITIONS come ONLY from maturity-glossary.ts
//    (`MATURITY_LEVEL_COPY`) — this module frames them personally (org-of-one ⇒
//    the level is personally true, errata §1.2(6)) with NON-level-specific
//    labels, so the surface can never become a 4th, drifting maturity ladder.
//  - Positive-first framing in every headline; deficiency language ("measuring
//    low") stays inside the coaching-recommendation bodies (which are
//    themselves task-focused, never person-blaming).
//  - The daily nudge states ONE fresh fact drawn from the last sync — never a
//    dashboard, and (principle 7) never a demand that the user go sync: stale
//    data yields silence, not a nag.

/** The companion surface's page header (personal, org-of-one only). */
export const COMPANION_HEADER = {
  title: "Your AI growth companion",
  /** Rendered once a level has been placed — positive, forward-looking, and
   * explicitly personal (this is how *you* get seen, by yourself). */
  description:
    "This is how you get seen — by yourself. One place for where your AI use stands, the single next thing worth trying, and a fresh signal from your latest sync.",
} as const;

// ─── Growth Journey card ──────────────────────────────────────────────────────

export const GROWTH_JOURNEY_COPY = {
  title: "Your growth journey",
  /** Prefix for the level headline — the level NAME itself comes from
   * MATURITY_LEVEL_COPY (never invented here). */
  levelLead: "You're at",
  // "Directional" (not "Modeled"): the maturity level is telemetry-DERIVED —
  // Spec V4 §7.1's flagship differentiator vs incumbents' survey/modeled
  // models — but uses uncalibrated thresholds, so it's directional, not
  // precise. "Modeled" blurred that positioning; the InfoTip already says
  // "directional". (W5-C content fact-check, orchestrator review-fix.)
  levelBadge: "Directional",
  /** Section labels for the single next step. */
  nextStepLabel: "Your next step",
  whyLabel: "Why this",
  /** Shown when a level is placed but no coaching recommendation currently
   * fires (nothing is measuring weak enough to surface) — honest and
   * encouraging, never a fabricated task. */
  noNextStep: {
    headline: "Nothing needs fixing right now",
    body: "None of the parts behind your scores are measuring weak enough to flag a specific next step. Keep your habit going — a new suggestion appears here the moment the data calls for one.",
  },
  /** Personal framing of the "not enough data yet" and "stale" level states.
   * The NAME/tagline still come from maturity-glossary; these are the personal
   * one-liners around them. */
  formingLead: "Your level is still forming",
  staleLead: "Your level is paused until your next sync",
  /** W7-4 follow-up — lead-in when the headline reflects the person's MEASURED
   * capability band (only after mastery is measured; a directional early read
   * keeps the modeled maturity level as the headline). */
  capabilityLead: "Your strongest area is",
} as const;

/** The level name + tagline for the companion headline, sourced ONLY from
 * maturity-glossary (never invented). `stale`/null map to the honest withheld
 * states, personally framed by the caller. Pure. */
export function companionLevelCopy(
  level: MaturityLevelValue | null,
  stale: boolean,
): { name: string; tagline: string; placed: boolean } {
  if (stale) {
    return {
      name: MATURITY_LEVEL_STALE_COPY.name,
      tagline: MATURITY_LEVEL_STALE_COPY.tagline,
      placed: false,
    };
  }
  if (level === null) {
    return {
      name: MATURITY_LEVEL_NONE_COPY.name,
      tagline: MATURITY_LEVEL_NONE_COPY.tagline,
      placed: false,
    };
  }
  return {
    name: MATURITY_LEVEL_COPY[level].name,
    tagline: MATURITY_LEVEL_COPY[level].tagline,
    placed: true,
  };
}

// ─── Persistent coaching card ─────────────────────────────────────────────────

export const COACHING_COPY = {
  title: "Coaching",
  subtitle: "Task-focused guidance, drawn from the parts of your scores that are measuring low. Never a verdict on you — always something to try with the tools.",
  guidanceBadge: "Guidance",
  /** W7-1 — lead-in for the capability a recommendation advances (renders only
   * when the rec links to a capability whose label is loaded). */
  advancesLead: "Builds",
  /** W7-4 — lead-in for the computed "why this next" line. */
  whyLead: "Why this",
  /** COACH-008 — the in-app affordance label (an `in-product-setting` rec, and
   * the deferred `vendor-deep-link` fallback): navigates inside Revealyst. */
  takeALook: "Take a look",
  /** COACH-008 — the external affordance label (a `link-out` rec): opens outside
   * guidance in a new tab. */
  learnMore: "Learn more",
  /** Rendered when there are no active recommendations (nothing measuring weak,
   * or scores not computed yet). */
  empty: {
    headline: "No coaching to show yet",
    body: "Coaching appears once your connected tools have produced enough measured signal to point at a specific, task-focused next step. Nothing here is generic advice — it only fires off your own data.",
  },
} as const;

// ─── Milestones card (W5-F) ───────────────────────────────────────────────────

export const MILESTONE_COPY = {
  title: "Milestones",
  /** Positive-first subtitle — celebrations, grounded in the person's own
   * measured progress, never a benchmark or a comparison to others. */
  subtitle:
    "Progress worth celebrating, measured against your own past. Each one is drawn from real, attributed activity — never a comparison to anyone else.",
  /** Small badge on each milestone. */
  badge: "Milestone",
} as const;

// ─── Daily nudge card ─────────────────────────────────────────────────────────

export const DAILY_NUDGE_COPY = {
  title: "Today's signal",
  /** Prefix for the "as of" freshness line — a statement of fact, never a
   * request to sync (principle 7). */
  asOfLead: "From your sync",
} as const;

export type DailyNudge = {
  headline: string;
  detail: string;
  /** Freshest successful sync date (YYYY-MM-DD), or null. Rendered as context,
   * never as a demand to re-sync. */
  asOf: string | null;
};

/** Minimal structural view of the agentic-adoption result the nudge reads. */
type NudgeAgentic = {
  kind: string;
  agenticDays?: number;
  activeDays?: number;
};

/**
 * ONE fresh, positive fact from the most recent sync — never a dashboard.
 * Pure; picks the single most encouraging true statement available from data
 * already in hand, in priority order, and returns null when there is nothing
 * fresh worth saying (the surface then renders no nudge — no nag, principle 7).
 *
 * Priority is positive-first: measured agentic depth (the signal that separates
 * the top maturity levels) → consolidated spend → live scores → a plain
 * "your latest activity landed" acknowledgement.
 */
export function buildDailyNudge(input: {
  freshestSyncAt: Date | string | null;
  agentic: NudgeAgentic;
  spendCents: number;
  hasScores: boolean;
}): DailyNudge | null {
  const asOf =
    input.freshestSyncAt == null
      ? null
      : (input.freshestSyncAt instanceof Date
          ? input.freshestSyncAt
          : new Date(input.freshestSyncAt)
        )
          .toISOString()
          .slice(0, 10);

  const { agentic } = input;
  if (
    agentic.kind === "measured" &&
    (agentic.agenticDays ?? 0) > 0 &&
    (agentic.activeDays ?? 0) > 0
  ) {
    const days = agentic.agenticDays!;
    const active = agentic.activeDays!;
    return {
      headline: "Agents are showing up in your work",
      detail: `Agentic work appeared on ${days} of your ${active} recent active ${active === 1 ? "day" : "days"} — the depth signal the top maturity levels are built on.`,
      asOf,
    };
  }
  if (input.spendCents > 0) {
    return {
      headline: "Your AI spend is all in one place",
      detail:
        "Your latest sync consolidated spend across your connected tools — one number to watch instead of several bills to chase.",
      asOf,
    };
  }
  if (input.hasScores) {
    return {
      headline: "Your scores are live",
      detail:
        "Your connected tools are producing measured scores. Open Diagnostic details any time to see the parts behind each one.",
      asOf,
    };
  }
  if (asOf !== null) {
    return {
      headline: "Your latest activity landed",
      detail:
        "We've ingested your most recent sync. Your first scores appear here as soon as there's enough measured signal to place them.",
      asOf,
    };
  }
  return null;
}

// ─── Demoted diagnostics expander ─────────────────────────────────────────────

export const DIAGNOSTIC_COPY = {
  triggerLabel: "See the numbers behind your level",
  description:
    "The raw 0–100 Adoption, Fluency, and Efficiency scores behind your level. Useful for a deep look — but your level and next step above are what to act on.",
} as const;

// ─── Onboarding inversion — companion-pitch screen (errata §1.2(2)) ───────────

export const ONBOARDING_PITCH_COPY = {
  headline: "Meet your AI growth companion",
  subhead:
    "This is how you get seen — by yourself. Connect a tool and Revealyst turns your own AI usage into a clear picture: where you stand, and the single next thing worth trying. Not a dashboard to manage — a companion that shows you your own growth.",
  /** The three privacy ENFORCEMENT points — each is a real, code-backed control
   * (verified against src/lib/agent-ingest.ts and docs/connector-facts.md), not
   * a marketing promise. Kept honest and non-hyperbolic (W3-N rule). */
  privacyHeading: "Private by construction",
  privacyPoints: [
    {
      title: "Content never leaves your machine",
      body: "The desktop collector reads your local logs through an on-device allowlist: it copies only known-safe fields (timestamps, model id, token counts, tool names) and drops everything else. Prompts, responses, file contents, and tool output are never transmitted.",
    },
    {
      title: "A hard cap on what the server accepts",
      body: "Every dimension label the server will store is capped at 128 characters — long enough for a model name, deliberately too short to smuggle prompt text through.",
    },
    {
      title: "Content flags off by default",
      body: "Content-capture flags are off by default and Revealyst never turns them on; the server scrubs defensively even if an upstream tool sets one. The measured signal is usage shape, never what you wrote.",
    },
  ],
  continueLabel: "Connect your tools",
} as const;
