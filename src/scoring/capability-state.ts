// The W7-2 capability-mastery engine: a PURE, deterministic function from the
// capability graph + one person's evidence to their per-capability state. Like
// the Maturity Model, it is a parallel pure lib over the same org-scoped readers
// — it NEVER extends the frozen score engine. All I/O lives in recompute-
// capability-state.ts. Priors are the person's already-computed score components
// (normalized 0–100) + bounded recent metric evidence, so a run is O(current
// state), never O(history).
//
// Honesty (invariant b), reused verbatim from the score engine:
//   - a capability with NO evidence for the person gets NO row (never mastery:0);
//   - a real, recent-but-low reading is kept (a measured low, not an absence);
//   - evidence too stale to count decays to withheld (no row), not a fake 0;
//   - every state carries an explainable per-signal breakdown.
// Mastery renders `directional` (uncalibrated proxies) UNLESS the OTel receiver
// (W7-8) has provided ≥2 corroborating MARKERS for the capability — real active
// time + real accept/reject — in which case it renders `measured` (ADR 0039, the
// L7 upgrade path).
import { OTEL_MARKER_METRIC_KEYS } from "../contracts/metrics";

/** Named, greppable directional constants — every one is an uncalibrated
 * threshold (hence the `directional` cap), tunable without a data migration. */
export const CAPABILITY_STATE_CONSTANTS = {
  /** Distinct evidence-days for a metric-bound signal to reach full mastery. */
  EVIDENCE_TARGET_DAYS: 10,
  /** mastery ≥ this counts as "mastered" for prerequisite / eligible-next. */
  MASTERED_THRESHOLD: 0.6,
  /** No decay within this many days of the last bound-signal evidence. */
  STALE_GRACE_DAYS: 14,
  /** Linear decay to zero across this span once past the grace window. */
  DECAY_SPAN_DAYS: 28,
  /** Evidence count for the full evidence-volume confidence term. */
  CONFIDENCE_EVIDENCE_TARGET: 20,
  /** Distinct connection sources for the full coverage confidence term. */
  COVERAGE_TARGET_SOURCES: 3,
  /** W7-8: ≥ this many bound OTel markers with evidence upgrade a capability
   * from `directional` to `measured` (the ADR 0039 corroboration rule). */
  MEASURED_MARKER_MIN: 2,
} as const;

export type CapabilityGraphInput = {
  capabilities: readonly { slug: string; sort: number }[];
  dependencies: readonly { capabilitySlug: string; requiresSlug: string }[];
  signals: readonly {
    capabilitySlug: string;
    metricKey: string | null;
    componentKey: string | null;
  }[];
};

/** One person's evidence, pre-batched by the reducer (no per-person query). */
export type PersonEvidenceInput = {
  /** componentKey → normalized [0..100], MEASURED components only (an omitted
   * or absent component simply isn't in the map — never a fabricated 0). */
  componentValues: ReadonlyMap<string, number>;
  /** metricKey → evidence in the window; absent when the person has none. */
  metricEvidence: ReadonlyMap<
    string,
    { evidenceDays: number; count: number; lastDay: string | null }
  >;
  /** Distinct connection sources contributing signal (signal-coverage). */
  sourceCount: number;
};

export type CapabilityComponentBreakdown = Record<
  string,
  { kind: "component" | "metric"; input: number; contribution: number }
>;

export type CapabilityStateComputed = {
  capabilitySlug: string;
  /** [0,1], rounded to 4dp (matches numeric(6,4)). */
  mastery: number;
  confidence: number;
  confidenceTier: "directional" | "measured";
  evidenceCount: number;
  lastEvidenceAt: string | null;
  staleness: number;
  nextCapability: string | null;
  components: CapabilityComponentBreakdown;
};

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD, UTC). Negative → 0. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Decay multiplier for evidence last seen `staleness` days ago. */
function decayFactor(staleness: number): number {
  const { STALE_GRACE_DAYS, DECAY_SPAN_DAYS } = CAPABILITY_STATE_CONSTANTS;
  if (staleness <= STALE_GRACE_DAYS) return 1;
  return clamp01(1 - (staleness - STALE_GRACE_DAYS) / DECAY_SPAN_DAYS);
}

type Draft = Omit<CapabilityStateComputed, "nextCapability">;

/** Compute one capability's state, or null when the person has no evidence for
 * it (or the evidence has fully decayed) — the honesty "no row" rule. */
function computeOne(
  capabilitySlug: string,
  graph: CapabilityGraphInput,
  evidence: PersonEvidenceInput,
  asOfDay: string,
): Draft | null {
  const bound = graph.signals.filter((s) => s.capabilitySlug === capabilitySlug);
  const breakdown: CapabilityComponentBreakdown = {};
  const signalScores: number[] = [];
  let evidenceCount = 0;
  let lastMetricDay: string | null = null;
  let hasComponentEvidence = false;

  for (const signal of bound) {
    if (signal.componentKey) {
      const normalized = evidence.componentValues.get(signal.componentKey);
      if (normalized === undefined) continue; // not measured → no evidence
      const score = clamp01(normalized / 100);
      signalScores.push(score);
      hasComponentEvidence = true;
      evidenceCount += 1;
      breakdown[signal.componentKey] = {
        kind: "component",
        input: round4(normalized),
        contribution: round4(score),
      };
    } else if (signal.metricKey) {
      const ev = evidence.metricEvidence.get(signal.metricKey);
      if (!ev || ev.count <= 0) continue; // no evidence for this signal
      const score = clamp01(
        ev.evidenceDays / CAPABILITY_STATE_CONSTANTS.EVIDENCE_TARGET_DAYS,
      );
      signalScores.push(score);
      evidenceCount += ev.count;
      if (ev.lastDay && (!lastMetricDay || ev.lastDay > lastMetricDay)) {
        lastMetricDay = ev.lastDay;
      }
      breakdown[signal.metricKey] = {
        kind: "metric",
        input: ev.evidenceDays,
        contribution: round4(score),
      };
    }
  }

  if (signalScores.length === 0) return null; // no evidence → no row

  const rawMastery = signalScores.reduce((a, b) => a + b, 0) / signalScores.length;
  // Component evidence is the freshly-recomputed score snapshot → treat as
  // current (asOfDay). A metric-only capability dates from its last metric day.
  const lastEvidenceAt = hasComponentEvidence
    ? asOfDay
    : lastMetricDay;
  const staleness = lastEvidenceAt ? daysBetween(lastEvidenceAt, asOfDay) : 0;
  const factor = decayFactor(staleness);
  if (factor === 0) return null; // fully decayed → withhold, never a fake 0
  const mastery = round4(rawMastery * factor);

  const coverageTerm = clamp01(
    evidence.sourceCount / CAPABILITY_STATE_CONSTANTS.COVERAGE_TARGET_SOURCES,
  );
  const evidenceTerm = clamp01(
    evidenceCount / CAPABILITY_STATE_CONSTANTS.CONFIDENCE_EVIDENCE_TARGET,
  );
  const completenessTerm =
    bound.length > 0 ? signalScores.length / bound.length : 0;
  const confidence = round4(
    clamp01(0.5 * coverageTerm + 0.3 * evidenceTerm + 0.2 * completenessTerm),
  );

  // W7-8 measured tier: a capability with evidence for ≥2 of its bound OTel
  // MARKERS (real active time + real accept/reject — signals NO admin-API
  // connector emits) renders `measured`, not just `directional` (ADR 0039).
  // Markers are DISTINCT metric keys from the connector metrics, so a marker and
  // a connector metric never double-count the same event (no cross-channel
  // double-count). Below the threshold, mastery stays capped at `directional`.
  const markersWithEvidence = bound.filter(
    (s) =>
      s.metricKey !== null &&
      (OTEL_MARKER_METRIC_KEYS as readonly string[]).includes(s.metricKey) &&
      (evidence.metricEvidence.get(s.metricKey)?.count ?? 0) > 0,
  ).length;
  const confidenceTier: "directional" | "measured" =
    markersWithEvidence >= CAPABILITY_STATE_CONSTANTS.MEASURED_MARKER_MIN
      ? "measured"
      : "directional";

  return {
    capabilitySlug,
    mastery,
    confidence,
    confidenceTier,
    evidenceCount,
    lastEvidenceAt,
    staleness,
    components: breakdown,
  };
}

/**
 * Compute every capability's state for one person. Returns only capabilities
 * the person has evidence for (no-evidence → omitted). `nextCapability` (the
 * same value on every row) is the person's single highest-priority eligible-next
 * capability: not yet mastered, and every prerequisite mastered — computed over
 * the WHOLE graph (a not-yet-started frontier capability counts), lowest sort
 * first.
 */
export function computeCapabilityStates(
  graph: CapabilityGraphInput,
  evidence: PersonEvidenceInput,
  asOfDay: string,
): CapabilityStateComputed[] {
  const drafts: Draft[] = [];
  for (const cap of graph.capabilities) {
    const draft = computeOne(cap.slug, graph, evidence, asOfDay);
    if (draft) drafts.push(draft);
  }

  const mastered = new Set(
    drafts
      .filter((d) => d.mastery >= CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD)
      .map((d) => d.capabilitySlug),
  );
  const prereqs = new Map<string, string[]>();
  for (const edge of graph.dependencies) {
    const list = prereqs.get(edge.capabilitySlug);
    if (list) list.push(edge.requiresSlug);
    else prereqs.set(edge.capabilitySlug, [edge.requiresSlug]);
  }
  const nextCapability =
    [...graph.capabilities]
      .sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
      .find(
        (cap) =>
          !mastered.has(cap.slug) &&
          (prereqs.get(cap.slug) ?? []).every((r) => mastered.has(r)),
      )?.slug ?? null;

  return drafts.map((d) => ({ ...d, nextCapability }));
}
