// Pure helpers for the per-capability team history rollup (TCI Phase 2-D, ADR
// 0046). NO I/O — the store keeps TRUE counts; these functions derive the
// count-only confidence-tier summary the writer stamps, and apply the
// MIN_PEOPLE floor at READ time (never at write). Flooring at write would bake
// gaps/zeros into the stored series and make a later trend uncomputable and
// dishonest (ADR 0046); the floor is a presentation rule, the same posture as
// P6's coverage card — a below-floor capability is dropped ENTIRELY at render,
// never a suppressed-but-implied number.

import { SEGMENT_MIN_PEOPLE_TO_NAME } from "./segments";

/** A stored history row (count-only; no person data). Mirrors the columns of
 * `team_capability_history`. */
export type CapabilityHistoryRow = {
  teamId: string | null;
  capabilitySlug: string;
  periodStart: string;
  periodEnd: string;
  representedCount: number;
  totalCount: number;
  masteredCount: number;
  developingCount: number;
  confidenceTier: "measured" | "modeled" | "directional" | "not_measured";
};

/**
 * The single count-derived confidence-tier SUMMARY for a cohort. A team claim is
 * bounded by its weakest member (honest): "measured" ONLY when every represented
 * person is measured; "directional" while any represented person is only
 * directional; "not_measured" only when nobody is represented (in practice no
 * row is written for a 0-represented capability, so this is the empty case).
 */
export function summarizeConfidenceTier(
  measuredCount: number,
  representedCount: number,
): "measured" | "directional" | "not_measured" {
  if (representedCount <= 0) return "not_measured";
  return measuredCount >= representedCount ? "measured" : "directional";
}

/**
 * Apply the MIN_PEOPLE floor at READ time: drop any capability whose
 * `representedCount` is below the floor ENTIRELY (never a suppressed-but-implied
 * number). Mirrors the dashboard coverage card's `withState >=
 * SEGMENT_MIN_PEOPLE_TO_NAME` gate. The default floor is
 * `SEGMENT_MIN_PEOPLE_TO_NAME` so history suppression matches the live view.
 */
export function applyMinPeopleFloor<T extends { representedCount: number }>(
  rows: readonly T[],
  minPeople: number = SEGMENT_MIN_PEOPLE_TO_NAME,
): T[] {
  return rows.filter((r) => r.representedCount >= minPeople);
}
