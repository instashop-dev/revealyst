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
  /** Team goal (TMD P1b, ADR 0061) — the manager-set objective that heads the
   * Command Center. All copy is plain-English and honest: the target and review
   * date are the manager's own input (never a Revealyst promise), and progress
   * shows a MEASURED "now" only when the metric is measured. */
  goal: {
    title: "Team goal",
    /** Shown to a manager when no goal is set yet (members see nothing). */
    empty:
      "No team goal set yet — pick one thing to focus on and a date to review it.",
    setAction: "Set a team goal",
    changeAction: "Change goal",
    drawerTitle: "Set the team goal",
    drawerDescription:
      "Choose one thing to focus on, a target, and when you'll review it. The target and review date are yours to set — Revealyst tracks progress toward them, it doesn't promise the result.",
    metricLabel: "What should the team focus on?",
    targetLabel: "Target (0–100)",
    reviewLabel: "Review by",
    /** The starting-point line under the metric picker. */
    baselineMeasured: (label: string, value: number) =>
      `Starting point — ${label} is measuring ${value} now.`,
    baselineUnmeasured: (label: string) =>
      `${label} isn't measured yet — the starting point fills in once it is.`,
    saveAction: "Save goal",
    saveError: "Couldn't save the goal. Please try again.",
    /** The headline on the goal card once a goal is set. */
    headline: (label: string) => `Focusing on ${label}`,
    /** Progress detail — baseline → target by review date. `baseline` is "—"
     * when it was unmeasured at set time (never a fabricated 0). */
    detail: (baseline: string, target: number, reviewDate: string) =>
      `From ${baseline} toward ${target}, reviewing ${reviewDate}.`,
    /** Appended only when the metric is currently MEASURED. */
    now: (value: number) => `Now measuring ${value}.`,
  },
  /** Initiatives (TMD P2, ADR 0062) — the executable middle of the loop: turn a
   * priority into a tracked effort with a target and a review date. All copy is
   * plain-English and honest — an initiative is a plan to TRACK, never a promise,
   * and participation is shown as a COUNT (the named roster is opened separately
   * by an authorized manager). No gamified vocabulary (Spec V4 §8.4). */
  initiatives: {
    title: "Initiatives",
    lead: "Turn a priority into a tracked effort — a target, a review date, and a measured before-and-after.",
    empty: "No initiatives running yet.",
    startAction: "Start an initiative",
    drawerTitle: "Start an initiative",
    drawerDescription:
      "Pick a starting play, name it, and set a target and a review date. On that date you'll see the measured before-and-after — it's a plan to track, not a promise.",
    templateLabel: "Starting play",
    templateNone: "Choose a starting play…",
    titleLabel: "Name this initiative",
    targetLabel: "Target (0–100)",
    reviewLabel: "Review by",
    saveAction: "Start initiative",
    saveError: "Couldn't start the initiative. Please try again.",
    participants: (n: number) =>
      `${n} ${n === 1 ? "person" : "people"} taking part`,
    reviewOn: (date: string) => `Review ${date}`,
    progressLine: (baseline: string, target: number) =>
      `From ${baseline} toward ${target}.`,
    now: (value: number) => `Now measuring ${value}.`,
    statusLabel: {
      draft: "Draft",
      active: "Active",
      in_review: "In review",
      completed: "Completed",
      stopped: "Stopped",
    } as const,
  },
  /** Capability map (P0b / analysis §5E) — the promoted "what can the team
   * reliably do with AI?" surface: coverage + trend + the count-only insight
   * feed, lifted to the top of the Command Center. Aggregate only. */
  capabilityMap: {
    title: "Capability map",
    lead: "What your team can reliably do with AI — coverage, how it's trending, and where to help next. Aggregate only, never a read on any one person.",
  },
  /** AI maturity detail disclosure — the CSV export + full board-report link.
   * The section title/lead moved to inline copy on the CollapsibleSection when
   * the P0b restructure folded maturity behind progressive disclosure. */
  maturity: {
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
