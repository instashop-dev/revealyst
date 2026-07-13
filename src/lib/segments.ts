import type { forOrg } from "../db/org-scope";
import type { DefinitionRow, ScoreRow } from "./dashboard-read";
import type { PersonLike, PersonRef, VisibilityMode } from "./visibility";

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
  /** COUNT-ONLY IN EVERY VISIBILITY MODE (errata §1.2 (5) / §7.3): a
   * personality label ("Power User", "Skeptic") attached to a real name is the
   * thing §7.3 kills, so segment membership is NEVER surfaced — not even under
   * managed/full visibility. Always `[]`; the field is retained so the
   * team-visible identity-surface registry (src/lib/visibility.ts) keeps its
   * `segments.segments[].members` entry (which now can never leak — the
   * completeness tripwire stays green without touching the manifest). */
  members: PersonRef[];
};

export type SegmentDistribution = {
  segments: SegmentBreakdown[];
  /** Resolved people we cannot segment yet (no person-level score). */
  unsegmented: number;
};

/** Below this many resolved (segmented) people, no single segment may be
 * called out by name ("your champions are …") in ANY copy — a lone occupant of
 * a bucket in a tiny org is de-anonymizing (§7.3). Mirrors
 * usage-distribution's MIN_PEOPLE_FOR_DISTRIBUTION. */
export const SEGMENT_MIN_PEOPLE_TO_NAME = 4;

/** The most-advanced populated segment (the "champions"), or `null` when there
 * are too few segmented people to name a band without singling out an
 * individual. Count-only by construction — the returned breakdown carries an
 * empty `members` list like every other. This is the ONLY sanctioned way for
 * copy to reference a "champion"/leading cohort, and it enforces the floor so
 * that guard can't be forgotten at a call site (deliverable 6 champion-floor). */
export function championSegment(
  distribution: SegmentDistribution,
): SegmentBreakdown | null {
  const resolved = distribution.segments.reduce((n, s) => n + s.count, 0);
  if (resolved < SEGMENT_MIN_PEOPLE_TO_NAME) return null;
  // Champions = the highest-adoption band with any people (ai_native first).
  for (let i = SEGMENTS.length - 1; i >= 0; i--) {
    const b = distribution.segments.find((s) => s.segment === SEGMENTS[i]);
    if (b && b.count > 0) return b;
  }
  return null;
}

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
    // `visibilityMode` is intentionally UNUSED for member surfacing now — see
    // the SegmentBreakdown.members doc comment: count-only in every mode.
    void visibilityMode;
    const adoptionDefIds = new Set(
      definitions.filter((d) => d.slug === "adoption").map((d) => d.id),
    );

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
      return {
        segment,
        label: SEGMENT_LABELS[segment],
        count: personIds.length,
        // Count-only in EVERY visibility mode (errata §1.2 (5)) — members are
        // never surfaced, so no personality label is ever attached to a name.
        members: [],
      };
    });

    return {
      segments,
      unsegmented: Math.max(0, people.length - latestByPerson.size),
    };
  },
};
