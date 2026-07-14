// W7-5 mission completion — a PURE helper. A mission step is DONE when the
// person's MEASURED mastery of the step's capability reaches its target; a
// mission is complete when every step is done. Completion is DERIVED from the
// mastery numbers (read from user_capability_state in the nightly reducer),
// never a self-asserted checkbox — the Spec V4 §8.4 anti-gamification rule.

export type MissionStepTarget = {
  capabilitySlug: string;
  targetMastery: number;
};

/** How many of a mission's steps the person has met (their mastery ≥ target).
 * A missing capability counts as mastery 0 (not met) — fails closed, honest. */
export function completedStepCount(
  steps: readonly MissionStepTarget[],
  masteryBySlug: ReadonlyMap<string, number>,
): number {
  return steps.filter(
    (s) => (masteryBySlug.get(s.capabilitySlug) ?? 0) >= s.targetMastery,
  ).length;
}

/** A mission is complete iff it has ≥1 step and EVERY step is met. */
export function isMissionComplete(
  steps: readonly MissionStepTarget[],
  masteryBySlug: ReadonlyMap<string, number>,
): boolean {
  return steps.length > 0 && completedStepCount(steps, masteryBySlug) === steps.length;
}
