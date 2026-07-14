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
   * dashboard — progressive disclosure). */
  maxRows: 6,
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
} as const;
