// P3-A manager per-person capability drill-in copy (ADR 0045, capability half).
// Kept in ONE module (the companion-glossary pattern) so a content fact-check
// sweep covers it in one pass — every string here is a claim surface (invariant
// b) and must be plain English (CLAUDE.md writing rule). The manager view uses
// the SAME positive-first vocabulary as the self-view capability card (bands +
// confidence tiers from `capability-glossary`): "discovery, never deficiency",
// never a ranking, leaderboard, or performance verdict.

export const MANAGER_ROSTER_COPY = {
  title: "Your team's capabilities",
  /** What the roster is — and, honestly, what it is not. */
  description:
    "The people on the teams you manage. Open anyone to see where their AI habits are strongest, drawn from their own connected tools. It's a coaching view — a way to support people, not to compare them against each other.",
  /** Heading above a single managed team's member list. */
  teamLead: "Team",
  /** Rendered when a managed team has no tracked members yet. */
  emptyTeam:
    "No one on this team has a tracked profile yet. As people connect their tools, they'll appear here.",
  /** Rendered when the manager manages teams but none has any members. */
  emptyRoster:
    "None of the teams you manage have tracked people yet. As they connect their tools, they'll appear here.",
  /** Link label into a person's capability drill-in. */
  openProfile: "View capabilities",
  /** The manager-only entry card on the team dashboard (separate from the
   * count-only 5-card fold — never a per-person number there, D-TCI-5). */
  entryCard: {
    title: "Your team's capabilities",
    description:
      "You manage one or more teams. Open a coaching view of where each person's AI habits are strongest — drawn from their own connected tools, never a comparison between people.",
    action: "View your team",
  },
} as const;

export const MANAGER_DRILL_IN_COPY = {
  /** Small lead above the person's name on the drill-in header. */
  eyebrow: "Team member",
  /** Section heading for the capability list. */
  capabilitiesHeading: "Capabilities",
  /** The one-line honesty note shown ON the surface — what this data is and is
   * NOT. Sourced here (never inline) so a fact-check sweep covers it. */
  provenanceNote:
    "This is a coaching read of this person's AI habits, drawn only from their own connected tools. Bands are an early, uncalibrated signal — not a judgment, and not a comparison to teammates. Their recommendations, coaching, and personal notes stay private to them and are never shown here.",
  /** Lead-in for a row's evidence count (plain words, never "N data points"). */
  evidenceLead: (count: number) =>
    count === 1 ? "1 signal so far" : `${count} signals so far`,
  /** Rendered when the person has no capability evidence yet — honest forming
   * state, never zeros or a fabricated bar. */
  forming: {
    headline: "This person's capability read is still forming",
    body: "Their connected tools haven't produced enough measured activity yet. As more comes through, each capability fills in here — nothing is generic, it only reflects their own data.",
  },
} as const;
