// W5-H copy module (G7): all user-facing prose for the consolidated Team
// Intelligence surface lives here, positive-first and honest. The dashboard-itis
// fold collapses ~18–20 panels into FIVE audience-scoped cards; each card's
// title + lead line is a single source of truth so the page component carries
// no inline prose. No connector claims here (those derive from
// src/connectors/registry.ts elsewhere), no fabricated numbers.

export const TEAM_OVERVIEW_COPY = {
  header: {
    title: "Team Intelligence",
    description:
      "Who's using AI, how deeply, and what it costs — across your tools, aggregate by default. Tap the info icon next to any number for a plain-English explanation.",
  },
  /** (a) Team AI Health — the three scores, recent movement, the period story,
   * and consolidated spend. */
  health: {
    title: "Team AI health",
    lead: "Your three headline scores, how they moved, and what AI cost this period.",
  },
  /** (b) AI maturity — the modeled level + the measured axes + how the usage
   * actually looks. Distribution over the maturity model, not a redesign. */
  maturity: {
    title: "AI maturity",
    lead: "Your modeled maturity level and the measured breadth, depth, and consistency behind it.",
    fullReport: "Open the full board report",
    exportCsv: "Export board CSV",
  },
  /** (c) Training opportunities / plateau — the action card: who to enable and
   * whether momentum has stalled. */
  training: {
    title: "Training opportunities",
    lead: "Where enablement would move the needle — segments, concentration, and whether growth has flattened.",
    /** Named only above the de-anonymization floor (championSegment). */
    champions: (count: number, label: string) =>
      `Your leading cohort is ${count} ${label.toLowerCase()} — a natural set of internal champions to help the rest of the team level up.`,
    championsCold:
      "Too few people are scored yet to name a leading cohort without singling someone out — invite more of the team to build a clearer picture.",
  },
  /** (d) Benchmarks / distribution — the within-org percentile lens + published
   * norms. */
  distribution: {
    title: "Benchmarks & distribution",
    lead: "How usage spreads across your own people (a within-org percentile lens), next to published norms.",
  },
  /** (e) Data trust — the honesty surface: connector gaps, shared accounts, and
   * how many independent sources feed each person's picture. */
  dataTrust: {
    title: "Data trust",
    lead: "How complete and trustworthy this picture is — reporting gaps, shared accounts, and signal coverage.",
    coverageTitle: "Signal coverage",
    coverageDescription:
      "How many independent sources feed each identified person. A single-source picture rests on a narrower base.",
    coverageEmpty:
      "No identity-resolved people yet — coverage appears once connectors resolve subjects to people.",
    /** Aggregate, never per-named-person. */
    coverageLine: (single: number, total: number) =>
      single === 0
        ? `All ${total} identified ${total === 1 ? "person is" : "people are"} covered by more than one source.`
        : `${single} of ${total} identified ${total === 1 ? "person relies" : "people rely"} on a single source — their scores rest on a narrower base.`,
    gapsTitle: "Reporting gaps",
    gapsEmpty: "No connector is reporting degraded or partial attribution right now.",
  },
  /** Setup — workspace, connections, and the relocated people & teams roster. */
  setup: {
    title: "Setup",
    peopleTeams: "People & teams",
    peopleTeamsDescription:
      "Manage tracked people and team groupings (moved here from the top nav).",
  },
} as const;
