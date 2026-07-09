import type { forOrg } from "../db/org-scope";
import type { DefinitionRow, ScoreRow } from "./dashboard-read";
import { toPersonRef, type PersonLike, type PersonRef, type VisibilityMode } from "./visibility";

type OrgScope = ReturnType<typeof forOrg>;

// User segmentation (§8): Skeptics · Casual · Power Users · AI Natives, derived
// from adoption/fluency, team-level by default. The canonical segmentation job
// is W2-I's; W2-L renders it. Until W2-I merges, this fixture source buckets
// people who already carry a person-level adoption score_result — so W2-L stays
// a pure RENDERER of scores (never re-derives them, invariant b) and the swap
// to W2-I's job is one function. People with no person-level score are
// "unsegmented" (surfaced, not forced into a bucket).

export const SEGMENTS = ["skeptic", "casual", "power_user", "ai_native"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  skeptic: "Skeptics",
  casual: "Casual",
  power_user: "Power Users",
  ai_native: "AI Natives",
};

/** Display bands over the 0–100 adoption score. Product thresholds ultimately
 * belong to W2-I's segmentation definition; these are the render-time bands. */
function segmentFor(adoptionValue: number): Segment {
  if (adoptionValue < 25) return "skeptic";
  if (adoptionValue < 50) return "casual";
  if (adoptionValue < 75) return "power_user";
  return "ai_native";
}

export type SegmentBreakdown = {
  segment: Segment;
  label: string;
  count: number;
  /** Pseudonymous members — populated only when visibility permits; empty
   * (counts only) in the private default. */
  members: PersonRef[];
};

export type SegmentDistribution = {
  segments: SegmentBreakdown[];
  /** Resolved people we cannot segment yet (no person-level score). */
  unsegmented: number;
};

export interface SegmentSource {
  forOrg(
    scope: OrgScope,
    visibilityMode: VisibilityMode,
    window: { from: string; to: string },
    prefetched?: {
      /** The exact subjectLevel:"person" subset — pass the JS-filtered
       * slice of dashboard-view.ts's single unfiltered `scores.results`
       * fetch to avoid a redundant query. */
      rows?: ScoreRow[];
      definitions?: DefinitionRow[];
      people?: PersonLike[];
    },
  ): Promise<SegmentDistribution>;
}

export function resolveSegmentSource(): SegmentSource {
  return fixtureSegmentSource;
}

const fixtureSegmentSource: SegmentSource = {
  async forOrg(scope, visibilityMode, window, prefetched) {
    const [rawScores, definitions, people] = await Promise.all([
      prefetched?.rows ??
        scope.scores.results({
          subjectLevel: "person",
          from: window.from,
          to: window.to,
        }),
      prefetched?.definitions ?? scope.scores.definitions(),
      prefetched?.people ?? scope.people.list(),
    ]);
    const adoptionDefIds = new Set(
      definitions.filter((d) => d.slug === "adoption").map((d) => d.id),
    );
    const peopleById = new Map(people.map((p) => [p.id, p]));

    // Latest adoption score per person (highest periodEnd wins).
    const latestByPerson = new Map<string, { value: number; periodEnd: string }>();
    for (const row of rawScores) {
      if (!row.personId || !adoptionDefIds.has(row.definitionId)) continue;
      const current = latestByPerson.get(row.personId);
      if (!current || row.periodEnd > current.periodEnd) {
        latestByPerson.set(row.personId, {
          value: row.value,
          periodEnd: row.periodEnd,
        });
      }
    }

    const buckets = new Map<Segment, string[]>(
      SEGMENTS.map((s) => [s, [] as string[]]),
    );
    for (const [personId, { value }] of latestByPerson) {
      buckets.get(segmentFor(value))!.push(personId);
    }

    const segments: SegmentBreakdown[] = SEGMENTS.map((segment) => {
      const personIds = buckets.get(segment)!;
      const members =
        visibilityMode === "private"
          ? []
          : personIds
              .map((id) => peopleById.get(id))
              .filter((p): p is NonNullable<typeof p> => Boolean(p))
              .map((p) => toPersonRef(p, visibilityMode));
      return {
        segment,
        label: SEGMENT_LABELS[segment],
        count: personIds.length,
        members,
      };
    });

    return {
      segments,
      unsegmented: Math.max(0, people.length - latestByPerson.size),
    };
  },
};
