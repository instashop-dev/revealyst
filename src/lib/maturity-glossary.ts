// AI Maturity Model copy (F2.1 / research §10). Pure data + pure helpers, no
// React. This is the ONE source of truth for every level name/definition, axis
// explanation, InfoTip string, and "what we don't measure and why" note the
// maturity report renders — same discipline as metrics-glossary.ts (G7): prose
// is a claim surface, so it lives in a shared constant module and is swept by
// tests/helpers/banned-phrasing.ts.
//
// Honesty posture baked into the copy (invariant b):
//  - The five LEVELS are a MODELED mapping over uncalibrated axis thresholds —
//    the copy says "directional" / "modeled", never states a rung as a
//    certified fact or an industry percentile.
//  - The three AXES are computed from MEASURED usage, but the copy never quotes
//    an outside benchmark as fact (no "industry average", no "top quartile").
//  - Group C refusals (shadow AI, ROI / time-saved) are rendered as first-class
//    "what we deliberately don't measure and why" content — a differentiator,
//    never estimated numbers.
//  - No in-product target ("reach L4 by Q3") anywhere — Goodhart guard.

/** The five telemetry-derived maturity levels (research §10 table). */
export const MATURITY_LEVELS = [0, 1, 2, 3, 4] as const;
export type MaturityLevelValue = (typeof MATURITY_LEVELS)[number];

export type MaturityLevelCopy = {
  /** Short name shown on the banner and the level scale. */
  name: string;
  /** One-line signature (what an org at this level looks like in the data). */
  tagline: string;
  /** A paragraph the report renders under the level banner. */
  description: string;
};

// Review F5: every sentence below states ONLY what the level's gates actually
// check (the activation share, the weekly cadence, and — for L4 — measured
// depth including a recorded agentic signal). Never an unchecked
// characteristic like "use is no longer concentrated in champions" or "leans
// on chat" — concentration is computed separately on the same page and could
// contradict such a claim on the same screen (invariant b).
export const MATURITY_LEVEL_COPY: Record<MaturityLevelValue, MaturityLevelCopy> = {
  0: {
    name: "Dormant",
    tagline: "Very few of the people we can see were active.",
    description:
      "Fewer than a fifth of the people we can identify had any AI activity in the window. This is the normal starting point right after tools are rolled out. The next move is turning access into habit for a first group of people, not adding more tools.",
  },
  1: {
    name: "Trial",
    tagline: "A first minority of the people we can see is active.",
    description:
      "Between a fifth and half of the people we can identify had AI activity in the window. That's real momentum, not saturation — widening use beyond the first movers matters more here than deepening it.",
  },
  2: {
    name: "Adopted",
    tagline: "A majority of the people we can see are active.",
    description:
      "More than half — sometimes far more — of the people we can identify had AI activity in the window, but activity hasn't yet held steadily week to week across it. Reaching the next level is about the cadence holding week after week, not about more people.",
  },
  3: {
    name: "Embedded",
    tagline: "Most people are active, and the cadence holds week to week.",
    description:
      "More than four in five of the people we can identify were active, and their activity recurs steadily across the window's weeks rather than arriving in bursts. From here the ceiling is measured depth — including agent use the connected tools can actually report.",
  },
  4: {
    name: "Amplified",
    tagline: "Broad, steady use with measured agentic depth.",
    description:
      "Most of the people we can identify are active, the weekly cadence is strong, and measured depth — including real, recorded agent activity — clears the bar. This is the leading edge of what the telemetry can show. It describes usage sophistication, a leading indicator — not proven business outcomes.",
  },
};

/** The state shown when there is not enough data to place a level at all —
 * distinct from Dormant (which is a MEASURED low, not an absence). */
export const MATURITY_LEVEL_NONE_COPY = {
  name: "Not enough data yet",
  tagline: "We can't place a maturity level until people and usage are visible.",
  description:
    "A maturity level needs people we can see and usage days to measure. Once your connected tools sync activity and identities are resolved, a level appears here. We don't show a placeholder level — an absence of data is not a level zero.",
} as const;

/** Review F8: shown when the freshest successful sync predates the entire
 * report window — the window's silence is unobserved, not measured, so the
 * level is withheld rather than rendered as a confident low. */
export const MATURITY_LEVEL_STALE_COPY = {
  name: "Level withheld — data is stale",
  tagline: "No connected tool has synced inside this report's window.",
  description:
    "Every axis and level here reads the last 12 complete weeks, but the most recent successful sync is older than that — so the quiet weeks are unobserved, not measured. Re-sync your connections to bring the report current; we don't render a level off data we don't have.",
} as const;

export type MaturityAxisKey = "breadth" | "depth" | "consistency";

export type AxisCopy = {
  label: string;
  /** InfoTip short body — one sentence. */
  shortWhat: string;
  /** The longer explanation the report renders under the axis meter. */
  what: string;
  /** What feeds it, in plain terms. */
  inputs: string;
};

export const MATURITY_AXIS_COPY: Record<MaturityAxisKey, AxisCopy> = {
  breadth: {
    label: "Breadth",
    shortWhat:
      "How widely AI is used — the share of known people who are active, plus how many distinct features are in play.",
    what: "Breadth is about reach: how many of the people we can see are actually using AI, and how many distinct tool features show up in their work. A high breadth score means use is spread across people and surfaces, not stuck with a few power users on one feature.",
    inputs:
      "Active people out of the people we can identify, combined with the count of distinct tool features detected in use. Both are measured from real usage days.",
  },
  depth: {
    label: "Depth",
    shortWhat:
      "How sophisticated the use is — agentic work, multiple features in a day, and parallel agent runs.",
    what: "Depth is about sophistication, not volume: how often people go beyond autocomplete and chat into agentic work, use more than one feature in a day, and run agents in parallel. A high depth score means the work is getting more capable, not just more frequent.",
    inputs:
      "The agentic share of active days, the share of active days that touch more than one feature, and how often more than one agent runs at once. Each side is omitted rather than assumed when a tool can't report it.",
  },
  consistency: {
    label: "Consistency",
    shortWhat:
      "How steady the habit is — whether people show up week after week rather than in bursts.",
    what: "Consistency is about habit: whether use holds week to week or arrives in spikes. It reads the raw active-day cadence over recent weeks — an org where people are active most weeks scores higher than one with the same total usage crammed into a few bursts.",
    inputs:
      "The average share of recent weeks in which each active person had at least one active day, counted from each person's own first active week (with a four-week minimum) so someone who joined mid-window isn't penalized for the weeks before they started. Measured from raw active-day records.",
  },
};

/** The eight board numbers, keyed for the report grid. Copy only — the values
 * and their confidence tiers come from src/lib/maturity.ts. */
export type MaturityNumberKey =
  | "activation"
  | "adoptionVsBenchmark"
  | "maturity"
  | "plateau"
  | "concentration"
  | "costPerActiveUser"
  | "toolSprawl"
  | "agenticShare";

export type NumberCopy = {
  label: string;
  shortWhat: string;
  /** The paired counterweight or honesty caveat shown next to the number
   * (Goodhart guard — e.g. adoption is shown next to concentration). */
  caveat: string;
};

export const MATURITY_NUMBER_COPY: Record<MaturityNumberKey, NumberCopy> = {
  activation: {
    label: "Activation",
    shortWhat:
      "The share of the people we can identify who were active in the recent window.",
    caveat:
      "Activation counts people we can see in your connected tools — it is not a seat-licence count, so it doesn't by itself tell you how many paid seats sit idle.",
  },
  adoptionVsBenchmark: {
    label: "Adoption vs benchmark",
    shortWhat:
      "Your adoption score next to a modeled peer reference point.",
    caveat:
      "The peer reference is modeled and unverified — a directional anchor, not a measured comparison against your actual competitors.",
  },
  maturity: {
    label: "Maturity level & trajectory",
    shortWhat:
      "Your modeled maturity level and how the axes have moved versus the prior window.",
    caveat:
      "The level is a modeled reading of usage sophistication, a leading indicator — not a measure of realized productivity or business outcomes.",
  },
  plateau: {
    label: "Plateau check",
    shortWhat:
      "Whether recent weekly usage is still growing or has flattened.",
    caveat:
      "A directional read of your own recent trend — flattening is a prompt to look, never a verdict that anything is wrong.",
  },
  concentration: {
    label: "Concentration",
    shortWhat:
      "How much of the usage comes from the heaviest-using people.",
    caveat:
      "Shown next to activation on purpose: high adoption with high concentration means fewer people carry the use than the headline suggests.",
  },
  costPerActiveUser: {
    label: "Cost per active user",
    shortWhat:
      "Vendor-reported spend in the window divided by active people.",
    caveat:
      "Vendor-reported spend only — it is a cost efficiency number, not a return-on-investment claim, and we never estimate the value produced.",
  },
  toolSprawl: {
    label: "Tool sprawl",
    shortWhat:
      "Connected tools versus the ones actually producing usage.",
    caveat:
      "Idle connected tools may be intentionally paused — this flags them to review, not to remove.",
  },
  agenticShare: {
    label: "Agentic share",
    shortWhat:
      "The share of AI-active days that used an agent, not just autocomplete or chat.",
    caveat:
      "Not every connected tool reports agent activity — days spent only in tools that don't report it read as non-agentic here.",
  },
};

/** Group C refusals rendered as first-class "what we don't measure and why"
 * content (research §6 Group C; the honesty differentiator). Each is a thing a
 * board might ask for that Revealyst deliberately does NOT put a number on. */
export type NotScoredItem = {
  key: string;
  label: string;
  /** What it would claim to be. */
  what: string;
  /** Why we refuse to put a number on it. */
  why: string;
};

export const MATURITY_NOT_SCORED: NotScoredItem[] = [
  {
    key: "shadow_ai",
    label: "Shadow AI",
    what: "Usage on personal accounts and unconnected tools that never reaches us.",
    why: "We only see the tools you connect. A large share of AI use across the industry happens on personal logins we can't observe, so any org-wide 'shadow AI' figure would be a guess dressed as a measurement. We show what we can attribute and name the rest as a known gap, rather than inventing a number.",
  },
  {
    key: "roi_time_saved",
    label: "ROI and time saved",
    what: "A dollar return or hours-saved figure attributed to AI use.",
    why: "Adoption and usage sophistication are leading indicators, not proven outcomes. Turning usage into a 'time saved' or 'ROI' number requires assumptions we can't verify from telemetry, and the honest posture in this category is to never ship one. We surface the inputs — activation, depth, cost — and leave the outcome claim to you.",
  },
  {
    key: "individual_quality",
    label: "Per-person quality or ranking",
    what: "A scoreboard rating individuals by code quality or output.",
    why: "Team surfaces are aggregate-only by construction. We never rate or rank named individuals on a shared report — person-level views exist only in a person's own self-view, never here. Ranking people would demoralize more than it informs, and it isn't what a maturity read is for.",
  },
  {
    key: "governance_maturity",
    label: "Governance & training maturity",
    what: "A rung for policy, guardrails, and enablement maturity.",
    why: "Those are real, but they're survey and process questions, not telemetry. Folding an unobserved self-assessment into a telemetry-derived level would blur what the number means. If you want to track them, they belong beside this level as a separate, clearly self-reported input.",
  },
];

/** Stable kebab-case anchor ids for InfoTip deep-links / in-page nav. */
export function maturityAnchor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
