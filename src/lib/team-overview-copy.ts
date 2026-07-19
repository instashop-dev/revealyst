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
      "Who's using AI, how deeply, and what it costs — across your tools, aggregate by default.",
  },
  /** Narrative hero (U4.1): the period story leads the page, and one CTA points
   * to the single safe enablement action (the training section below). */
  hero: {
    ctaLabel: "See where to focus",
  },
  /** Data-freshness indicator (P2c / TCI-FE-002): a small "Data as of …" line in
   * the page header so a manager reads how current the whole surface is without
   * scrolling to the maturity banner. `date` is pre-formatted at the edge;
   * `staleSuffix` appends only when the freshest sync predates the current
   * period (the maturity banner carries the full explanation). Honest by
   * construction — omitted entirely when nothing has synced yet. */
  freshness: {
    asOf: (date: string) => `Data as of ${date}`,
    staleSuffix: "older than the current period",
  },
  /** Distribution completeness (P2c): the honest count of tracked people with no
   * measured AI activity in the period yet, shown beside the segment split so
   * the breakdown never implies the segmented people are the whole team.
   * COUNT-ONLY (no names/ids) and positive-first — "not yet active", never a
   * deficiency label — and it states they'll appear once their first activity
   * comes in. */
  notYetActive: (count: number) =>
    `${count} ${count === 1 ? "person" : "people"} not yet active — no AI usage measured yet this period. They'll appear here once their first activity comes in.`,
  /** ONE shared suppression note (U4.1). Rendered wherever a small-group floor
   * would otherwise drop a row or panel with no explanation. `minPeople` is the
   * live floor constant (SEGMENT_MIN_PEOPLE_TO_NAME) — never hard-coded — and
   * the wording is count-free: it states the rule, never how many were hidden. */
  floorNote: (minPeople: number) =>
    `Shown only for groups of ${minPeople} or more people, to protect individuals.`,
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
    /** Section-level intro under the heading (distinct from the per-card
     * description below): frames the whole section for a manager. */
    sectionLead:
      "Where to help your team next — who's leading, where to coach, and whether momentum has stalled. Aggregate only, never a read on any one person.",
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
