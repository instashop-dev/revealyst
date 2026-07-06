import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import type { Period } from "./periods";

// W2-I: segments a team into an adoption/fluency-derived persona label.
// Thresholds are versioned DATA, not a user-facing rule engine (rule 7) —
// same "not a DSL" posture as score components. Absence handling mirrors
// evaluate.ts's ratio-component honesty rule: missing input means the team
// isn't labeled at all, never defaulted to the lowest bucket.

export type Segment = "skeptic" | "casual" | "power_user" | "ai_native";

export type SegmentThresholds = {
  /** Below this adoption value → 'skeptic'. */
  skepticMaxAdoption: number;
  /** Adoption at/above this, with fluency below fluencyForPowerUser → 'power_user'. */
  powerUserMinAdoption: number;
  /** Fluency below this (given adoption is above the skeptic floor) → 'casual'. */
  casualMaxFluency: number;
  /** Fluency below this (given adoption clears the power-user floor) → 'power_user'; at/above → 'ai_native'. */
  powerUserMaxFluency: number;
};

/** v1, pre-calibration — tune against real dogfooding data (see
 * scripts/calibrate-scores.mjs) before treating these as final. */
export const SEGMENT_THRESHOLDS_V1: SegmentThresholds = {
  skepticMaxAdoption: 25,
  powerUserMinAdoption: 60,
  casualMaxFluency: 50,
  powerUserMaxFluency: 70,
};

/**
 * Classifies a team from its Adoption and Fluency score values. Either input
 * being `null` (no score_results row this period — the score engine never
 * fabricates one, see evaluate.ts) means insufficient data: returns `null`,
 * never a fabricated/defaulted segment (review invariant b, applied one
 * level above the score components themselves).
 */
export function segmentFor(
  adoption: number | null,
  fluency: number | null,
  thresholds: SegmentThresholds = SEGMENT_THRESHOLDS_V1,
): Segment | null {
  if (adoption === null || fluency === null) {
    return null;
  }
  if (fluency >= thresholds.powerUserMaxFluency) {
    return "ai_native";
  }
  if (adoption < thresholds.skepticMaxAdoption) {
    return "skeptic";
  }
  // Remaining space: adoption >= skepticMaxAdoption, fluency < powerUserMaxFluency.
  // Either high adoption OR high fluency alone is enough to count as engaged
  // use ("power user"); low on both is "casual" — no ambiguous fallthrough.
  if (
    adoption >= thresholds.powerUserMinAdoption ||
    fluency >= thresholds.casualMaxFluency
  ) {
    return "power_user";
  }
  return "casual";
}

export type TeamSegment = {
  teamId: string;
  adoption: number | null;
  fluency: number | null;
  segment: Segment | null;
};

/**
 * Segments every team in the org for one period, reading only through the
 * existing, unmodified `forOrg(...).scores` surface (rule 2 / no new
 * org-scope method). Looks up the org's active 'adoption' and 'fluency'
 * definitions (org-custom if present, else the global preset) and joins
 * their team-level results for the period.
 */
export async function segmentTeams(
  db: Db,
  orgId: string,
  period: Pick<Period, "periodStart" | "periodEnd">,
  thresholds: SegmentThresholds = SEGMENT_THRESHOLDS_V1,
): Promise<TeamSegment[]> {
  const scoped = forOrg(db, orgId);
  const definitions = await scoped.scores.definitions();

  const activeDefinitionId = (slug: string) =>
    definitions
      .filter(
        (d) =>
          d.slug === slug && d.status === "active" && d.subjectLevel === "team",
      )
      // Prefer this org's own definition over the global preset; highest
      // version wins within that preference.
      .sort((a, b) => {
        if ((a.orgId === orgId) !== (b.orgId === orgId)) {
          return a.orgId === orgId ? -1 : 1;
        }
        return b.version - a.version;
      })[0]?.id;

  const adoptionDefinitionId = activeDefinitionId("adoption");
  const fluencyDefinitionId = activeDefinitionId("fluency");

  const [adoptionResults, fluencyResults] = await Promise.all([
    adoptionDefinitionId
      ? scoped.scores.results({
          definitionId: adoptionDefinitionId,
          subjectLevel: "team",
          from: period.periodStart,
          to: period.periodEnd,
        })
      : Promise.resolve([]),
    fluencyDefinitionId
      ? scoped.scores.results({
          definitionId: fluencyDefinitionId,
          subjectLevel: "team",
          from: period.periodStart,
          to: period.periodEnd,
        })
      : Promise.resolve([]),
  ]);

  const adoptionByTeam = new Map(
    adoptionResults
      .filter((r) => r.teamId !== null)
      .map((r) => [r.teamId as string, r.value]),
  );
  const fluencyByTeam = new Map(
    fluencyResults
      .filter((r) => r.teamId !== null)
      .map((r) => [r.teamId as string, r.value]),
  );

  const teams = await scoped.teams.list();
  return teams.map((team) => {
    const adoption = adoptionByTeam.get(team.id) ?? null;
    const fluency = fluencyByTeam.get(team.id) ?? null;
    return {
      teamId: team.id,
      adoption,
      fluency,
      segment: segmentFor(adoption, fluency, thresholds),
    };
  });
}
