// W7-2 capability-profile copy + band derivation. Kept in ONE module (the
// companion-glossary pattern) so a content fact-check sweep covers it in one
// pass — every string here is a claim surface (invariant b) and must be plain
// English (CLAUDE.md writing rule). The capability profile is a DECOMPOSITION of
// the one person proficiency band, never a competing third ladder (L5).

/** A positive-first mastery band. Ordered strong → forming. "Discovery, never
 * deficiency": even the lowest band is framed as a starting point, never a
 * failure. The raw 0–1 mastery stays behind the diagnostic expander. */
export type CapabilityBand =
  | "Established"
  | "Building"
  | "Developing"
  | "Getting started";

/** Map a [0,1] mastery to its display band. Thresholds are directional (the
 * whole engine is capped `directional` until OTel) — tunable without a data
 * migration, greppable here. */
export function masteryBand(mastery: number): CapabilityBand {
  if (mastery >= 0.75) return "Established";
  if (mastery >= 0.5) return "Building";
  if (mastery >= 0.25) return "Developing";
  return "Getting started";
}

/**
 * The person's overall capability band for the Growth-Journey headline — the
 * band of their strongest MEASURED capability (W7-4 follow-up). Returns null
 * unless at least one capability is `measured` (not the directional early
 * read): a directional band is a shakier headline than the modeled maturity
 * level, so until the OTel receiver (P8) makes mastery measured this returns
 * null and the maturity level stays the headline source. Pure + deterministic.
 */
export function overallCapabilityBand(
  states: readonly { mastery: number; confidenceTier: string }[],
): CapabilityBand | null {
  const measured = states.filter((s) => s.confidenceTier === "measured");
  if (measured.length === 0) return null;
  const top = Math.max(...measured.map((s) => s.mastery));
  return masteryBand(top);
}

/** Plain-English rendering of the confidence tier — never the internal jargon.
 * Capped `directional` this phase, so "early read" is what users see. */
export function confidenceTierLabel(tier: string): string {
  switch (tier) {
    case "measured":
      return "measured";
    case "modeled":
      return "modeled";
    case "directional":
      return "early read";
    default:
      return "not measured yet";
  }
}

export const CAPABILITY_PROFILE_COPY = {
  title: "Your capabilities",
  /** Positive-first, decomposition-not-ladder framing. */
  subtitle:
    "A read on where your AI habits are strongest right now, drawn from your own connected tools. It's a breakdown of the same progress your level reflects — not a separate score, and never a comparison to anyone else.",
  /** Small chip clarifying the whole read is an early, uncalibrated signal. */
  tierBadge: "Early read",
  /** Lead-in for the single eligible-next capability. */
  nextLead: "A good next focus",
  /** Rendered when the person has no capability evidence yet (forming state) —
   * the honest `formingLead` pattern, never zeros. */
  forming: {
    headline: "Your capability read is still forming",
    body: "As your connected tools produce more measured signal, this fills in with the AI habits your activity points to. Nothing here is generic — it only reflects your own data.",
  },
  /** How many rows the card shows before it stops (keeps it a glance, not a
   * dashboard — progressive disclosure). The Growth surface's full-list mode
   * (U1.3) overrides this to show every evidenced capability. */
  maxRows: 6,
  /** Full-list mode (Growth): lead for a row's most-recent measured evidence.
   * Only rendered when a row actually carries a `lastEvidenceAt` date — never
   * fabricated (invariant b). */
  lastEvidenceLead: "Last measured",
  /** Full-list mode: shown when a row has evidence but no recorded date. */
  noEvidenceDate: "Recency not recorded",
} as const;

// U1.3 Growth surface copy. The improvement screen: capability decomposition +
// missions + milestones on their own route. Every string here is plain English
// (CLAUDE.md writing rule) and a claim surface (invariant b) — swept by the
// growth-cards banned-phrasing test.
export const GROWTH_PAGE_COPY = {
  title: "Your growth",
  description:
    "Where your AI habits are strongest, what to build next, and the progress you've already made — all drawn from your own connected tools.",
  /** Section headings on the route. */
  capabilitiesHeading: "Your capabilities",
  missionsHeading: "Missions",
  milestonesHeading: "Milestones",
  /** The directional-vs-measured explainer (an InfoTip).
   * HONESTY (invariant b): "measured" is NOT "two independent signals confirm
   * it" — the real gate is evidence for ≥2 of the capability's bound OTel MARKER
   * metrics (src/scoring/capability-state.ts, `MEASURED_MARKER_MIN`, ADR 0039),
   * and most capabilities have no markers bound at all, so they can never reach
   * that tier today. The copy must promise only what's actually reachable.
   * Re-verify against that gate before editing this string. "OTel"/"markers" are
   * banned UI vocabulary (CLAUDE.md writing rule) — say "detailed coding
   * telemetry". */
  confidenceInfo: {
    label: "Early read vs measured",
    short:
      "Early read means it's an early signal from your connected tools. Measured means it's confirmed by detailed coding telemetry — only some skills can be measured this way, and only once the local agent's telemetry is connected.",
  },
  /** Page-level honest empty state when NO capability has evidence yet. The
   * body is completed by the caller with the connector(s) that would add
   * evidence, derived from the person's own connections — never a fabricated
   * bar or a generic promise. */
  empty: {
    headline: "Your capability read is still forming",
    /** Rendered when the person already has connected tools (sources exist,
     * signal is still accumulating). */
    withSources:
      "Your connected tools haven't produced enough measured activity yet. As more comes through, each capability fills in here — nothing is generic, it only reflects your own data.",
    /** Rendered when the person has no active source producing signal —
     * points them at the desktop agent without inventing a specific reading. */
    noSources:
      "Set up the Revealyst Agent to start building an evidence-based read of your AI capabilities. Until then there's nothing measured to show — and we won't guess.",
    connectLabel: "Set up the agent",
  },
} as const;

// W7-5 missions card copy. Anti-gamification (Spec V4 §8.4): grounded and quiet —
// NO points/streak/league/badge/level-up language (a banned-phrasing test
// enforces it). Completion is described as something the person's real activity
// reached, never a prize.
export const MISSION_COPY = {
  title: "Missions",
  /** Positive, opt-in framing — never a demand or a game. */
  subtitle:
    "Short, optional challenges. You finish one when your own connected activity reaches the goal — there's nothing to check off by hand.",
  startAction: "Start this mission",
  startedToast: "Mission started — it completes on its own as your activity reaches the goal.",
  /** Small badge on a completed mission (grounded, not a prize). */
  doneBadge: "Completed",
  /** In-progress step summary, e.g. "1 of 2 steps reached". Plain words, not a
   * game-style meter. */
  stepProgress: (done: number, total: number) =>
    `${done} of ${total} step${total === 1 ? "" : "s"} reached`,
  /** Shown for a finished mission — grounded, in the milestone voice. */
  completeLine: "You reached this from your own measured activity. Nice work.",
  /** U1.3 Growth board group headings (active → available → completed). Plain,
   * un-gamified section labels — no "quests"/"challenges accepted" flourish. */
  groups: {
    active: "In progress",
    available: "Available to start",
    completed: "Completed",
  },
  /** Lead for a completed mission's date on the Growth timeline. */
  completedOnLead: "Completed",
  /** Growth board empty state (no missions in the catalog at all). */
  empty: "No missions are available right now.",
  /** Today active-strip → Growth link (the full catalog lives on /growth). */
  allLink: "All missions",
} as const;

// W7-6 team capability-coverage card copy. Aggregate, count-only — the copy must
// never imply an individual (a claim surface).
export const CAPABILITY_COVERAGE_COPY = {
  title: "Team capability coverage",
  /** Aggregate + coaching framing; never a per-person read. */
  subtitle:
    "Where the team is strongest, as a count of how many people each capability's activity points to. Aggregate only — never a read on any individual, and small groups are left out entirely.",
  peopleWord: "people",
  /** Rendered when no capability clears the minimum-group floor yet. */
  empty:
    "Not enough people have measured capability activity yet to show coverage without singling anyone out.",
  // T3.3 depth/spread — the mean + how evenly it's shared, both aggregate-only.
  // Rendered as whole-percent (0–100) of the 0–1 mastery scale.
  depthLabel: (meanPct: number) => `Team average ${meanPct}%`,
  spreadEven: "evenly shared",
  spreadMixed: "mixed",
  spreadUneven: "very uneven",
} as const;
