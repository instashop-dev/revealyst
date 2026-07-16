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

// U1.3 (dedup): the mission-row derivation, extracted so the Today active-strip
// (personal-self-view) and the Growth board (growth/page) cannot drift onto two
// different status/step computations. Both feed it the SAME already-fetched rows
// — the global catalog, the signed-in person's measured mastery, and their opt-in
// progress — and get the identical rows back. Pure: no React, no I/O, no clock.

export type MissionMeta = { slug: string; title: string; summary: string };
export type MissionCatalogStep = {
  missionSlug: string;
  capabilitySlug: string;
  targetMastery: number;
};
export type MissionProgressLike = {
  missionSlug: string;
  completedAt: Date | null;
};

export type DerivedMissionRow = {
  slug: string;
  title: string;
  summary: string;
  /** "not-started" | "in-progress" | "complete" — derived from opt-in progress
   * + the measured completion stamp (never a self-asserted checkbox). */
  status: "not-started" | "in-progress" | "complete";
  /** Steps the person's measured mastery has reached. */
  stepsReached: number;
  totalSteps: number;
  /** Completion date (ISO), or null — the Growth board renders it on the
   * completed timeline; the Today active-strip ignores this extra field. */
  completedAt: string | null;
};

/**
 * Derive one row per catalog mission: its status (from the person's opt-in
 * progress + the reducer's measured-crossing stamp), how many steps their
 * measured mastery has reached, and — for the completed timeline — the
 * completion date. Deterministic; preserves the catalog's order.
 */
export function deriveMissionRows(input: {
  catalog: {
    missions: readonly MissionMeta[];
    steps: readonly MissionCatalogStep[];
  };
  capabilityStates: readonly { capabilitySlug: string; mastery: number }[];
  progress: readonly MissionProgressLike[];
}): DerivedMissionRow[] {
  const masteryBySlug = new Map(
    input.capabilityStates.map((s) => [s.capabilitySlug, s.mastery]),
  );
  const stepsByMission = new Map<string, MissionStepTarget[]>();
  for (const step of input.catalog.steps) {
    const list = stepsByMission.get(step.missionSlug);
    const target = {
      capabilitySlug: step.capabilitySlug,
      targetMastery: step.targetMastery,
    };
    if (list) list.push(target);
    else stepsByMission.set(step.missionSlug, [target]);
  }
  const progressBySlug = new Map(input.progress.map((p) => [p.missionSlug, p]));
  return input.catalog.missions.map((m) => {
    const steps = stepsByMission.get(m.slug) ?? [];
    const prog = progressBySlug.get(m.slug);
    const status = !prog
      ? ("not-started" as const)
      : prog.completedAt
        ? ("complete" as const)
        : ("in-progress" as const);
    return {
      slug: m.slug,
      title: m.title,
      summary: m.summary,
      status,
      stepsReached: completedStepCount(steps, masteryBySlug),
      totalSteps: steps.length,
      completedAt: prog?.completedAt ? prog.completedAt.toISOString() : null,
    };
  });
}
