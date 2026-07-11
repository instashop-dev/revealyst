import type { ScoreSlug } from "./metrics-glossary";

// Coaching recommendations v1 (F1.1 — the resurrected Spec-V3 Coaching cut).
// Static, task-focused adoption guidance keyed off measured score-component
// gap patterns. Pure data + a lookup — no React, no I/O, no per-user
// generation, no formula DSL, no LLM (tripwire G6/rule 7): this is a fixed
// map from a (score, weak component) pattern to a suggested next action.
//
// Copy discipline (invariant b — prose is a claim surface; W3-N/W3-P):
//  - TASK-focused, never person-focused or blaming (Kluger & DeNisi): every
//    body suggests something to *do* with the tools, never judges a person.
//  - Grounded in what is measurably true: an entry is only ever surfaced by
//    `deriveAttention` when its component is MEASURED (not omitted) and in the
//    bottom reading band — so "measuring low" below is a fact at render time,
//    gated centrally, never a guess (see score-insights.ts `deriveAttention`).
//  - No fabricated numbers, no "time saved" / productivity claims (Group C
//    refusal list), no vendor-specific claims beyond generic capability nouns
//    (chat, inline completion, agent mode) that every connector registry entry
//    already exposes — never a per-vendor feature assertion.
//  - Every rendered recommendation carries `COACHING_GUIDANCE_SUFFIX`
//    (appended by `deriveAttention`, so it can never be forgotten per entry):
//    this is guidance, not a measurement of any individual.

/** The underlying measured signal a recommendation coaches on. Several
 * preset components read the SAME signal (adoption.active_days and
 * fluency.depth are both the 0–20-scaled `active_day` count; adoption.
 * tool_coverage and fluency.breadth are both `feature_used` breadth — the
 * glossary's own misconception notes say they "always move together").
 * `deriveAttention` dedupes candidates by this group BEFORE its cap, so two
 * flavors of the same advice never burn both recommendation slots. */
export type CoachingSignalGroup =
  | "active-days"
  | "feature-breadth"
  | "effectiveness"
  | "output-per-spend"
  | "engagement-per-spend";

export type CoachingRecommendation = {
  /** Stable pattern id, unique across the map. */
  id: string;
  /** The score whose weak component this recommendation addresses. */
  slug: ScoreSlug;
  /** A LIVE preset component key of `slug` (validated in tests against
   * SCORE_GLOSSARY[slug].components — never a raw key with no glossary home). */
  componentKey: string;
  /** Same-signal dedupe group — see `CoachingSignalGroup`. */
  signalGroup: CoachingSignalGroup;
  /** Task-focused, imperative title — an action, never a verdict. */
  title: string;
  /** One-to-three sentences of task-focused guidance. */
  body: string;
};

/** Appended to every rendered recommendation body by `deriveAttention` so the
 * honesty framing (guidance, not measurement) is guaranteed present and can't
 * drift per entry. */
export const COACHING_GUIDANCE_SUFFIX =
  "This is general guidance based on which part of the score is measuring low — not a measurement of any individual.";

// One entry per live preset component (adoption: active_days/tool_coverage;
// fluency: breadth/depth/effectiveness; efficiency: output_per_spend/
// engagement_per_spend). Keyed on the weakest-component pattern each addresses.
export const COACHING_RECOMMENDATIONS: readonly CoachingRecommendation[] = [
  {
    id: "adoption-active-days",
    slug: "adoption",
    componentKey: "active_days",
    signalGroup: "active-days",
    title: "Make AI part of the daily routine",
    body: "The active-days part of Adoption is measuring low. Adoption grows when AI tools get reached for on more days, not just more within a single day. A common starting point is routing one recurring task — a standup summary, a first-draft email, a code-review comment — through an AI tool each day.",
  },
  {
    id: "adoption-tool-coverage",
    slug: "adoption",
    componentKey: "tool_coverage",
    signalGroup: "feature-breadth",
    title: "Broaden which AI features get used",
    body: "The tool-coverage part of Adoption is measuring low, which usually means usage leans on one or two features. Trying an additional connected feature — chat, inline completion, or an agent mode — for a task it fits is a common way to widen coverage.",
  },
  {
    id: "fluency-breadth",
    slug: "fluency",
    componentKey: "breadth",
    signalGroup: "feature-breadth",
    title: "Explore more of what the connected tools can do",
    body: "The breadth part of Fluency is measuring low. Reaching for more distinct features across the connected tools — rather than one narrow use — is what moves it. Picking one unused feature and finding a real task for it is a common approach.",
  },
  {
    id: "fluency-depth",
    slug: "fluency",
    componentKey: "depth",
    signalGroup: "active-days",
    title: "Use AI on more days, not just more per day",
    body: "The depth part of Fluency — how many days had any activity — is measuring low. More regular, day-to-day use tends to build steadier habits than occasional bursts, so spreading AI use across more days is a common way to raise it.",
  },
  {
    id: "fluency-effectiveness",
    slug: "fluency",
    componentKey: "effectiveness",
    signalGroup: "effectiveness",
    title: "Look at why suggestions are being turned down",
    body: "The effectiveness part of Fluency — how often AI suggestions get accepted — is measuring low. Reviewing the kinds of tasks where suggestions get rejected, and adjusting how those tasks are framed to the tool, is a common way to raise acceptance.",
  },
  {
    id: "efficiency-output-per-spend",
    slug: "efficiency",
    componentKey: "output_per_spend",
    signalGroup: "output-per-spend",
    title: "Weigh accepted output against what's being spent",
    body: "The output-per-spend part of Efficiency is measuring low. That can mean low acceptance or high spend relative to accepted output — comparing the accepted-suggestion counts against the billed spend for each tool is a common place to start.",
  },
  {
    id: "efficiency-engagement-per-spend",
    slug: "efficiency",
    componentKey: "engagement_per_spend",
    signalGroup: "engagement-per-spend",
    title: "Check active engagement against what's being spent",
    body: "The engagement-per-spend part of Efficiency is measuring low. Reviewing whether the tools with the most spend are the ones people are actually active in — and rightsizing seats or plans that see little use — is a common way to improve it.",
  },
];

const BY_SLUG_COMPONENT = new Map<string, CoachingRecommendation>(
  COACHING_RECOMMENDATIONS.map((rec) => [`${rec.slug}::${rec.componentKey}`, rec]),
);

/** Looks up the single recommendation for a (score, component) pattern, or
 * `undefined` when no static guidance is mapped for that component. */
export function findCoachingRecommendation(
  slug: ScoreSlug,
  componentKey: string,
): CoachingRecommendation | undefined {
  return BY_SLUG_COMPONENT.get(`${slug}::${componentKey}`);
}
