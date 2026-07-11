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
    `The last ${days} days versus the ${days} days before, across your connected tools.`,
  info: "Period-over-period change in spend and activity. A period with no prior data shows “new” rather than a made-up jump — a change is only shown when there's a real previous period to compare against.",
  confidence: "measured" as ConfidenceTier,
  metrics: {
    reported_spend: {
      label: "Vendor-reported spend",
      short: "Billed spend from your tools over the period.",
    },
    active_people: {
      label: "Active people",
      short: "Identity-resolved people with any activity in the period.",
    },
    active_days: {
      label: "Active days logged",
      short: "Total person-days of activity in the period (each person counted once per active day).",
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
    `How active days per person are spread across your team over the last ${days} days.`,
  info: "A shape-of-the-team read: how many people used AI on few days versus most days, over the period. Bands split the period into quarters by how many of its days each person was active — they describe THIS team's spread, not an outside benchmark. Aggregate only: no individual is named or ranked.",
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
  description: "How concentrated prompt volume is among your heaviest users.",
  info: "The share of all prompts that comes from the busiest slice of people — a read on whether AI use is broad or carried by a few. DIRECTIONAL: the 10% / 25% cut points are not calibrated against any benchmark, and this is prompt volume, not a productivity or value measure. Aggregate only: the heavy users are counted, never named.",
  confidence: "directional" as ConfidenceTier,
  empty: {
    title: "Not enough usage to show concentration",
    body: (min: number) =>
      `A concentration read needs at least ${min} identity-resolved people with recorded prompts in the period. It appears once enough prompt volume is attributed.`,
  },
  /** Sentence built from the computed shares. */
  sentence: (topPct: number, sharePct: number, people: number) =>
    `The top ${topPct}% of users (${people} ${people === 1 ? "person" : "people"}) generated ${Math.round(sharePct)}% of prompts.`,
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
  info: "Vendor-reported month-to-date spend divided by usage. A ratio needs real data on both sides — if there's no billed spend or no usage rows, the figure is omitted rather than shown as zero. Reported spend only; estimated spend never participates.",
  confidence: "measured" as ConfidenceTier,
  confidenceDetail: CONFIDENCE_DETAIL.reportedOnly,
  perActiveDay: {
    label: "Cost per active day",
    short: "Billed spend ÷ total person-days of activity this month.",
  },
  perPrompt: {
    label: "Cost per prompt",
    short: "Billed spend ÷ total prompts this month.",
  },
  emptyBody:
    "A unit cost appears once there's both vendor-reported spend and matching usage this month.",
} as const;

// ─── M7: model-mix trend ───

export const MODEL_MIX_TREND_COPY = {
  title: "Model-mix trend",
  description: "How each model's share of token volume has shifted week over week.",
  info: "The change in each model's share of total token volume between the first and last week of the window. DIRECTIONAL token-volume mix — not a per-model dollar split (no connected vendor reports per-model spend). A model absent in a week counts as 0% that week, which is the shift being shown.",
  confidence: "directional" as ConfidenceTier,
  confidenceDetail: CONFIDENCE_DETAIL.tokenVolume,
  empty:
    "A model-mix trend needs at least two weeks of per-model token data. It appears once a connected tool has reported usage by model across multiple weeks.",
  /** "Opus share 31% → 44%" — built from a ModelShareShift. */
  shiftSentence: (model: string, first: number, last: number) =>
    `${model}: ${Math.round(first)}% → ${Math.round(last)}% share`,
} as const;
