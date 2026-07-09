import type { ReactNode } from "react";
import type { z } from "zod";

import type { scoreResultSchema } from "../../contracts/api";
import {
  scoreComponentBreakdownSchema,
  scoreComponentsSchema,
  type ScoreComponent,
} from "../../contracts/scores";
import type { DashboardScore, DefinitionRow } from "../../lib/dashboard-read";
import {
  methodologyAnchor,
  SCORE_GLOSSARY,
  type ScoreSlug,
} from "../../lib/metrics-glossary";
import {
  formatComponentDetail,
  type DeltaResult,
} from "../../lib/score-insights";
import type { ScoreCardData } from "./score-card";

// Pure adapters from the two score-read shapes (team dashboard's typed
// `DashboardScore`, personal self-view's untyped `scoreResultSchema` parse
// output) into the one `ScoreCardData` the card renders. No JSX, no I/O —
// safe for a node-environment vitest suite. Relative imports throughout
// (not `@/`) so this file resolves the same under vitest as under tsc/Next
// (see CLAUDE.md's "Vitest resolves @/ only under tsc/Next" gotcha) — the
// `./score-card` import is type-only and is erased before the module ever
// loads at runtime, so it does not pull in the client-component tree.

/** The personal self-view's per-score shape: one element of
 * `dashboardSummary()`'s `scores` array (`apiRoutes.dashboardSummary.response`
 * parse output) — `components` is an untyped record there, unlike
 * `DashboardScore`'s narrowed `ScoreComponentBreakdown`. */
export type PersonalScore = Pick<
  z.infer<typeof scoreResultSchema>,
  "definitionSlug" | "definitionVersion" | "value" | "attribution" | "components"
>;

/**
 * Resolves the definition a score row was computed against
 * (definitionSlug + definitionVersion), falling back to the latest `active`
 * definition with that slug when `score` is null (or its version isn't
 * found) — so the breakdown skeleton still knows the component list before
 * anything has computed.
 */
function findDefinition(
  definitions: readonly DefinitionRow[],
  slug: ScoreSlug,
  version?: number,
): DefinitionRow | undefined {
  const candidates = definitions.filter((d) => d.slug === slug);
  if (version != null) {
    const exact = candidates.find((d) => d.version === version);
    if (exact) return exact;
  }
  const active = candidates.filter((d) => d.status === "active");
  if (active.length === 0) return undefined;
  return active.reduce((best, d) => (d.version > best.version ? d : best));
}

/** Narrows a definition row's untyped `components` jsonb column through the
 * frozen contract schema — mirrors `scoring/recompute.ts`'s
 * `loadActiveDefinitions`. A malformed definition degrades to an empty
 * component list rather than throwing (the card just shows no breakdown). */
function componentsFor(def: DefinitionRow | undefined): ScoreComponent[] {
  if (!def) return [];
  const parsed = scoreComponentsSchema.safeParse(def.components);
  return parsed.success ? parsed.data : [];
}

type CommonArgs = {
  slug: ScoreSlug;
  definitions: readonly DefinitionRow[];
  delta?: DeltaResult | null;
  headerSlot?: ReactNode;
};

function baseCardData(
  args: CommonArgs & {
    value: number | null;
    attribution?: ScoreCardData["attribution"];
    definitionVersion?: number;
    breakdown: Record<string, unknown> | null | undefined;
    footer?: ReactNode;
  },
): ScoreCardData {
  const glossary = SCORE_GLOSSARY[args.slug];
  const def = findDefinition(args.definitions, args.slug, args.definitionVersion);
  const componentRows = formatComponentDetail(componentsFor(def), args.breakdown);
  return {
    slug: args.slug,
    title: glossary.plainName,
    shortWhat: glossary.shortWhat,
    value: args.value,
    attribution: args.attribution ?? null,
    delta: args.delta ?? null,
    componentRows,
    methodologyHref: `/methodology#${methodologyAnchor(args.slug)}`,
    footer: args.footer,
    headerSlot: args.headerSlot,
  };
}

/** Team dashboard adapter — `score` is the already-narrowed `DashboardScore`
 * (or null while the score hasn't computed yet). */
export function fromDashboardScore(args: CommonArgs & {
  score: DashboardScore | null;
  footer?: ReactNode;
}): ScoreCardData {
  return baseCardData({
    ...args,
    value: args.score ? args.score.value : null,
    attribution: args.score?.attribution ?? null,
    definitionVersion: args.score?.definitionVersion,
    breakdown: args.score?.components,
  });
}

/** Personal self-view adapter — `score` is one row of `dashboardSummary()`'s
 * response, whose `components` is unvalidated at this shape's level (the
 * frozen `scoreResultSchema` types it as `Record<string, unknown>`). Narrow
 * it through `scoreComponentBreakdownSchema` here, the same gate
 * `dashboard-read.ts`'s `mapScoreRow` applies to the team-dashboard shape —
 * a malformed breakdown degrades to "every component omitted" rather than
 * rendering garbage numbers. */
export function fromPersonalScore(args: CommonArgs & {
  score: PersonalScore | null;
}): ScoreCardData {
  let breakdown: Record<string, unknown> | null = null;
  // A malformed breakdown alongside a real (non-null) score value is a
  // different case from "no score yet": showing a real headline number next
  // to a full row of "omitted" components would read as self-contradictory
  // (invariant b — the honesty story has to be coherent, not just each part
  // individually honest). When the value is present but the breakdown can't
  // be parsed, drop the component list entirely rather than render every
  // component as omitted; a null score still yields the normal
  // every-component-omitted skeleton via `formatComponentDetail`.
  // `PersonalScore.value` is a plain `number` (never null) whenever `score`
  // itself is present — a stored score row always has a computed value — so
  // a parse failure here always co-occurs with a real headline value.
  let malformedWithValue = false;
  if (args.score) {
    const parsed = scoreComponentBreakdownSchema.safeParse(args.score.components);
    if (parsed.success) {
      breakdown = parsed.data;
    } else {
      malformedWithValue = true;
    }
  }
  const data = baseCardData({
    ...args,
    value: args.score ? args.score.value : null,
    attribution: args.score?.attribution ?? null,
    definitionVersion: args.score?.definitionVersion,
    breakdown,
  });
  return malformedWithValue ? { ...data, componentRows: [] } : data;
}
