import type { AttributionLevel } from "../contracts/attribution";
import type { HonestyGap } from "../contracts/connector";
import { CANONICAL_METRICS } from "../contracts/metrics";
import type { ScoreComponent } from "../contracts/scores";
import type { SharedAccountReason } from "./shared-account/heuristics";

// Plain-English metrics glossary (metrics-UX redesign). Pure data + pure
// functions, no React. Every score/component entry below is derived from the
// LIVE preset definitions (drizzle/0009_seed-score-presets.sql) via
// describeCalculation() — weights and normalization bounds are read off the
// component objects, never hard-coded twice. METRIC_REFERENCE mirrors
// drizzle/0007_seed-metric-catalog.sql verbatim (a completeness test parses
// the seed and diffs it against this constant).
//
// Copy discipline (invariant b — prose is a claim surface): howToInterpret
// fields are reading guidance only, never an invented threshold/benchmark
// stated as fact. Every "misconception" note below is checked against the
// engine (src/scoring/evaluate.ts) and the seed, not invented.

export type HonestyGapKind = HonestyGap["kind"];

export type GlossaryEntry = {
  key: string;
  plainName: string;
  /** 1 sentence, InfoTip popover body. */
  shortWhat: string;
  what: string;
  whyItMatters: string;
  howCalculatedSimple: string;
  howCalculatedDetailed: string;
  included?: string;
  excluded?: string;
  /** Guidance framing ONLY — never a stated benchmark/threshold as fact. */
  howToInterpret: string;
  example?: string;
  misconception?: string;
  relatedKeys?: string[];
};

export type ScoreSlug = "adoption" | "fluency" | "efficiency";

export type ScoreGlossaryEntry = GlossaryEntry & {
  slug: ScoreSlug;
  components: Record<string, GlossaryEntry>;
};

export const SCORE_SLUGS: readonly ScoreSlug[] = [
  "adoption",
  "fluency",
  "efficiency",
] as const;

// ─── Metric catalog reference (mirrors drizzle/0007_seed-metric-catalog.sql verbatim) ───

export const METRIC_REFERENCE: Record<string, { name: string; description: string }> = {
  active_day: {
    name: "Active day",
    description:
      "Subject had any activity on this UTC day (value 1). Engaged days and DAU/WAU/MAU are query-time aggregations over this flag — never stored as separate facts.",
  },
  sessions: {
    name: "Sessions",
    description:
      "Distinct sessions per day. Gap on GitHub Copilot IDE (CLI only) and OpenAI (no session concept); synthesized from event timestamps on Cursor.",
  },
  prompts: {
    name: "Prompts / messages",
    description:
      "User-initiated prompts or messages per day (interaction counts; API request counts where that is all the vendor exposes).",
  },
  tokens_input: {
    name: "Input tokens",
    description: "Uncached input tokens per day.",
  },
  tokens_output: {
    name: "Output tokens",
    description: "Output tokens per day.",
  },
  tokens_cache_read: {
    name: "Cache-read tokens",
    description: "Cache-read input tokens per day.",
  },
  tokens_cache_write: {
    name: "Cache-write tokens",
    description: "Cache-creation input tokens per day.",
  },
  spend_cents: {
    name: "Spend",
    description:
      "Vendor-authoritative cost in USD cents (cost reports / billing APIs). Never mixed with estimates — see spend_cents_estimated.",
  },
  spend_cents_estimated: {
    name: "Estimated spend",
    description:
      "Derived spend in USD cents (tokens x price list, or vendor per-user estimates). Labeled estimated by key; UI must not present it as billing truth.",
  },
  model_requests: {
    name: "Requests by model",
    description: "Requests per day per model (dim = model).",
  },
  model_tokens: {
    name: "Tokens by model",
    description: "Total tokens per day per model (dim = model).",
  },
  suggestions_offered: {
    name: "Suggestions offered",
    description: "Completion-funnel denominator: suggestions / generations shown per day.",
  },
  suggestions_accepted: {
    name: "Suggestions accepted",
    description:
      "Completion-funnel numerator: suggestions accepted per day. Acceptance rate is computed, never stored.",
  },
  edit_actions_accepted: {
    name: "Edit actions accepted",
    description:
      "Agent/edit tool actions accepted per day (Claude tool_actions, Cursor tab funnel).",
  },
  edit_actions_rejected: {
    name: "Edit actions rejected",
    description: "Agent/edit tool actions rejected per day.",
  },
  retries: {
    name: "Retries",
    description:
      "Retried requests per day. Documented gap on most vendors — rows are simply absent (never fabricated).",
  },
  feature_used: {
    name: "Feature used",
    description:
      "Feature engaged on this day (value 1; dim = feature, e.g. chat_panel, mcp, subagents).",
  },
  commits: {
    name: "Commits",
    description:
      "Commits attributed to AI tooling per day (vendor-reported, e.g. commits_by_claude_code).",
  },
  pull_requests: {
    name: "Pull requests",
    description: "Pull requests attributed to AI tooling per day (vendor-reported).",
  },
  lines_added: {
    name: "Lines added",
    description: "Lines of code added per day (vendor-reported).",
  },
  lines_removed: {
    name: "Lines removed",
    description: "Lines of code removed per day (vendor-reported).",
  },
  lines_suggested: {
    name: "Lines suggested",
    description:
      "Lines of code suggested per day (completion funnel; LoC acceptance ratio is computed, never stored).",
  },
};

function metricName(metricKey: string): string {
  return METRIC_REFERENCE[metricKey]?.name ?? metricKey;
}

function dimensionNoun(metricKey: string): string {
  const kind = (CANONICAL_METRICS as Record<string, { dimKind: string | null }>)[metricKey]
    ?.dimKind;
  if (kind === "feature") return "features";
  if (kind === "model") return "models";
  return "distinct values";
}

/** Natural phrasing for "counted a day as active because you ___" — grounded
 * in each metric's catalog description, not invented. */
function metricVerbPhrase(metricKey: string): string {
  if (metricKey === "active_day") return "had any AI activity";
  if (metricKey === "feature_used") return "engaged an AI feature";
  return `had a "${metricName(metricKey)}" row`;
}

/**
 * Renders plain-English calculation prose from a LIVE definition component.
 * Weight/min/max always come from the component itself — never hard-coded —
 * and metric names come from METRIC_REFERENCE.
 */
export function describeCalculation(
  component: ScoreComponent,
): { simple: string; detailed: string } {
  const { weight, normalization } = component;
  const weightPct = Math.round(weight * 100);

  if ("metric" in component) {
    const name = metricName(component.metric);
    switch (component.aggregation) {
      case "active_days":
        return {
          simple: `Counts the days you ${metricVerbPhrase(component.metric)}, scaled so ${normalization.max} or more days in the period reads as 100.`,
          detailed: `Counts the distinct calendar days with at least one "${name}" row (unioned across everyone on the team), then scales that count linearly from ${normalization.min} days (0) to ${normalization.max} days (100), clamped at both ends. This component is ${weightPct}% of the score.`,
        };
      case "distinct_dims":
        return {
          simple: `Counts the distinct ${dimensionNoun(component.metric)} you used, scaled so ${normalization.max} or more reads as 100.`,
          detailed: `Counts the distinct ${dimensionNoun(component.metric)} with at least one "${name}" row, then scales that count linearly from ${normalization.min} (0) to ${normalization.max} (100), clamped at both ends. This component is ${weightPct}% of the score.`,
        };
      case "sum":
        return {
          simple: `Adds up "${name}" over the period, scaled so ${normalization.max} or more reads as 100.`,
          detailed: `Sums every "${name}" row in the period, then scales that total linearly from ${normalization.min} (0) to ${normalization.max} (100), clamped at both ends. This component is ${weightPct}% of the score.`,
        };
      case "avg_per_day":
        return {
          simple: `Averages "${name}" per calendar day in the period, scaled so ${normalization.max} or more reads as 100.`,
          detailed: `Sums every "${name}" row in the period and divides by the number of calendar days in the period, then scales that average linearly from ${normalization.min} (0) to ${normalization.max} (100), clamped at both ends. This component is ${weightPct}% of the score.`,
        };
    }
  }

  const numName = metricName(component.ratio.numerator.metric);
  const denName = metricName(component.ratio.denominator.metric);
  return {
    simple: `Divides "${numName}" by "${denName}", scaled so a ratio of ${normalization.max} or more reads as 100. Only computed when both sides have data.`,
    detailed: `Computes "${numName}" (${component.ratio.numerator.aggregation}) divided by "${denName}" (${component.ratio.denominator.aggregation}) over the period, then scales that ratio linearly from ${normalization.min} (0) to ${normalization.max} (100), clamped at both ends. If either side has no rows in the period, this component is left out of the score entirely rather than treated as 0 — a rate needs real data on both sides to be honest. This component is ${weightPct}% of the score.`,
  };
}

// ─── Live component definitions (mirror drizzle/0009_seed-score-presets.sql v1 exactly) ───

const ADOPTION_ACTIVE_DAYS: ScoreComponent = {
  key: "active_days",
  metric: "active_day",
  aggregation: "active_days",
  weight: 0.5,
  normalization: { min: 0, max: 20 },
};
const ADOPTION_TOOL_COVERAGE: ScoreComponent = {
  key: "tool_coverage",
  metric: "feature_used",
  aggregation: "distinct_dims",
  weight: 0.5,
  normalization: { min: 0, max: 6 },
};
const FLUENCY_BREADTH: ScoreComponent = {
  key: "breadth",
  metric: "feature_used",
  aggregation: "distinct_dims",
  weight: 0.33,
  normalization: { min: 0, max: 8 },
};
const FLUENCY_DEPTH: ScoreComponent = {
  key: "depth",
  metric: "active_day",
  aggregation: "active_days",
  weight: 0.33,
  normalization: { min: 0, max: 20 },
};
const FLUENCY_EFFECTIVENESS: ScoreComponent = {
  key: "effectiveness",
  ratio: {
    numerator: { metric: "suggestions_accepted", aggregation: "sum" },
    denominator: { metric: "suggestions_offered", aggregation: "sum" },
  },
  weight: 0.34,
  normalization: { min: 0, max: 0.5 },
};
const EFFICIENCY_OUTPUT_PER_SPEND: ScoreComponent = {
  key: "output_per_spend",
  ratio: {
    numerator: { metric: "suggestions_accepted", aggregation: "sum" },
    denominator: { metric: "spend_cents", aggregation: "sum" },
  },
  weight: 0.5,
  normalization: { min: 0, max: 0.2 },
};
const EFFICIENCY_ENGAGEMENT_PER_SPEND: ScoreComponent = {
  key: "engagement_per_spend",
  ratio: {
    numerator: { metric: "active_day", aggregation: "active_days" },
    denominator: { metric: "spend_cents", aggregation: "sum" },
  },
  weight: 0.5,
  normalization: { min: 0, max: 0.01 },
};

// ─── Score + component glossary ───

export const SCORE_GLOSSARY: Record<ScoreSlug, ScoreGlossaryEntry> = {
  adoption: {
    key: "adoption",
    slug: "adoption",
    plainName: "Adoption",
    shortWhat:
      "How many days people used AI tools, and how many different tools or features they reached for.",
    what: "Adoption combines two signals: how many distinct days your team had any AI activity, and how many different tools or features got used at least once. It is a breadth-and-consistency measure, not a quality measure.",
    whyItMatters:
      "Before you can ask whether AI use is effective, you need to know it's actually happening — Adoption is the baseline read on how broadly and how regularly your tools are being reached for.",
    howCalculatedSimple:
      "Half the score comes from active days (more days with any activity scores higher, up to a cap); half comes from tool coverage (more distinct tools or features touched, up to a cap).",
    howCalculatedDetailed:
      "Two components, each weighted 50%: 'Active days' counts distinct calendar days with any AI activity, scaled to 100 at 20 or more days. 'Tool coverage' counts distinct feature areas used, scaled to 100 at 6 or more. The two weighted contributions are added for the final 0–100 score.",
    included: "Any connected tool's activity, once it has synced.",
    excluded: "Tools you have not connected yet, and the quality of use (that is Fluency's job, not Adoption's).",
    howToInterpret:
      "A higher Adoption score means AI use is broader and more consistent across the period — read a low score as an opportunity to build a habit or connect more tools, not as a judgment on any one person.",
    example:
      "A team active on 15 of the last 20 tracked days, using 4 of the 6 tracked feature areas, would score roughly (15/20)×100×0.5 + (4/6)×100×0.5 ≈ 71.",
    misconception:
      "Adoption is not a completeness score — a perfect 100 just means both components hit their scaling ceilings, not that every possible AI feature is in use.",
    relatedKeys: ["fluency", "active_days", "tool_coverage"],
    components: {
      active_days: {
        key: "active_days",
        plainName: "Active days",
        shortWhat: describeCalculation(ADOPTION_ACTIVE_DAYS).simple,
        what: "The number of distinct calendar days in the period where anyone on the team had any recorded AI activity, from the 'Active day' signal.",
        whyItMatters:
          "Consistent day-to-day use tends to build more durable habits than sporadic bursts, so this is the 'how regularly' half of Adoption.",
        howCalculatedSimple: describeCalculation(ADOPTION_ACTIVE_DAYS).simple,
        howCalculatedDetailed: describeCalculation(ADOPTION_ACTIVE_DAYS).detailed,
        included: "Any UTC calendar day with at least one 'Active day' row from a connected tool, for anyone on the team.",
        excluded: "Days before a tool was connected, or from a tool that has not synced yet.",
        howToInterpret:
          "A day counts once even if five people were active that day — this component measures calendar-day coverage for the team, not total activity volume.",
        example: "13 active days out of a possible 20 scores (13/20)×100 = 65 on this component before weighting.",
        misconception:
          "This component reads the exact same underlying 'Active day' signal as Fluency's Depth component, with the exact same 0–20 scaling — they are not independent measurements, just the same data feeding two different scores.",
        relatedKeys: ["depth"],
      },
      tool_coverage: {
        key: "tool_coverage",
        plainName: "Tool coverage",
        shortWhat: describeCalculation(ADOPTION_TOOL_COVERAGE).simple,
        what: "The number of distinct feature areas (e.g. chat, inline completion, MCP, subagents) used at least once in the period, from the 'Feature used' signal.",
        whyItMatters:
          "Adoption is not just about frequency — reaching for more of what is available is a sign AI use is spreading beyond one narrow use case.",
        howCalculatedSimple: describeCalculation(ADOPTION_TOOL_COVERAGE).simple,
        howCalculatedDetailed: describeCalculation(ADOPTION_TOOL_COVERAGE).detailed,
        included: "Distinct feature-area tags seen at least once, from any connected tool that reports them.",
        excluded:
          "Tools that do not report per-feature detail cannot add to this component (they simply do not contribute — the component still reads whatever other tools do report).",
        howToInterpret:
          "A low tool-coverage score alongside a high active-days score often means the team leans on one tool or feature heavily rather than exploring others — neither pattern is inherently good or bad on its own.",
        example: "3 of 6 tracked feature areas used scores (3/6)×100 = 50 on this component before weighting.",
        misconception:
          "This component reads the same underlying 'Feature used' signal as Fluency's Breadth component, just with a lower scaling ceiling (6 here vs 8 for Breadth) — they are not two independent measurements of different behavior.",
        relatedKeys: ["breadth"],
      },
    },
  },
  fluency: {
    key: "fluency",
    slug: "fluency",
    plainName: "Fluency",
    shortWhat: "How broadly, how deeply, and how effectively your team uses AI tools, in one blended score.",
    what: "Fluency blends three components: Breadth (how many distinct features get used), Depth (how many days had any activity), and Effectiveness (how often AI suggestions actually get accepted).",
    whyItMatters:
      "Adoption alone does not tell you if AI use is actually working — Fluency adds an effectiveness signal on top of breadth and depth so a team that uses AI a lot but rejects most suggestions does not look identical to one whose suggestions are landing.",
    howCalculatedSimple:
      "Breadth is about a third of the score, Depth about a third, and Effectiveness a bit more than a third — the weights are 0.33 / 0.33 / 0.34, not an even three-way split.",
    howCalculatedDetailed:
      "Three components: Breadth (33%, distinct features used, scaled to 100 at 8 or more), Depth (33%, active days, scaled to 100 at 20 or more), Effectiveness (34%, suggestions accepted ÷ suggestions offered, scaled to 100 at a 0.5 ratio or higher). Effectiveness is only computed when both suggestion counts have data in the period.",
    included: "Every connected tool's feature, activity, and (where available) suggestion-acceptance data.",
    excluded:
      "Tools that do not report a suggestion offered/accepted funnel cannot feed Effectiveness — that component is left out of the score entirely, not zeroed, when a tool is the only source and reports neither side.",
    howToInterpret:
      "A high Fluency score means AI use is broad, regular, and its suggestions are landing — a lower score points at which of the three (breadth, depth, or effectiveness) is holding it back, via the component breakdown.",
    example:
      "A team with 6 of 8 features used, 18 of 20 active days, and a 0.3 acceptance ratio would score roughly (6/8)×100×0.33 + (18/20)×100×0.33 + (0.3/0.5)×100×0.34 ≈ 75.",
    misconception:
      "The three weights are 0.33 / 0.33 / 0.34, not an even three-way split — Effectiveness carries a hair more weight than the other two.",
    relatedKeys: ["adoption", "breadth", "depth", "effectiveness"],
    components: {
      breadth: {
        key: "breadth",
        plainName: "Breadth",
        shortWhat: describeCalculation(FLUENCY_BREADTH).simple,
        what: "Distinct feature areas used at least once in the period — the same 'Feature used' signal as Adoption's Tool coverage, scaled to a wider ceiling.",
        whyItMatters:
          "Wider feature use is a sign of a team exploring more of what its AI tools can do, rather than staying in one narrow lane.",
        howCalculatedSimple: describeCalculation(FLUENCY_BREADTH).simple,
        howCalculatedDetailed: describeCalculation(FLUENCY_BREADTH).detailed,
        included: "Distinct feature-area tags seen at least once, from any connected tool that reports them.",
        excluded: "Tools that do not report per-feature detail cannot add to this component.",
        howToInterpret:
          "Read Breadth alongside Depth: broad-but-shallow and narrow-but-consistent are different patterns, and the component breakdown tells you which one you have.",
        example: "5 of 8 tracked feature areas used scores (5/8)×100 = 62.5 on this component before weighting.",
        misconception:
          "This component reads the same 'Feature used' signal as Adoption's Tool coverage component, just scaled to a ceiling of 8 features instead of 6 — the same raw usage produces a different normalized number in each score.",
        relatedKeys: ["tool_coverage"],
      },
      depth: {
        key: "depth",
        plainName: "Depth",
        shortWhat: describeCalculation(FLUENCY_DEPTH).simple,
        what: "Distinct active calendar days in the period — the same 'Active day' signal as Adoption's Active days, scaled the same way.",
        whyItMatters:
          "Depth is the 'how regularly' half of Fluency, mirroring the role Active days plays in Adoption.",
        howCalculatedSimple: describeCalculation(FLUENCY_DEPTH).simple,
        howCalculatedDetailed: describeCalculation(FLUENCY_DEPTH).detailed,
        included: "Any UTC calendar day with at least one 'Active day' row from a connected tool, for anyone on the team.",
        excluded: "Days before a tool was connected, or from a tool that has not synced yet.",
        howToInterpret:
          "Because Depth and Adoption's Active days share both the underlying signal and the scaling range, they will always move together — Depth is not an independent read on regularity.",
        example: "17 active days out of a possible 20 scores (17/20)×100 = 85 on this component before weighting.",
        misconception:
          "This component reads the exact same 'Active day' signal, with the exact same 0–20 scaling, as Adoption's Active days component — the two numbers will always move together, not two separate measurements of the same behavior.",
        relatedKeys: ["active_days"],
      },
      effectiveness: {
        key: "effectiveness",
        plainName: "Effectiveness",
        shortWhat: describeCalculation(FLUENCY_EFFECTIVENESS).simple,
        what: "Suggestions accepted divided by suggestions offered, across every connected tool that reports both — an acceptance rate.",
        whyItMatters:
          "Breadth and Depth tell you AI is being used; Effectiveness tells you whether what it is suggesting is actually useful enough to keep.",
        howCalculatedSimple: describeCalculation(FLUENCY_EFFECTIVENESS).simple,
        howCalculatedDetailed: describeCalculation(FLUENCY_EFFECTIVENESS).detailed,
        included: "Suggestion offered/accepted counts from any connected tool that reports a completion funnel.",
        excluded:
          "Tools with no offered/accepted funnel (see Honesty gaps) contribute nothing here; this component is omitted entirely when either side has no data in the period, never computed from just one side.",
        howToInterpret:
          "A higher Effectiveness score means a larger share of AI suggestions get accepted — read a lower one as a prompt to look at why suggestions are being rejected, not as a productivity verdict by itself.",
        example: "126 accepted out of 420 offered is a 0.3 ratio, scoring (0.3/0.5)×100 = 60 on this component before weighting.",
        misconception:
          "Acceptance rate is always computed fresh from both counts for the period — it is never itself stored as a metric row, so there is no raw 'acceptance rate' number anywhere except this calculation.",
        relatedKeys: [],
      },
    },
  },
  efficiency: {
    key: "efficiency",
    slug: "efficiency",
    plainName: "Efficiency",
    shortWhat: "Output and engagement per dollar of AI spend, blended into one score.",
    what: "Efficiency blends two components: Output per spend (suggestions accepted per cent spent) and Engagement per spend (active days per cent spent).",
    whyItMatters:
      "Spend without context does not tell you if AI is paying for itself — pairing accepted-output and engagement against spend gives a rough read on value per dollar.",
    howCalculatedSimple: "Half the score is Output per spend, half is Engagement per spend.",
    howCalculatedDetailed:
      "Two components, each 50%: Output per spend (accepted suggestions ÷ spend in cents, scaled to 100 at a ratio of 0.2 or higher) and Engagement per spend (active days ÷ spend in cents, scaled to 100 at a ratio of 0.01 or higher). Both are only computed when spend data exists for the period — a ratio needs data on both sides.",
    included: "Spend and, respectively, suggestion-acceptance or active-day data from connected tools.",
    excluded: "Tools with no spend data recorded (vendor-authoritative or estimated) cannot feed either component for that tool's usage.",
    howToInterpret:
      "A higher Efficiency score means more accepted output and more active engagement per dollar — read it alongside Adoption and Fluency, since a small, highly engaged user base can score higher here than a larger but less engaged one.",
    example:
      "1,200 accepted suggestions against $50 (5,000 cents) of spend is a ratio of 0.24, which clamps to 100 on Output per spend before weighting.",
    misconception:
      "Efficiency uses whichever spend figure was recorded for the period — if that is the estimated spend (for tools billed only by a computed estimate), the ratio inherits that estimate's uncertainty; it is not automatically the vendor-authoritative figure.",
    relatedKeys: ["output_per_spend", "engagement_per_spend"],
    components: {
      output_per_spend: {
        key: "output_per_spend",
        plainName: "Output per spend",
        shortWhat: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).simple,
        what: "Suggestions accepted, divided by spend in cents, over the period — how much accepted output you are getting per dollar.",
        whyItMatters:
          "This is the closest Efficiency comes to a direct 'value for spend' read: accepted suggestions per dollar spent.",
        howCalculatedSimple: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).simple,
        howCalculatedDetailed: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).detailed,
        included: "Accepted-suggestion and spend rows from connected tools that report both.",
        excluded:
          "Tools with no spend rows recorded contribute nothing to the denominator — this component is left out entirely when either side is missing, never floored to 0.",
        howToInterpret:
          "A higher score means more accepted output per dollar of spend — a low score can mean either low acceptance or high spend, so check Effectiveness and the spend figures alongside it.",
        example: "600 accepted suggestions against 5,000 cents of spend is a ratio of 0.12, scoring (0.12/0.2)×100 = 60 before weighting.",
        misconception:
          "This ratio is never itself stored — spend and acceptance counts are stored, and Revealyst divides them fresh every time this component is computed.",
        relatedKeys: ["engagement_per_spend", "effectiveness"],
      },
      engagement_per_spend: {
        key: "engagement_per_spend",
        plainName: "Engagement per spend",
        shortWhat: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).simple,
        what: "Active days, divided by spend in cents, over the period — how much day-to-day engagement you are getting per dollar.",
        whyItMatters:
          "Pairs the same 'how regularly' signal used elsewhere against spend, so a highly engaged but low-spend team is recognized alongside a big spender.",
        howCalculatedSimple: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).simple,
        howCalculatedDetailed: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).detailed,
        included: "Active-day and spend rows from connected tools that report both.",
        excluded: "Tools with no spend rows recorded contribute nothing to the denominator — this component is left out entirely when either side is missing.",
        howToInterpret:
          "A high score here paired with a low Adoption score usually means spend is unusually low relative to a small but consistently active group, not that engagement is unusually high in absolute terms.",
        example: "12 active days against 5,000 cents of spend is a ratio of 0.0024, scoring (0.0024/0.01)×100 = 24 before weighting.",
        misconception:
          "This is the same 'Active day' count used in Adoption's Active days and Fluency's Depth, this time divided by spend rather than scaled on its own — a high Engagement per spend score does not necessarily mean high Adoption if spend is unusually low.",
        relatedKeys: ["output_per_spend", "active_days", "depth"],
      },
    },
  },
};

// ─── Attribution glossary ───

export const ATTRIBUTION_GLOSSARY: Record<
  AttributionLevel,
  { label: string; shortWhat: string; what: string; caveat: string }
> = {
  person: {
    label: "Per-person",
    shortWhat: "Tied to a specific, identity-resolved person.",
    what: "Every row behind this number carries the vendor's strongest per-person identity signal (e.g. a per-user API key or a stable user id) resolved to one of your tracked people.",
    caveat:
      "Even person-level data can still miss some individuals — check Honesty gaps for known vendor holes like OAuth actors not appearing in a report.",
  },
  key_project: {
    label: "Key / project",
    shortWhat: "Tied to an API key or project, not a specific person.",
    what: "The data is scoped to a key or project rather than a resolved person — useful when several people might share that key or project.",
    caveat:
      "Do not read this as 'nobody used it' or evenly split it across a team — it is simply not resolved to a person yet.",
  },
  account: {
    label: "Account-level",
    shortWhat: "Tied to a whole vendor account or workspace, the widest possible scope.",
    what: "The data reflects an entire account (which may include a shared login or a workspace-wide total) rather than any narrower slice.",
    caveat:
      "Account-level numbers are the most likely to include shared-account activity — check Shared accounts for accounts that look like more than one person.",
  },
};

// ─── Honesty gap glossary (all 6 HonestyGap kinds) ───

export const HONESTY_GAP_GLOSSARY: Record<HonestyGapKind, { label: string; shortWhat: string }> = {
  oauth_actors_missing: {
    label: "OAuth users may be missing",
    shortWhat: "Some people who sign in with OAuth instead of an API key are not appearing in this vendor's usage reports.",
  },
  telemetry_only_users_in_totals: {
    label: "Telemetry-only users in totals, not detail",
    shortWhat: "Some people show up in this vendor's overall active-user counts but not in the per-person breakdown.",
  },
  shared_key_not_person_level: {
    label: "Shared key, not person-level",
    shortWhat: "This usage came through a shared API key, so it cannot be tied to one specific person.",
  },
  service_accounts_unresolved: {
    label: "Service account not yet linked",
    shortWhat: "This activity came from a service account that has not been linked to a person.",
  },
  sub_daily_unavailable: {
    label: "No hour-by-hour detail available",
    shortWhat: "This vendor only reports daily totals, so Revealyst cannot show activity by time of day for it.",
  },
  other: {
    label: "Other known limitation",
    shortWhat: "A vendor-specific gap that does not fit the other categories — see the detail for specifics.",
  },
};

// ─── Shared-account reason labels (single source; sentence case) ───

export const SHARED_ACCOUNT_REASON_LABELS: Record<SharedAccountReason, string> = {
  round_the_clock: "Active around the clock",
  concurrent_usage: "Multiple overlapping sessions",
  volume_exceeds_team_median: "Usage far above the rest of the team",
};

// ─── Concept glossary ───

export const CONCEPT_GLOSSARY: Record<
  | "benchmarks"
  | "segments"
  | "honesty"
  | "sharedAccounts"
  | "visibility"
  | "estimatedSpend"
  | "attribution",
  GlossaryEntry
> = {
  benchmarks: {
    key: "benchmarks",
    plainName: "Benchmarks",
    shortWhat: "Published reference figures from outside sources, shown next to your scores for context.",
    what: "Benchmarks are externally published figures — not calculated from your data — that Revealyst displays alongside your own scores so you have some outside context. They only appear once verified against a primary source.",
    whyItMatters:
      "A raw score is hard to read in isolation. Comparing it to a published reference point, even a rough one, helps you judge whether a number is worth a closer look.",
    howCalculatedSimple: "Not calculated — sourced. Each benchmark row is a value or range pulled from a named, verified external source.",
    howCalculatedDetailed:
      "Revealyst only shows a benchmark once it is marked verified against a primary source; every row records where it came from (sourceName) so you can check it yourself. Nothing here is derived from your organization's own metric_records.",
    included: "Only benchmark rows marked verified against a primary source.",
    excluded:
      "Any figure Revealyst has not been able to verify — a note that benchmarks are still being verified is shown instead of a guess.",
    howToInterpret:
      "Use a benchmark as one data point, not a target — organizations differ enormously in tooling, team size, and how long they've been rolling AI tools out.",
    misconception:
      "A missing benchmark for your score type does not mean your score is unusual — it means Revealyst has not verified a source for that comparison yet.",
  },
  segments: {
    key: "segments",
    plainName: "Segments",
    shortWhat: "Four usage bands — Skeptics, Casual, Power Users, AI Natives — people are grouped into based on their own Adoption score.",
    what: "Segments bucket each person with a person-level Adoption score into one of four bands, purely by that score's value.",
    whyItMatters:
      "Seeing how many people fall into each band is a faster read on team-wide adoption than scanning individual scores one at a time.",
    howCalculatedSimple: "Buckets each person's latest Adoption score into one of four ranges.",
    howCalculatedDetailed:
      "For each person with a person-level Adoption score in the window, the most recent one (by period end) is compared against four render-time bands to assign Skeptic, Casual, Power User, or AI Native. People with no person-level Adoption score yet are counted as 'unsegmented', never forced into a band.",
    included: "People with at least one computed person-level Adoption score in the window.",
    excluded: "People with no person-level Adoption score yet — counted separately as unsegmented, never guessed into a band.",
    howToInterpret:
      "The band names describe a usage pattern Revealyst observed, not a judgment of the person — someone in the lowest band may simply not have needed the tools yet this period.",
    misconception:
      "The segment boundaries are a display convenience, not a precisely calibrated cutoff — treat them as rough buckets, not an exact measurement.",
  },
  honesty: {
    key: "honesty",
    plainName: "Honesty gaps",
    shortWhat: "Known holes in what a vendor can tell Revealyst, surfaced instead of hidden.",
    what: "An honesty gap is a documented limitation in what a connected tool's data can show — for example, a vendor that only reports daily totals with no hour-by-hour detail. Revealyst tells you about it instead of quietly filling in a guess.",
    whyItMatters:
      "Numbers that look complete but silently omit real gaps are more dangerous than numbers that admit what they don't know — you can act correctly on an honest 'we can't see this' but not on a fabricated figure.",
    howCalculatedSimple: "Not a calculation — a list of known vendor limitations, one entry per gap kind your connections have actually hit.",
    howCalculatedDetailed:
      "Each connector run can report zero or more gaps; Revealyst deduplicates them by kind and detail and shows the unique set for the period.",
    howToInterpret:
      "A gap means 'this specific thing is not visible to us right now', not 'the score is wrong' — a score can still be trustworthy even with an unrelated gap present.",
    misconception:
      "A missing (omitted) score component is a different thing from a component that scored 0 — 0 means Revealyst measured real activity and it came out to zero; an omitted component means there was not enough data on at least one side to compute it honestly. Never read the two the same way.",
    relatedKeys: ["oauth_actors_missing", "telemetry_only_users_in_totals", "sub_daily_unavailable"],
  },
  sharedAccounts: {
    key: "sharedAccounts",
    plainName: "Shared accounts",
    shortWhat: "An account whose usage pattern looks like more than one person is using it.",
    what: "A shared-account flag is an advisory signal — round-the-clock activity, overlapping simultaneous sessions, or usage volume far above the rest of the team — that suggests one vendor seat is really being used by several people.",
    whyItMatters:
      "If several people share one login, Adoption and other per-person numbers undercount how many people are actually using AI — the flag tells you where to look before drawing conclusions from those numbers.",
    howCalculatedSimple:
      "Looks for round-the-clock activity, overlapping sessions, or usage several times the team's typical level, and flags the account if it sees one or more of those patterns.",
    howCalculatedDetailed:
      "Round-the-clock and concurrent-session signals come from intra-day activity data, when the vendor provides it; the volume signal compares an account's usage to the median of the rest of the team's accounts, only once there are enough other accounts to make a median meaningful. A vendor that cannot provide intra-day data simply cannot trigger the first two signals for that account — it is not guessed.",
    included: "Accounts whose usage pattern triggered at least one of the three signals.",
    excluded: "Accounts with no triggering pattern are simply absent from the list — never shown as an explicit 'not shared'.",
    howToInterpret:
      "Treat a flag as a reason to investigate (for example, by issuing per-person keys), not as proof — a single account with heavy but genuinely solo usage can still trigger the volume signal.",
    example:
      "A support-bot API key used continuously across all 24 hours of the day, every day, would likely trigger the round-the-clock signal even if only one automated process is behind it — investigate before assuming it is a person.",
    misconception:
      "A shared-account flag never changes any score or creates a new person record on its own — it is metadata for a human to act on, and the account still only counts its already-resolved identities in any per-user number.",
    relatedKeys: ["round_the_clock", "concurrent_usage", "volume_exceeds_team_median"],
  },
  visibility: {
    key: "visibility",
    plainName: "Visibility mode",
    shortWhat: "The org-wide setting for whether real names appear anywhere in Revealyst, or everyone stays pseudonymous.",
    what: "Visibility mode controls whether a person's real display name is ever shown next to their data. In the private default, everyone appears only by a team-level pseudonym; managed and full modes allow real names through.",
    whyItMatters:
      "AI-adoption data can feel invasive if it is tied to real names by default — the private default keeps it pseudonymous, so a workspace can safely show adoption, fluency, and efficiency without exposing who is behind any one number, unless the org has deliberately opted into a more open mode.",
    howCalculatedSimple: "Not a calculation — a single setting read at render time.",
    howCalculatedDetailed:
      "Every place a person could be identified (a score's person reference, a segment's member list, a shared-account flag's account identifier) is redacted to null unless the org's visibility mode is 'managed' or 'full'. This is enforced structurally at one gate, not as an after-the-fact filter.",
    howToInterpret: "If you do not see a name where you expected one, that is the private default working as intended, not a bug.",
    misconception:
      "Private mode still counts every person correctly in aggregate numbers (like Active people) — it hides identity, not activity.",
  },
  estimatedSpend: {
    key: "estimatedSpend",
    plainName: "Estimated spend",
    shortWhat: "Spend Revealyst calculated (tokens × price list, or a vendor's own per-user estimate) rather than read from a vendor bill.",
    what: "Estimated spend is a derived cost figure — for tools that do not give Revealyst a vendor-authoritative bill, it is computed from token usage and public pricing, or taken from a vendor's own estimate field.",
    whyItMatters:
      "It is the only way to show spend for some tools (like local Claude Code usage) at all — but because it is a calculation, not an invoice, it can diverge from what you are actually billed.",
    howCalculatedSimple: "Tokens used, multiplied by a public price list — or a vendor's own estimated-cost field, when that is all the vendor exposes.",
    howCalculatedDetailed:
      "Kept in a separate metric key (spend_cents_estimated) from vendor-authoritative billing spend (spend_cents) and never summed into a single blended 'spend' figure — Revealyst shows both, labeled, side by side.",
    howToInterpret: "Treat it as a directional signal for tools with no billing API, not as a number to reconcile against an invoice.",
    misconception:
      "Estimated spend is never silently blended into the vendor-authoritative spend total — if you see one number where you expected two, check whether the estimated figure is zero (no data) rather than assuming it was merged in.",
  },
  attribution: {
    key: "attribution",
    plainName: "Attribution",
    shortWhat: "How confidently a number can be tied to a specific person, versus a shared key or account.",
    what: "Attribution is a three-level ladder — person, key/project, account — describing the strongest honest claim Revealyst can make about who a piece of usage data belongs to.",
    whyItMatters:
      "Treating account-level data as if it were person-level would let one heavy user's activity get silently spread across a team, or vice versa — the ladder keeps that from happening.",
    howCalculatedSimple:
      "Each row of data starts at the attribution level its vendor can honestly support; anything derived from multiple rows (like a score) inherits the weakest attribution among its inputs.",
    howCalculatedDetailed:
      "A score's attribution is the lowest level across every row any of its components consumed — mixing one person-level row with one account-level row yields an account-level score, never averaged or upgraded.",
    howToInterpret:
      "A 'Per-person' badge means you can trust the number as an individual's; 'Account-level' means treat it as a group figure, not any one person's.",
    misconception:
      "Weaker attribution does not mean the number is wrong — it means Revealyst cannot honestly narrow it down further with the data the vendor provides.",
  },
};

// ─── Lookup helpers ───

/** Any preset component key -> plain label; falls back to a humanized key. */
export function componentLabel(key: string): string {
  for (const slug of SCORE_SLUGS) {
    const entry = SCORE_GLOSSARY[slug].components[key];
    if (entry) return entry.plainName;
  }
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Stable kebab-case anchor ids, unique across scores/components/concepts/metrics. */
export function methodologyAnchor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
