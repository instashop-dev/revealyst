// User-facing copy for the F1.2 "quick analytics" surfaces (M1–M5, M7).
// Glossary-style constant module (the metrics-glossary.ts pattern, G7): ALL
// prose for these surfaces lives here so the dashboard/spend cards, InfoTips,
// and empty states share one wording source and can't drift.
//
// Kept DELIBERATELY separate from metrics-glossary.ts's CONCEPT_GLOSSARY: the
// metrics-glossary banned-phrasing sweep forbids the words "percentile" and
// "quartile" (they read as an invented industry benchmark in SCORE copy),
// but here a percentile is a legitimate descriptive statistic of the ORG'S
// OWN sample — not a benchmark. This module is not swept by that guard.
//
// Confidence discipline (G2): every inferred number carries one of three
// tiers. `measured` = a real count/sum of the org's own rows; `derived` = a
// calculation on top of measured data (a projection); `directional` = an
// uncalibrated signal shown for shape, never billed/ranked. The tier label is
// rendered next to every number these surfaces show.
//
// Denominator discipline (adversarial-review F3/F4): every phrase here names
// EXACTLY the math behind it. Two deliberately distinct terms:
//  - "person-days" = identity-resolved people × distinct active days, DEDUPED
//    across tools (recent-movement.ts activityTotals; unresolved and shared
//    accounts excluded) — used by the M1 movement strip.
//  - "active subject-days" = raw active_day rows summed per tool account
//    (NOT deduped across tools; includes API keys and shared accounts) — used
//    by the M5 cost-per-unit denominator. One person active in two tools
//    counts twice here. The two must never share a term.

export type ConfidenceTier = "measured" | "derived" | "directional";

export const CONFIDENCE_LABELS: Record<ConfidenceTier, string> = {
  measured: "Measured",
  derived: "Derived",
  directional: "Directional",
};

/** Short badge sub-labels used where a plain "Derived" needs its method. */
export const CONFIDENCE_DETAIL: Record<string, string> = {
  straightLine: "derived, straight-line",
  reportedOnly: "reported spend only",
  tokenVolume: "directional · token volume",
};

// ─── M1: recent movement ───

export const RECENT_MOVEMENT_COPY = {
  title: "Recent movement",
  description: (days: number) =>
    `The last ${days} complete days versus the ${days} days before. Today is excluded while its data is still arriving.`,
  info: "Period-over-period change in spend and activity, compared over complete days only — today is a partial day mid-sync, so including it would fake a dip every morning. A period with no prior data shows “new” rather than a made-up jump.",
  confidence: "measured" as ConfidenceTier,
  metrics: {
    reported_spend: {
      label: "Vendor-reported spend",
      short: "Billed spend from your tools over the period.",
    },
    active_people: {
      label: "Active people",
      short:
        "Identity-resolved people with activity from their own (non-shared) accounts in the period. Unresolved and shared accounts are excluded, never guessed.",
    },
    active_days: {
      label: "Person-days of activity",
      short:
        "Total identity-resolved person-days in the period: each person counts once per active day, deduped across their tools. Unresolved and shared accounts are excluded.",
    },
  },
  /** Shown in place of a delta chip for the honest non-delta kinds. */
  newLabel: "new",
  newHint: "No earlier period to compare against yet.",
} as const;

// ─── M3: within-org usage distribution ───

export const USAGE_DISTRIBUTION_COPY = {
  title: "Usage distribution",
  description: (days: number) =>
    `How active days per person are spread across your team over the last ${days} complete days.`,
  info: "A shape-of-the-team read: how many people used AI on few days versus most days, over the period. Bands split the period into quarters by how many of its days each person was active — they describe THIS team's spread, not an outside benchmark. Counts only identity-resolved people using their own accounts: usage from unresolved keys and shared (multi-person) accounts is excluded rather than guessed. Aggregate only: no individual is named or ranked.",
  confidence: "measured" as ConfidenceTier,
  /** Rendered when fewer than the minimum resolved people exist. */
  empty: {
    title: "Not enough people to show a distribution",
    body: (min: number) =>
      `A usage distribution needs at least ${min} identity-resolved people with activity in the period. Connect more tools or resolve more identities to see how usage is spread.`,
  },
  bandHint: {
    occasional: "Active on up to a quarter of the period's days.",
    regular: "Active on a quarter to half of the period's days.",
    frequent: "Active on half to three-quarters of the period's days.",
    near_daily: "Active on more than three-quarters of the period's days.",
  },
  medianLabel: "Median active days",
  p90Label: "90th-percentile active days",
} as const;

// ─── M4: usage concentration ───

export const USAGE_CONCENTRATION_COPY = {
  title: "Usage concentration",
  description:
    "How concentrated attributed prompt volume is among your heaviest resolved users.",
  info: "The share of prompts ATTRIBUTED TO IDENTITY-RESOLVED PEOPLE that comes from the busiest of them — a read on whether attributed AI use is broad or carried by a few. Prompts from unresolved keys/accounts and shared (multi-person) accounts are NOT in this math; when they exist, the panel says how much was left out. DIRECTIONAL: the 10% / 25% cut points are not calibrated against any benchmark, and this is prompt volume, not a productivity or value measure. Aggregate only: the heavy users are counted, never named.",
  confidence: "directional" as ConfidenceTier,
  empty: {
    title: "Not enough usage to show concentration",
    body: (min: number) =>
      `A concentration read needs at least ${min} identity-resolved people with recorded prompts in the period. It appears once enough prompt volume is attributed.`,
  },
  /** Sentence built from the computed shares. `topPct` is the ACTUAL cohort
   * share (people ÷ resolved people), computed from the cohort used — never a
   * nominal "10%" when 1 of 4 people is really 25%. */
  sentence: (topPct: number, sharePct: number, people: number) =>
    `The top ${topPct}% of resolved users (${people} ${people === 1 ? "person" : "people"}) generated ${Math.round(sharePct)}% of attributed prompts.`,
  /** Disclosure for volume the per-person math honestly could not include. */
  excludedNote: (prompts: number) =>
    `${prompts.toLocaleString("en-US")} prompt${prompts === 1 ? "" : "s"} from unresolved or shared accounts ${prompts === 1 ? "is" : "are"} not included in these shares.`,
} as const;

// ─── M2: spend run-rate projection ───

export const SPEND_PROJECTION_COPY = {
  title: "Projected month-end spend",
  description: "A straight-line estimate of where this month's vendor-reported spend lands.",
  info: "Extrapolates the month-to-date vendor-reported spend at the same daily rate for the rest of the month. DERIVED, not billed — actual spend varies with usage, and this uses vendor-reported cost only (estimated spend never feeds it). Shown only once there's reported spend to project from.",
  confidence: "derived" as ConfidenceTier,
  confidenceDetail: CONFIDENCE_DETAIL.straightLine,
  basisLabel: (dayOfMonth: number, daysInMonth: number) =>
    `Based on ${dayOfMonth} of ${daysInMonth} days so far.`,
} as const;

// ─── M5: cost-per-unit ───

export const COST_PER_UNIT_COPY = {
  title: "Unit economics",
  description: "Vendor-reported cost per unit of usage this month.",
  info: "Vendor-reported month-to-date spend divided by usage across ALL connected tools. A ratio needs real data on both sides — if there's no billed spend or no usage rows, the figure is omitted rather than shown as zero. Reported spend only; estimated spend never participates. Coverage caveat: spend and usage are not matched per tool, so billed spend from a tool that doesn't report the usage unit (for example, a vendor that reports cost but no prompt counts) still counts in the numerator.",
  confidence: "measured" as ConfidenceTier,
  confidenceDetail: CONFIDENCE_DETAIL.reportedOnly,
  perActiveDay: {
    label: "Cost per active subject-day",
    short:
      "Billed spend ÷ active subject-days this month. A subject-day is one tool account active on one day — a person active in two tools counts twice, and API keys and shared accounts count too. This is NOT the deduped person-days figure on the dashboard.",
  },
  perPrompt: {
    label: "Cost per prompt",
    short:
      "Billed spend ÷ total prompts recorded this month, across all tools that report prompt counts.",
  },
  emptyBody:
    "A unit cost appears once there's both vendor-reported spend and matching usage this month.",
} as const;

// ─── M7: model-mix trend ───

export const MODEL_MIX_TREND_COPY = {
  title: "Model-mix trend",
  description: "How each model's share of token volume has shifted week over week.",
  info: "The change in each model's share of total token volume between the first and last complete week of the window — partial weeks (including the current one) are dropped, so a lone Monday-morning request can never read as a whole week's mix. DIRECTIONAL token-volume mix — not a per-model dollar split: Revealyst doesn't ingest a per-model dollar split, so cost by model is not shown rather than estimated. A model absent in a counted week counts as 0% that week, which is the shift being shown.",
  confidence: "directional" as ConfidenceTier,
  confidenceDetail: CONFIDENCE_DETAIL.tokenVolume,
  empty:
    "A model-mix trend needs at least two complete weeks of per-model token data. It appears once a connected tool has reported usage by model across multiple full weeks.",
  /** "Opus share 31% → 44%" — built from a ModelShareShift. */
  shiftSentence: (model: string, first: number, last: number) =>
    `${model}: ${Math.round(first)}% → ${Math.round(last)}% share`,
} as const;
