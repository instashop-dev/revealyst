import { z } from "zod";
import type { ScoreSlug } from "./metrics-glossary";

// Evaluator-facing types + the CLOSED comparator vocabulary for the
// recommendation catalog (W6-C, ADR 0033). The catalog CONTENT is seeded data
// (drizzle/0029, read live via `forOrg(...).catalog.list()`); this module is
// the CODE half of §8.2's "catalog = data, evaluator = code": a small, named,
// closed set of comparators over measured facts — no DSL, no LLM. Pure (no
// React, no I/O), so `deriveAttention` (src/lib/score-insights.ts) and the
// seed-contract test share ONE definition of what a valid catalog row means.

/** Appended to every rendered recommendation body by `deriveAttention` so the
 * honesty framing (guidance, not a measurement of any individual) is guaranteed
 * present and can't drift per entry. (Moved here from the retired
 * coaching-recommendations.ts — same string, same central-append contract.) */
export const COACHING_GUIDANCE_SUFFIX =
  "This is general guidance based on which part of the score is measuring low — not a measurement of any individual.";

/** Same-signal dedupe group. Several preset components read the SAME underlying
 * signal (adoption.active_days & fluency.depth are both the `active_day` count;
 * adoption.tool_coverage & fluency.breadth are both `feature_used` breadth), so
 * the evaluator dedupes candidates by this group BEFORE its cap. Closed set. */
export type CoachingSignalGroup =
  | "active-days"
  | "feature-breadth"
  | "effectiveness"
  | "output-per-spend"
  | "engagement-per-spend";

/** W5-E optimization metadata (§8.2) — closed vocabularies describing the
 * ADVICE PATTERN, never a person. `benefit` = typical adoption upside (the
 * static map's `impact`); `difficulty` = typical effort; `confidence` = how
 * well-evidenced the guidance is. */
export type CatalogBenefit = "high" | "medium" | "low";
export type CatalogDifficulty = "low" | "medium" | "high";
export type CatalogConfidence = "high" | "medium" | "low";

/** §8.2's 3-value suggested-action taxonomy — a CLOSED enum. `link-out` =
 * external docs/guidance; `in-product-setting` = a change inside Revealyst or
 * the user's own workflow; `vendor-deep-link` = a jump into the connected
 * vendor's own surface. */
export type SuggestedActionType =
  | "link-out"
  | "in-product-setting"
  | "vendor-deep-link";

/** §7.3 named insight taxonomy (the domain an insight belongs to). Slash-forms
 * in the spec are hyphenated here for enum-safety. */
export type InsightKind =
  | "data-hygiene"
  | "adoption"
  | "effectiveness-verification"
  | "spend"
  | "agentic-transition"
  | "early-warning"
  | "narrative"
  | "milestone-positive";

// ─── The CLOSED comparator vocabulary (required_signals) ───
//
// A recommendation fires for a (score, component) pair only when its component
// row satisfies EVERY comparator below. These formalize the EXACT gating the
// static map's evaluator already applied inline (measured · normalized < 40 ·
// weight ≥ 0.2). Adding a new `kind` here is a closed-enum change — an ADR +
// review-blocker (§8.2), never a silent extension.
//
//  - `measured`        — the component must be MEASURED this period (not
//                        omitted; a ratio missing one side is "no data", never
//                        "measured low").
//  - `normalized-below`— its normalized value must sit strictly below `value`
//                        (the bottom reading band; the seed uses 40).
//  - `min-weight`      — it must carry at least `value` weight in the score (a
//                        trivial-weight component is noise; the seed uses 0.2).
export const requiredSignalComparatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured") }),
  z.object({ kind: z.literal("normalized-below"), value: z.number() }),
  z.object({ kind: z.literal("min-weight"), value: z.number() }),
]);
export type RequiredSignalComparator = z.infer<
  typeof requiredSignalComparatorSchema
>;

/** The structured `required_signals` payload: a non-empty list of comparators,
 * ALL of which must hold. `.strict()`/`nonempty` so a malformed or empty row is
 * rejected by the seed-contract test rather than silently coaching on nothing
 * (or everything). */
export const requiredSignalsSchema = z.object({
  comparators: z.array(requiredSignalComparatorSchema).nonempty(),
});
export type RequiredSignals = z.infer<typeof requiredSignalsSchema>;

/** Parse an unknown (jsonb) `required_signals` value against the closed
 * vocabulary. Throws (via zod) on anything unparseable — the seed-contract test
 * relies on this to red CI for a bad seed row. */
export function parseRequiredSignals(value: unknown): RequiredSignals {
  return requiredSignalsSchema.parse(value);
}

/** The evaluator-facing catalog row: exactly what `deriveAttention` needs to
 * select + render a recommendation, plus the §8.2 metadata carried for the
 * companion card. `requiredSignals` is already parsed (the read layer parses
 * once, so the hot path never re-validates). */
export type CatalogRecommendation = {
  /** Stable recommendation id (== the DB `slug`, == the static map's `id`, ==
   * rec_interaction_state.rec_id). */
  id: string;
  slug: ScoreSlug;
  componentKey: string;
  signalGroup: CoachingSignalGroup;
  title: string;
  body: string;
  requiredSignals: RequiredSignals;
  applicableRoles: readonly string[];
  applicableTools: readonly string[];
  /** W7-1 — capability slugs this rec advances (`capabilities.slug`). Empty when
   * the rec links to no capability; the coaching card renders nothing then
   * (never a fabricated "Unknown capability"). */
  targetCapabilities: readonly string[];
  benefit: CatalogBenefit;
  difficulty: CatalogDifficulty;
  confidence: CatalogConfidence;
  learningResources: readonly string[];
  relatedWorkflows: readonly string[];
  insightKind: InsightKind;
  suggestedActionType: SuggestedActionType;
  version: number;
};

/** The measured-component facts a comparator is evaluated against — a subset of
 * a `ComponentDetailRow` (src/lib/score-insights.ts). */
export type EvaluatedComponent = {
  omitted: boolean;
  normalized?: number;
  weight: number;
};

/** Does this component satisfy EVERY comparator in `required_signals`? This is
 * the closed evaluator: it interprets the structured data, never arbitrary
 * logic. An unknown comparator kind is unreachable (the type is a closed union
 * and rows are validated on read), but the `default` fails CLOSED (returns
 * false) so a future unvalidated kind can never over-surface guidance. */
export function evaluateRequiredSignals(
  signals: RequiredSignals,
  component: EvaluatedComponent,
): boolean {
  for (const c of signals.comparators) {
    switch (c.kind) {
      case "measured":
        if (component.omitted || component.normalized === undefined) return false;
        break;
      case "normalized-below":
        if (component.normalized === undefined || component.normalized >= c.value)
          return false;
        break;
      case "min-weight":
        if (component.weight < c.value) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** The raw DB row shape (from `recommendationCatalog` select). Declared
 * structurally so this pure module never imports the schema (org-scope guard). */
type CatalogRow = {
  slug: string;
  scoreSlug: string;
  componentKey: string;
  signalGroup: string;
  title: string;
  body: string;
  requiredSignals: unknown;
  applicableRoles: string[];
  applicableTools: string[];
  targetCapabilities: string[];
  benefit: string;
  difficulty: string;
  confidence: string;
  learningResources: string[];
  relatedWorkflows: string[];
  insightKind: string;
  suggestedActionType: string;
  version: number;
};

/** Map a stored catalog row to the evaluator-facing shape, parsing
 * `required_signals` against the closed vocabulary (throws on a bad row — the
 * read layer surfaces it, the seed-contract test asserts it never happens for a
 * seeded row). */
export function mapCatalogRow(row: CatalogRow): CatalogRecommendation {
  return {
    id: row.slug,
    slug: row.scoreSlug as ScoreSlug,
    componentKey: row.componentKey,
    signalGroup: row.signalGroup as CoachingSignalGroup,
    title: row.title,
    body: row.body,
    requiredSignals: parseRequiredSignals(row.requiredSignals),
    applicableRoles: row.applicableRoles,
    applicableTools: row.applicableTools,
    targetCapabilities: row.targetCapabilities,
    benefit: row.benefit as CatalogBenefit,
    difficulty: row.difficulty as CatalogDifficulty,
    confidence: row.confidence as CatalogConfidence,
    learningResources: row.learningResources,
    relatedWorkflows: row.relatedWorkflows,
    insightKind: row.insightKind as InsightKind,
    suggestedActionType: row.suggestedActionType as SuggestedActionType,
    version: row.version,
  };
}

/** Build the `(slug::componentKey) → recommendation` lookup the evaluator uses.
 * When two rows map to the same key (an org override of a global preset), the
 * LAST wins — callers order global-then-org so an org row shadows the preset. */
export function indexBySlugComponent(
  recommendations: readonly CatalogRecommendation[],
): Map<string, CatalogRecommendation> {
  const map = new Map<string, CatalogRecommendation>();
  for (const rec of recommendations) {
    map.set(`${rec.slug}::${rec.componentKey}`, rec);
  }
  return map;
}
