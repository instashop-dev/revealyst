// W7-7 experimentation — deterministic holdout / variant assignment for
// recommendation A/B tests. PURE and deterministic: a person is assigned by a
// STABLE hash of (experiment key, person id), never per-request random, so the
// same person always sees the same arm across renders and the exposure log can
// attribute an effect. No ML — a rules-and-features holdout, the plan's §7
// "deterministic holdout, not per-request random".

export type Experiment = {
  key: string;
  /** Named variant arms (excluding the holdout control). At least one. */
  variants: readonly [string, ...string[]];
  /** Fraction [0,1] assigned to the HOLDOUT (kept on the control so a lift can
   * be measured against them). */
  holdoutPct: number;
};

/**
 * The ACTIVE experiment registry. Empty at launch — a config list, not a hollow
 * table. Turning on an A/B test = adding an entry here (with an ADR when it
 * changes ranking/copy). The exposure log then records each person's assignment
 * as recs are shown, so a later analysis can compare arms.
 */
export const EXPERIMENTS: readonly Experiment[] = [];

/** Deterministic 32-bit FNV-1a hash — stable across processes and renders (no
 * crypto needed for bucketing; must NOT be Math.random). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Assignment = {
  experimentKey: string;
  /** The assigned variant, or null when the person is in the holdout. */
  variant: string | null;
  holdout: boolean;
};

/** A stable [0,1) bucket for (experiment, person). */
function bucket(experimentKey: string, personId: string): number {
  return (hash32(`${experimentKey}:${personId}`) % 100_000) / 100_000;
}

/**
 * Deterministically assign a person to the holdout or a variant of one
 * experiment. Same inputs → same assignment, always. Variants are spread evenly
 * by an independent hash so holdout membership and variant choice don't
 * correlate.
 */
export function assignVariant(
  personId: string,
  experiment: Experiment,
): Assignment {
  if (bucket(experiment.key, personId) < experiment.holdoutPct) {
    return { experimentKey: experiment.key, variant: null, holdout: true };
  }
  const idx = hash32(`${experiment.key}:v:${personId}`) % experiment.variants.length;
  return {
    experimentKey: experiment.key,
    variant: experiment.variants[idx],
    holdout: false,
  };
}

/** Every active experiment's assignment for a person (empty when none active). */
export function assignmentsFor(personId: string): Assignment[] {
  return EXPERIMENTS.map((e) => assignVariant(personId, e));
}

/** The single assignment to stamp on an exposure row — the first active
 * ranking/copy experiment, or nulls when none is active (the launch state). */
export function exposureAssignment(personId: string): {
  experimentKey: string | null;
  variant: string | null;
} {
  const first = assignmentsFor(personId)[0];
  return first
    ? { experimentKey: first.experimentKey, variant: first.variant }
    : { experimentKey: null, variant: null };
}
