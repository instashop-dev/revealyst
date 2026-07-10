import {
  scoreComponentsSchema,
  type ScoreComponent,
} from "../contracts/scores";
import type { Db } from "../db/client";
import { subscriptionsForOrg, type EntitlementPlan } from "../db/subscriptions";
import type { forOrg } from "../db/org-scope";
import { periodFor, previousDay } from "../scoring";
import { previewDefinition, type DefinitionPreview } from "../scoring/preview";
import { ApiError } from "./api-impl";
import {
  CustomIndexCapError,
  CustomIndexNotFoundError,
  customIndexPreviewSchema,
  customIndexPublishSchema,
  isCustomSlug,
  slugifyToCustomSlug,
  type CustomIndexSubjectLevel,
} from "./custom-index";

// Orchestration for the Custom Index Builder (W4-U). Pure over the org-scoped
// repository (`forOrg`) — the SAME functions back the /api/indexes routes and
// the /indexes page, so UI and API can't drift. Entitlement is checked here
// (Team-paid only, §8.5 guardrail 6) via `assertCustomIndexEntitled`, which
// every mutating/preview path calls; listing is allowed while lapsed so the
// paused UI can still render last results.

type OrgScope = ReturnType<typeof forOrg>;
type CustomDefinitionRow = Awaited<
  ReturnType<OrgScope["scores"]["customDefinitions"]>
>[number];

/** Custom indexes are Team-paid only. `plan === "team"` covers the entitling
 * Paddle statuses (active/trialing/past_due); personal/lapsed is not entitled. */
export function isCustomIndexEntitled(plan: EntitlementPlan): boolean {
  return plan === "team";
}

/** Guards a mutating/preview path — 402 when the org isn't on the Team plan. */
export function assertCustomIndexEntitled(plan: EntitlementPlan): void {
  if (!isCustomIndexEntitled(plan)) {
    throw new ApiError(402, "custom indexes require the Team plan");
  }
}

/**
 * Reads the org's entitlement and asserts it — the single Team-paid gate every
 * mutating/preview route calls, so a new /api/indexes route can't forget the
 * guard its siblings have (the fleet-data-behind-the-API failure mode). 402
 * when the org isn't on the Team plan.
 */
export async function assertCustomIndexEntitledForOrg(
  db: Db,
  orgId: string,
): Promise<void> {
  const entitlement = await subscriptionsForOrg(db, orgId).current();
  assertCustomIndexEntitled(entitlement.plan);
}

export type CustomIndexVersion = {
  id: string;
  version: number;
  name: string;
  status: string;
  createdAt: string;
};

/** One custom index, all its immutable versions grouped under its slug. */
export type CustomIndexView = {
  slug: string;
  /** Name of the active version, else the highest-versioned row. */
  name: string;
  subjectLevel: CustomIndexSubjectLevel;
  /** "active" when a version is live (recomputing), else "archived". */
  status: "active" | "archived";
  activeVersionId: string | null;
  /** The representative version's components (active version, else head) —
   * so the builder can prefill an edit. Null if they fail the frozen shape
   * (a corrupt row; surfaced elsewhere, not editable here). */
  components: ScoreComponent[] | null;
  versions: CustomIndexVersion[];
};

/** Groups raw custom_definitions rows (all versions, ordered slug+version)
 * into per-slug views. */
export function groupCustomIndexes(
  rows: readonly CustomDefinitionRow[],
): CustomIndexView[] {
  const bySlug = new Map<string, CustomDefinitionRow[]>();
  for (const row of rows) {
    const bucket = bySlug.get(row.slug);
    if (bucket) bucket.push(row);
    else bySlug.set(row.slug, [row]);
  }
  const views: CustomIndexView[] = [];
  for (const [slug, group] of bySlug) {
    const active = group.find((r) => r.status === "active") ?? null;
    // Head = highest version, the row whose name/level represents the index
    // when nothing is active (archived).
    const head = group.reduce((best, r) => (r.version > best.version ? r : best));
    const repr = active ?? head;
    const parsedComponents = scoreComponentsSchema.safeParse(repr.components);
    views.push({
      slug,
      name: repr.name,
      subjectLevel: repr.subjectLevel as CustomIndexSubjectLevel,
      status: active ? "active" : "archived",
      activeVersionId: active?.id ?? null,
      components: parsedComponents.success ? parsedComponents.data : null,
      versions: group
        .slice()
        .sort((a, b) => b.version - a.version)
        .map((r) => ({
          id: r.id,
          version: r.version,
          name: r.name,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
    });
  }
  // Newest-touched first: by the max version row's createdAt.
  return views.sort((a, b) =>
    (b.versions[0]?.createdAt ?? "").localeCompare(a.versions[0]?.createdAt ?? ""),
  );
}

export async function listCustomIndexes(
  scope: OrgScope,
): Promise<CustomIndexView[]> {
  return groupCustomIndexes(await scope.scores.customDefinitions());
}

/**
 * Publishes a custom index. With `slug` → a new version of that index. Without
 * `slug` → a brand-new index; a unique slug is derived from the name (numeric
 * suffix if the base collides) so "create" never silently versions an existing
 * index. Maps repo guardrail errors (cap) to HTTP statuses.
 */
export async function publishCustomIndex(
  scope: OrgScope,
  input: unknown,
): Promise<CustomIndexView> {
  const parsed = customIndexPublishSchema.parse(input);
  let slug = parsed.slug ?? null;
  if (!slug) {
    const base = slugifyToCustomSlug(parsed.name);
    if (!base) {
      throw new ApiError(400, "name has no usable characters for a slug");
    }
    const existing = new Set(
      (await scope.scores.customDefinitions()).map((r) => r.slug),
    );
    slug = base;
    for (let n = 2; existing.has(slug); n += 1) {
      slug = `${base}-${n}`;
    }
  }
  try {
    await scope.scores.publishCustomDefinition({
      slug,
      name: parsed.name,
      subjectLevel: parsed.subjectLevel,
      components: parsed.components,
    });
  } catch (error) {
    if (error instanceof CustomIndexCapError) {
      throw new ApiError(409, error.message);
    }
    throw error;
  }
  const view = (await listCustomIndexes(scope)).find((v) => v.slug === slug);
  if (!view) {
    throw new ApiError(500, "published index not found after write");
  }
  return view;
}

export async function archiveCustomIndex(
  scope: OrgScope,
  slug: string,
): Promise<{ archived: boolean }> {
  if (!isCustomSlug(slug)) {
    throw new ApiError(404, "custom index not found");
  }
  const archived = await scope.scores.archiveCustomDefinition(slug);
  return { archived };
}

export async function unarchiveCustomIndex(
  scope: OrgScope,
  slug: string,
): Promise<{ active: boolean }> {
  if (!isCustomSlug(slug)) {
    throw new ApiError(404, "custom index not found");
  }
  try {
    await scope.scores.unarchiveCustomDefinition(slug);
    return { active: true };
  } catch (error) {
    if (error instanceof CustomIndexCapError) {
      throw new ApiError(409, error.message);
    }
    if (error instanceof CustomIndexNotFoundError) {
      throw new ApiError(404, "custom index not found");
    }
    throw error;
  }
}

export type CustomIndexResultEntry = {
  label: string;
  teamId: string | null;
  value: number;
};

/** The latest computed result for one custom index (its active version). */
export type CustomIndexResult = {
  slug: string;
  periodEnd: string;
  periodGrain: string;
  entries: CustomIndexResultEntry[];
};

// Latest computed results for each ACTIVE custom index, keyed by slug — what
// the builder page renders beside each index (and what a lapsed org sees, in a
// "paused" state, since these rows persist). Only the active version's results
// are surfaced; the most recent period per slug wins.
type ResultRow = Awaited<ReturnType<OrgScope["scores"]["results"]>>[number];

// When a period-end ties (e.g. a month-end day where the monthly and the
// rolling-28d windows share the same last day), prefer the dashboard grain so
// exactly ONE period's rows are surfaced — otherwise the same subject would
// appear twice with two grains' values.
const GRAIN_RANK: Record<string, number> = {
  month: 3,
  rolling_28d: 2,
  week: 1,
};

/** True when candidate `a` is a more-recent period than `b` for display. */
function isLaterPeriod(a: ResultRow, b: ResultRow): boolean {
  if (a.periodEnd !== b.periodEnd) return a.periodEnd > b.periodEnd;
  return (GRAIN_RANK[a.periodGrain] ?? 0) > (GRAIN_RANK[b.periodGrain] ?? 0);
}

/**
 * Pure grouper (no I/O) — so a page that already fetched the definition rows,
 * result rows, and teams in one Promise.all can build the results map without
 * re-querying score_definitions. `readActiveCustomIndexResults` wraps it with
 * the reads for standalone callers.
 */
export function groupCustomIndexResults(
  rows: readonly CustomDefinitionRow[],
  results: readonly ResultRow[],
  teams: readonly { id: string; name: string }[],
): Map<string, CustomIndexResult> {
  const activeById = new Map(
    rows.filter((r) => r.status === "active").map((r) => [r.id, r]),
  );
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // Pass 1: pick the single most-recent (periodEnd, grain) per slug.
  const bestRow = new Map<string, ResultRow>();
  for (const row of results) {
    const def = activeById.get(row.definitionId);
    if (!def) continue; // preset, or a superseded/archived custom version
    const current = bestRow.get(def.slug);
    if (!current || isLaterPeriod(row, current)) {
      bestRow.set(def.slug, row);
    }
  }

  // Pass 2: gather every subject's row that matches that chosen period.
  const bySlug = new Map<string, CustomIndexResult>();
  for (const row of results) {
    const def = activeById.get(row.definitionId);
    if (!def) continue;
    const best = bestRow.get(def.slug);
    if (
      !best ||
      row.periodEnd !== best.periodEnd ||
      row.periodGrain !== best.periodGrain
    ) {
      continue;
    }
    const result =
      bySlug.get(def.slug) ??
      ({
        slug: def.slug,
        periodEnd: best.periodEnd,
        periodGrain: best.periodGrain,
        entries: [],
      } satisfies CustomIndexResult);
    result.entries.push({
      label:
        row.subjectLevel === "org"
          ? "Whole organization"
          : (row.teamId ? teamName.get(row.teamId) : undefined) ?? "Team",
      teamId: row.teamId ?? null,
      value: row.value,
    });
    bySlug.set(def.slug, result);
  }
  for (const result of bySlug.values()) {
    result.entries.sort((a, b) => a.label.localeCompare(b.label));
  }
  return bySlug;
}

/** I/O wrapper around {@link groupCustomIndexResults} for standalone callers
 * (the page fetches these three reads itself, in one Promise.all, to avoid a
 * duplicate customDefinitions query). */
export async function readActiveCustomIndexResults(
  scope: OrgScope,
  window: { from: string; to: string },
): Promise<Map<string, CustomIndexResult>> {
  const [rows, results, teams] = await Promise.all([
    scope.scores.customDefinitions(),
    scope.scores.results({ from: window.from, to: window.to }),
    scope.teams.list(),
  ]);
  return groupCustomIndexResults(rows, results, teams);
}

export type CustomIndexPreviewResponse = {
  /** The recent window the preview evaluated against (rolling 28 days). */
  window: { from: string; to: string };
} & DefinitionPreview;

/**
 * Previews a draft definition against the org's own recent data (rolling 28
 * days ending yesterday — the last fully-ingested day). Read-only; honesty
 * rules inherited from the shared evaluate path.
 */
export async function previewCustomIndex(
  scope: OrgScope,
  input: unknown,
  now: Date = new Date(),
): Promise<CustomIndexPreviewResponse> {
  const parsed = customIndexPreviewSchema.parse(input);
  const anchor = previousDay(now.toISOString().slice(0, 10));
  const period = periodFor("rolling_28d", anchor);
  const preview = await previewDefinition(
    scope,
    { subjectLevel: parsed.subjectLevel, components: parsed.components },
    period,
  );
  return {
    window: { from: period.periodStart, to: period.periodEnd },
    ...preview,
  };
}
