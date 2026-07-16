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

// P3-B manager per-person SPEND copy (ADR 0045, spend half — behind the admin
// toggle). Same claim-surface + plain-English rules as the capability copy above.
// The cost≠capability law is stated ON the surface (ADR 0045: cost is never
// evidence of capability, TCI-MET-001), and every number is honestly labeled —
// vendor-reported vs estimated are never blended, per-model is TOKEN volume not
// dollars, and unattributable shared-account spend is disclosed as a count, never
// split.
export const MANAGER_SPEND_COPY = {
  /** Section heading for the spend block on the drill-in. */
  heading: "Cost",
  /** The cost≠capability framing, shown ON the surface (ADR 0045). Spend is
   * operational context for a manager, never a measure of how good someone is. */
  contextNote:
    "This is operational context — what this person's connected tools cost — not a measure of their skill. Cost is never part of a capability read, and a bigger bill is not a better (or worse) result.",
  /** Vendor-reported spend label + its honest sub-label. */
  reportedLabel: "Reported spend",
  reportedSub: "Billed figures from the connected tools.",
  /** Derived/estimated spend label — kept visibly separate from reported. */
  estimatedLabel: "Estimated spend",
  estimatedSub:
    "A separate estimate, shown on its own — never added to the reported figure, because the two can overlap.",
  /** Column labels for the two time windows. */
  mtdLabel: "This month so far",
  priorLabel: "Last month",
  /** Per-model section: TOKEN volume, explicitly not a dollar split. */
  modelHeading: "Model mix",
  modelSub:
    "How this person's usage splits across models, by amount of use — not by cost. No connected tool reports what each model costs, so this is never shown in dollars.",
  /**
   * The allocation-confidence / coverage disclosure. Honest COUNTS, never a
   * fabricated percentage: which of the person's connected accounts this cost
   * can be tied to, and how much shared-account cost is deliberately left out.
   */
  coverageLine: (coverage: {
    attributableSubjectCount: number;
    sharedSubjectCount: number;
    sharedSubjectsWithSpendCount: number;
  }): string => {
    const acct = (n: number) => (n === 1 ? "1 account" : `${n} accounts`);
    const base =
      coverage.attributableSubjectCount === 0
        ? "None of this person's connected accounts can be tied to them alone, so no individual cost is shown."
        : `This covers ${acct(coverage.attributableSubjectCount)} that belong to this person alone.`;
    if (coverage.sharedSubjectsWithSpendCount > 0) {
      return `${base} ${acct(coverage.sharedSubjectsWithSpendCount)} they share with others also had cost — that's left out here, because shared cost can't honestly be split to one person.`;
    }
    if (coverage.sharedSubjectCount > 0) {
      return `${base} They also use ${acct(coverage.sharedSubjectCount)} shared with others, which are never counted as one person's cost.`;
    }
    return base;
  },
  /** Rendered when the person has no attributable spend at all — honest empty,
   * never a zero-dollar figure implying "measured $0". */
  empty:
    "No individual cost to show yet. This person's connected tools haven't reported any spend that can be tied to them alone.",
} as const;

// P3-B admin toggle copy (ADR 0045 spend half, D-TCI-2). The Settings → People
// control that turns per-person cost visibility ON for a team's managers. Plain
// English, honest about exactly what turns on and for whom (CLAUDE.md writing
// rule + invariant b) — a privacy-sensitive reversal deserves clear framing.
export const TEAM_COST_VISIBILITY_SETTINGS_COPY = {
  title: "Individual cost visibility",
  description:
    "Choose whether the managers of a team can see each member's individual cost. Off by default. When on, a team's managers see one person's spend on their profile — never a comparison, and only when your workspace shows real names.",
  /** Column header for the per-team on/off control. */
  columnLabel: "Managers can see individual costs",
  /** Accessible label for a team's toggle (name interpolated). */
  toggleLabel: (teamName: string) =>
    `Let managers of ${teamName} see individual costs`,
  /** Shown when there are no teams to configure. */
  empty: "Create a team first, then choose whether its managers see costs.",
  /** One-line honesty note under the card. */
  note: "Individual costs are operational context for a manager, never a measure of anyone's skill — and they're only ever shown when your workspace shows real names.",
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
