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
  /** Per-tone reading guidance, banded by the same rounded three-way split
   * (0–39 low / 40–69 building / 70–100 strong) src/lib/score-insights.ts's
   * `interpretScore` uses for the score card. This is the ONE copy source
   * for that banded framing — the methodology page renders these same three
   * strings under "How to read it, by range" so the card and the
   * methodology page can never tell a different story about the same score.
   * Framing only, never a stated benchmark/threshold as fact (invariant b) —
   * same discipline as `howToInterpret`, just split per band instead of one
   * paragraph. */
  interpretBands: { low: string; building: string; strong: string };
};

export const SCORE_SLUGS: readonly ScoreSlug[] = [
  "adoption",
  "fluency",
  "efficiency",
] as const;

// ─── Metric catalog reference (mirrors drizzle/0007_seed-metric-catalog.sql verbatim) ───

export const METRIC_REFERENCE: Record<
  string,
  { name: string; description: string; plain: string }
> = {
  active_day: {
    name: "Active day",
    description:
      "Subject had any activity on this UTC day (value 1). Engaged days and DAU/WAU/MAU are query-time aggregations over this flag — never stored as separate facts.",
    plain: "Whether you used any AI tool at all on a given day.",
  },
  sessions: {
    name: "Sessions",
    description:
      "Distinct sessions per day. Gap on GitHub Copilot IDE (CLI only) and OpenAI (no session concept); synthesized from event timestamps on Cursor.",
    plain: "How many separate times you opened an AI tool in a day.",
  },
  prompts: {
    name: "Prompts / messages",
    description:
      "User-initiated prompts or messages per day (interaction counts; API request counts where that is all the vendor exposes).",
    plain: "How many messages or requests you sent to an AI tool in a day.",
  },
  tokens_input: {
    name: "Input tokens",
    description: "Uncached input tokens per day.",
    plain: "How much text you sent into an AI model in a day.",
  },
  tokens_output: {
    name: "Output tokens",
    description: "Output tokens per day.",
    plain: "How much text an AI model sent back to you in a day.",
  },
  tokens_cache_read: {
    name: "Cache-read tokens",
    description: "Cache-read input tokens per day.",
    plain: "How much previously-sent text an AI model reused from its cache in a day.",
  },
  tokens_cache_write: {
    name: "Cache-write tokens",
    description: "Cache-creation input tokens per day.",
    plain: "How much new text was stored in an AI model's cache in a day.",
  },
  spend_cents: {
    name: "Spend",
    description:
      "Vendor-authoritative cost in USD cents (cost reports / billing APIs). Never mixed with estimates — see spend_cents_estimated.",
    plain: "The actual dollar amount billed for AI usage in a day, straight from the vendor.",
  },
  spend_cents_estimated: {
    name: "Estimated spend",
    description:
      "Derived spend in USD cents (tokens x price list, or vendor per-user estimates). Labeled estimated by key; UI must not present it as billing truth.",
    plain: "A rough dollar estimate of AI usage cost for a day, calculated rather than billed.",
  },
  model_requests: {
    name: "Requests by model",
    description: "Requests per day per model (dim = model).",
    plain: "How many requests went to each specific AI model in a day.",
  },
  model_tokens: {
    name: "Tokens by model",
    description: "Total tokens per day per model (dim = model).",
    plain: "How much text was processed by each specific AI model in a day.",
  },
  suggestions_offered: {
    name: "Suggestions offered",
    description: "Completion-funnel denominator: suggestions / generations shown per day.",
    plain: "How many AI code or text suggestions were shown to you in a day.",
  },
  suggestions_accepted: {
    name: "Suggestions accepted",
    description:
      "Completion-funnel numerator: suggestions accepted per day. Acceptance rate is computed, never stored.",
    plain: "How many of those AI suggestions you actually accepted in a day.",
  },
  edit_actions_accepted: {
    name: "Edit actions accepted",
    description:
      "Agent/edit tool actions accepted per day (Claude tool_actions, Cursor tab funnel).",
    plain: "How many AI-proposed edits you accepted in a day.",
  },
  edit_actions_rejected: {
    name: "Edit actions rejected",
    description: "Agent/edit tool actions rejected per day.",
    plain: "How many AI-proposed edits you turned down in a day.",
  },
  retries: {
    name: "Retries",
    description:
      "Retried requests per day. Documented gap on most vendors — rows are simply absent (never fabricated).",
    plain: "How many AI requests had to be retried in a day.",
  },
  feature_used: {
    name: "Feature used",
    description:
      "Feature engaged on this day (value 1; dim = feature, e.g. chat_panel, mcp, subagents).",
    plain: "Which specific AI feature (like chat or autocomplete) you used on a given day.",
  },
  commits: {
    name: "Commits",
    description:
      "Commits attributed to AI tooling per day (vendor-reported, e.g. commits_by_claude_code).",
    plain: "How many code commits were credited to AI assistance in a day.",
  },
  pull_requests: {
    name: "Pull requests",
    description: "Pull requests attributed to AI tooling per day (vendor-reported).",
    plain: "How many pull requests were credited to AI assistance in a day.",
  },
  lines_added: {
    name: "Lines added",
    description: "Lines of code added per day (vendor-reported).",
    plain: "How many lines of code were added with AI help in a day.",
  },
  lines_removed: {
    name: "Lines removed",
    description: "Lines of code removed per day (vendor-reported).",
    plain: "How many lines of code were removed with AI help in a day.",
  },
  lines_suggested: {
    name: "Lines suggested",
    description:
      "Lines of code suggested per day (completion funnel; LoC acceptance ratio is computed, never stored).",
    plain: "How many lines of code an AI tool suggested in a day.",
  },
  agent_sessions: {
    name: "Agent sessions",
    description:
      "Agent/CLI sessions per day (Copilot CLI sessions; Claude Code sessions). Distinct from generic sessions — these are agent-mediated. Absent for vendors with no agent-session concept, never zero-filled.",
    plain: "How many times an AI agent (not just autocomplete) ran a work session for you in a day.",
  },
  agent_requests: {
    name: "Agent requests",
    description:
      "Agent-mode requests per day (Cursor agentRequests; Copilot agent-mode + CLI requests). A gap where a vendor has no agent request count (e.g. Claude Code) — rows are simply absent.",
    plain: "How many requests you made to an AI agent (as opposed to plain chat or autocomplete) in a day.",
  },
  agent_active: {
    name: "Agent used",
    description:
      "Subject used an agentic feature on this UTC day (value 1). The cross-vendor agentic-adoption flag: Copilot used_agent/coding-agent, Cursor agent requests, Claude Code activity.",
    plain: "Whether you used an AI agent at all on a given day.",
  },
  ai_credits: {
    name: "AI credits",
    description:
      "GitHub Copilot AI Credits consumed per day (usage-based billing, vendor-reported). A native credits unit — NOT a dollar amount; a cents conversion would be derived/estimated (spend_cents_estimated) and labeled, never billing truth. Available only from 2026-06-19; earlier days are absence, never zero.",
    plain: "How many GitHub Copilot AI Credits you used in a day (credits, not dollars).",
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
          detailed: `Counts the distinct calendar days with at least one "${name}" row (combined across everyone this score covers), then scales that count linearly from ${normalization.min} days (0) to ${normalization.max} days (100), clamped at both ends. This component is ${weightPct}% of the score.`,
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
      "How many days you (or your team) used AI tools, and how many different tools or features got reached for.",
    what: "Adoption combines two signals: how many distinct days you (or your team) had any AI activity, and how many different tools or features got used at least once. It is a breadth-and-consistency measure, not a quality measure.",
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
      "Being active on 15 of the last 20 tracked days, and using 4 of the 6 tracked feature areas, would score roughly (15/20)×100×0.5 + (4/6)×100×0.5 ≈ 71.",
    misconception:
      "Adoption is not a completeness score — a perfect 100 just means both components hit their scaling ceilings, not that every possible AI feature is in use.",
    relatedKeys: ["fluency", "active_days", "tool_coverage"],
    interpretBands: {
      low: "There's room to build a more regular habit here, or to reach for more of what's connected.",
      building: "A habit is forming — look for ways to use AI more consistently or broaden which tools or features get used.",
      strong: "Usage is broad and consistent across the period.",
    },
    components: {
      active_days: {
        key: "active_days",
        plainName: "Active days",
        shortWhat: describeCalculation(ADOPTION_ACTIVE_DAYS).simple,
        what: "The number of distinct calendar days in the period where you (or anyone this score covers) had any recorded AI activity, from the 'Active day' signal.",
        whyItMatters:
          "Consistent day-to-day use tends to build more durable habits than sporadic bursts, so this is the 'how regularly' half of Adoption.",
        howCalculatedSimple: describeCalculation(ADOPTION_ACTIVE_DAYS).simple,
        howCalculatedDetailed: describeCalculation(ADOPTION_ACTIVE_DAYS).detailed,
        included: "Any UTC calendar day with at least one 'Active day' row from a connected tool, for anyone this score covers.",
        excluded: "Days before a tool was connected, or from a tool that has not synced yet.",
        howToInterpret:
          "A day counts once even if several people were active that day — this component measures calendar-day coverage, not total activity volume.",
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
          "A low tool-coverage score alongside a high active-days score often means usage leans on one tool or feature heavily rather than exploring others — neither pattern is inherently good or bad on its own.",
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
    shortWhat: "How broadly, how deeply, and how effectively you (or your team) use AI tools, in one blended score.",
    what: "Fluency blends three components: Breadth (how many distinct features get used), Depth (how many days had any activity), and Effectiveness (how often AI suggestions actually get accepted).",
    whyItMatters:
      "Adoption alone does not tell you if AI use is actually working — Fluency adds an effectiveness signal on top of breadth and depth, so using AI a lot but rejecting most suggestions does not look identical to use whose suggestions are landing.",
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
      "Using 6 of 8 features, being active 18 of 20 days, and a 0.3 acceptance ratio would score roughly (6/8)×100×0.33 + (18/20)×100×0.33 + (0.3/0.5)×100×0.34 ≈ 75.",
    misconception:
      "The three weights are 0.33 / 0.33 / 0.34, not an even three-way split — Effectiveness carries a hair more weight than the other two.",
    relatedKeys: ["adoption", "breadth", "depth", "effectiveness"],
    interpretBands: {
      low: "Breadth, depth, or how often suggestions get accepted all have room to grow here.",
      building: "Fluency is developing — usage is broadening, or suggestions are starting to land more often.",
      strong: "Usage is broad, regular, and suggestions are landing well.",
    },
    components: {
      breadth: {
        key: "breadth",
        plainName: "Breadth",
        shortWhat: describeCalculation(FLUENCY_BREADTH).simple,
        what: "Distinct feature areas used at least once in the period — the same 'Feature used' signal as Adoption's Tool coverage, scaled to a wider ceiling.",
        whyItMatters:
          "Wider feature use is a sign of exploring more of what your AI tools can do, rather than staying in one narrow lane.",
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
        included: "Any UTC calendar day with at least one 'Active day' row from a connected tool, for anyone this score covers.",
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
        what: "Suggestions accepted divided by suggestions offered, summed across your connected tools — an acceptance rate.",
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
    what: "Efficiency blends two components: Output per spend (suggestions accepted per cent of billed spend) and Engagement per spend (active days per cent of billed spend).",
    whyItMatters:
      "Spend without context does not tell you if AI is paying for itself — pairing accepted-output and engagement against spend gives a rough read on value per dollar.",
    howCalculatedSimple: "Half the score is Output per spend, half is Engagement per spend.",
    howCalculatedDetailed:
      "Two components, each 50%: Output per spend (accepted suggestions ÷ billed spend in cents, scaled to 100 at a ratio of 0.2 or higher) and Engagement per spend (active days ÷ billed spend in cents, scaled to 100 at a ratio of 0.01 or higher). Both use vendor-authoritative billed spend only — never estimated spend — and are only computed when that billed-spend data exists for the period, since a ratio needs data on both sides.",
    included: "Billed, vendor-authoritative spend and, respectively, suggestion-acceptance or active-day data from connected tools.",
    excluded:
      "A tool that only reports estimated spend (never a vendor bill) contributes nothing to either denominator, the same as a tool with no spend data at all. If no connected tool has billed spend for the period, both components are omitted entirely.",
    howToInterpret:
      "A higher Efficiency score means more accepted output and more active engagement per dollar of billed spend — read it alongside Adoption and Fluency, since a small, highly engaged user base can score higher here than a larger but less engaged one.",
    example:
      "1,200 accepted suggestions against $50 (5,000 cents) of billed spend is a ratio of 0.24, which clamps to 100 on Output per spend before weighting.",
    misconception:
      "Efficiency's denominator is always billed, vendor-authoritative spend (spend_cents) — estimated spend is a separate figure shown alongside it and never feeds either ratio, no matter how confident the estimate is.",
    relatedKeys: ["output_per_spend", "engagement_per_spend"],
    interpretBands: {
      low: "Value per dollar is low relative to spend right now — that can mean low usage, but it can also mean spend is high relative to usage, so check the spend figures alongside it.",
      building: "Value per dollar is building relative to spend — usage and spend are starting to balance out.",
      strong: "Value per dollar is strong relative to spend — accepted output and engagement are high for what's being spent.",
    },
    components: {
      output_per_spend: {
        key: "output_per_spend",
        plainName: "Output per spend",
        shortWhat: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).simple,
        what: "Suggestions accepted, divided by billed spend in cents, over the period — how much accepted output you are getting per dollar billed.",
        whyItMatters:
          "This is the closest Efficiency comes to a direct 'value for spend' read: accepted suggestions per dollar billed.",
        howCalculatedSimple: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).simple,
        howCalculatedDetailed: describeCalculation(EFFICIENCY_OUTPUT_PER_SPEND).detailed,
        included: "Accepted-suggestion and billed-spend rows from connected tools that report both.",
        excluded:
          "Tools with no billed-spend rows recorded — including tools that only report an estimated figure — contribute nothing to the denominator; this component is left out entirely when either side is missing, never floored to 0.",
        howToInterpret:
          "A higher score means more accepted output per dollar billed — a low score can mean either low acceptance or high spend, so check Effectiveness and the spend figures alongside it.",
        example: "600 accepted suggestions against 5,000 cents of billed spend is a ratio of 0.12, scoring (0.12/0.2)×100 = 60 before weighting.",
        misconception:
          "This ratio is never itself stored — billed spend and acceptance counts are stored, and Revealyst divides them fresh every time this component is computed.",
        relatedKeys: ["engagement_per_spend", "effectiveness"],
      },
      engagement_per_spend: {
        key: "engagement_per_spend",
        plainName: "Engagement per spend",
        shortWhat: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).simple,
        what: "Active days, divided by billed spend in cents, over the period — how much day-to-day engagement you are getting per dollar billed.",
        whyItMatters:
          "Pairs the same 'how regularly' signal used elsewhere against spend, so highly engaged but low-spend usage is recognized alongside a big spender.",
        howCalculatedSimple: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).simple,
        howCalculatedDetailed: describeCalculation(EFFICIENCY_ENGAGEMENT_PER_SPEND).detailed,
        included: "Active-day and billed-spend rows from connected tools that report both.",
        excluded: "Tools with no billed-spend rows recorded — including tools that only report an estimated figure — contribute nothing to the denominator; this component is left out entirely when either side is missing.",
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
    shortWhat: "Two different things: a modeled-estimate comparison panel, and a separate list of only verified published figures.",
    what: "Revealyst shows benchmarks in two places, and they are not the same claim. The comparison panel next to your scores shows MODELED estimates — Revealyst's own approximation, derived from public commentary rather than a primary source — and every row labels which source it was modeled from. The separate 'Benchmarks' list is stricter: it shows only rows marked verified against a primary source, and nothing else.",
    whyItMatters:
      "A raw score is hard to read in isolation, and a rough modeled estimate is still useful context — but only if it is honestly labeled as modeled rather than presented as an authoritative outside figure.",
    howCalculatedSimple: "Not calculated from your data — sourced. The comparison panel is a modeled estimate; the 'Benchmarks' list only ever holds verified figures.",
    howCalculatedDetailed:
      "The comparison panel's rows come from a small set of modeled peer curves, each with a `source` string describing where the estimate was modeled from — Revealyst has not independently verified these against a primary source yet. Verified published benchmarks will replace them, row by row, as sources are confirmed. The separate 'Benchmarks' list card only ever shows rows an admin has explicitly marked verified. Neither is derived from your organization's own metric_records.",
    included: "The comparison panel: every modeled peer row, labeled with its source. The 'Benchmarks' list: only rows marked verified against a primary source.",
    excluded:
      "The 'Benchmarks' list excludes any figure Revealyst has not been able to verify — a note that benchmarks are still being verified is shown instead of a guess.",
    howToInterpret:
      "Treat the comparison panel as a rough, labeled estimate, not a target — organizations differ enormously in tooling, team size, and how long they've been rolling AI tools out. Treat the 'Benchmarks' list as the more trustworthy of the two, once it has entries.",
    misconception:
      "The comparison panel next to your scores is not itself a verified figure, even though it looks similar to one — it is a modeled estimate until a row is confirmed against a primary source and moved to the verified 'Benchmarks' list.",
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
      "A missing (omitted) score component is a different thing from a component that scored 0, but the difference depends on the component. For rate-style parts, missing data on either side means the part is left out — never shown as 0. For plain counts, 0 means no activity rows were recorded in the period, which can also mean a tool hasn't synced that signal yet — not necessarily that nothing happened.",
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
      "Round-the-clock and concurrent-session signals come from intra-day activity data, when the vendor provides it; the volume signal compares an account's activity volume to the median of the team's typical (non-flagged) accounts, and only once enough accounts exist for a median to be meaningful. A vendor that cannot provide intra-day data simply cannot trigger the first two signals for that account — it is not guessed.",
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

/**
 * Resolves any `relatedKeys` entry — a score slug, a component key, a
 * concept key, an honesty-gap kind, or a shared-account reason — to its
 * display label and methodology anchor id. Backs the "See also" links the
 * methodology page renders under every glossary entry that has
 * `relatedKeys`. Returns `undefined` for an unresolvable key rather than a
 * guessed label/anchor — a `relatedKeys` value with no real target should
 * fail a test, not silently render a dead link (see the methodology page's
 * known-anchors coverage assertion).
 */
export function resolveGlossaryKey(
  key: string,
): { label: string; anchor: string } | undefined {
  if ((SCORE_SLUGS as readonly string[]).includes(key)) {
    return {
      label: SCORE_GLOSSARY[key as ScoreSlug].plainName,
      anchor: methodologyAnchor(key),
    };
  }
  for (const slug of SCORE_SLUGS) {
    const component = SCORE_GLOSSARY[slug].components[key];
    if (component) {
      return { label: component.plainName, anchor: methodologyAnchor(key) };
    }
  }
  if (key in CONCEPT_GLOSSARY) {
    const concept = CONCEPT_GLOSSARY[key as keyof typeof CONCEPT_GLOSSARY];
    return { label: concept.plainName, anchor: methodologyAnchor(key) };
  }
  if (key in HONESTY_GAP_GLOSSARY) {
    return {
      label: HONESTY_GAP_GLOSSARY[key as HonestyGapKind].label,
      anchor: methodologyAnchor(key),
    };
  }
  if (key in SHARED_ACCOUNT_REASON_LABELS) {
    return {
      label: SHARED_ACCOUNT_REASON_LABELS[key as SharedAccountReason],
      anchor: methodologyAnchor(key),
    };
  }
  return undefined;
}
