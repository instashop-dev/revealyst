import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { computeSignalCoverage } from "../lib/signal-coverage";
import {
  computeCapabilityStates,
  type CapabilityGraphInput,
  type PersonEvidenceInput,
} from "./capability-state";
import { isMissionComplete } from "./mission-progress";

// W7-2 capability-state reducer: the I/O half of the mastery engine. Runs as a
// PARALLEL step after the nightly score recompute (src/poller/process.ts
// `score-recompute`) — it reads the fresh person-level score components + a
// BOUNDED recent-metric window and writes `user_capability_state`. It never
// touches the frozen score engine (recompute.ts) — the Maturity Model precedent.
//
// Perf (L3): every read is batched ONCE for the whole org — identities, people,
// connections, subjects, person-level scores (one query), and one query per
// distinct BOUND metric key (a fixed ~14, independent of person count). Evidence
// is then grouped in memory. The query count is independent of person count AND
// of history depth (the metric window is watermark-bounded), enforced by
// tests/perf. Idempotent: same inputs → same rows (recompute-derivable), so the
// backfill is safe to ship empty and populate on the next nightly pass.

/** How far back the reducer reads bound-metric evidence — the watermark that
 * keeps the run O(window), never O(history). */
const EVIDENCE_WINDOW_DAYS = 28;

export type CapabilityStateSummary = {
  /** People that received ≥1 capability-state row this run. */
  peopleWithState: number;
  /** Total state rows written across all people. */
  rowsWritten: number;
  /** People iterated (had ≥1 exclusive subject). */
  peopleConsidered: number;
  /** W7-5: missions newly completed this run (measured crossings). */
  missionsCompleted: number;
};

function windowStart(asOfDay: string): string {
  const anchor = Date.parse(`${asOfDay}T00:00:00Z`);
  if (Number.isNaN(anchor)) return asOfDay;
  return new Date(anchor - (EVIDENCE_WINDOW_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Recompute per-person capability state for one org over the window ending
 * `asOfDay`. Safe to call with an empty capability graph (returns a zero
 * summary — the "ship empty" guarantee).
 */
export async function recomputeCapabilityState(
  db: Db,
  orgId: string,
  options: { asOfDay: string },
): Promise<CapabilityStateSummary> {
  const { asOfDay } = options;
  const scoped = forOrg(db, orgId);
  const graphRaw = await scoped.capabilities.graph();
  if (graphRaw.capabilities.length === 0) {
    return {
      peopleWithState: 0,
      rowsWritten: 0,
      peopleConsidered: 0,
      missionsCompleted: 0,
    };
  }
  const graph: CapabilityGraphInput = {
    capabilities: graphRaw.capabilities.map((c) => ({
      slug: c.slug,
      sort: c.sort,
    })),
    dependencies: graphRaw.dependencies,
    signals: graphRaw.signals,
  };

  // ── One batched read set for the whole org (person-count-independent) ──
  const [
    people,
    identities,
    subjects,
    connections,
    personScores,
    priorStateIds,
    missionCatalog,
    missionProgressRows,
  ] = await Promise.all([
    scoped.people.list(),
    scoped.identities.all(),
    scoped.subjects.list(),
    scoped.connections.list(),
    scoped.scores.results({ subjectLevel: "person", to: asOfDay }),
    scoped.mastery.personIdsWithState(),
    // W7-5: the mission catalog (global) + this org's progress, for measured
    // completion detection folded into the same nightly pass.
    scoped.missions.catalog(),
    scoped.missions.progressForOrg(),
  ]);

  // Mission steps grouped by mission, and each person's STARTED-but-not-
  // completed missions — the only ones a completion can newly fire for.
  const stepsByMission = new Map<string, { capabilitySlug: string; targetMastery: number }[]>();
  for (const step of missionCatalog.steps) {
    const list = stepsByMission.get(step.missionSlug);
    const target = { capabilitySlug: step.capabilitySlug, targetMastery: step.targetMastery };
    if (list) list.push(target);
    else stepsByMission.set(step.missionSlug, [target]);
  }
  const openMissionsByPerson = new Map<string, string[]>();
  for (const row of missionProgressRows) {
    if (row.completedAt !== null) continue; // already finished — never re-fires
    const list = openMissionsByPerson.get(row.personId);
    if (list) list.push(row.missionSlug);
    else openMissionsByPerson.set(row.personId, [row.missionSlug]);
  }
  const completions: { personId: string; missionSlug: string }[] = [];
  // Deterministic completion timestamp from asOfDay (no wall-clock in the pure
  // path; testable).
  const completedAt = new Date(`${asOfDay}T00:00:00Z`);

  // Exclusive subjects per person (a subject owned by exactly one person) —
  // the same "shared accounts never mint per-person numbers" rule the score
  // engine uses, built here in ONE pass over identities (no per-person query).
  const ownersBySubject = new Map<string, number>();
  const subjectsByPerson = new Map<string, Set<string>>();
  for (const link of identities) {
    ownersBySubject.set(
      link.subjectId,
      (ownersBySubject.get(link.subjectId) ?? 0) + 1,
    );
    const set = subjectsByPerson.get(link.personId);
    if (set) set.add(link.subjectId);
    else subjectsByPerson.set(link.personId, new Set([link.subjectId]));
  }
  const exclusiveByPerson = new Map<string, Set<string>>();
  for (const [personId, subjectIds] of subjectsByPerson) {
    const own = new Set(
      [...subjectIds].filter((s) => ownersBySubject.get(s) === 1),
    );
    if (own.size > 0) exclusiveByPerson.set(personId, own);
  }

  // Distinct bound METRIC keys (component bindings need no metric read — they
  // come from the score components already fetched). One query per key.
  const boundMetricKeys = [
    ...new Set(
      graph.signals
        .map((s) => s.metricKey)
        .filter((k): k is string => k !== null),
    ),
  ];
  const from = windowStart(asOfDay);
  const metricRowsByKey = new Map<
    string,
    { subjectId: string; day: string }[]
  >();
  await Promise.all(
    boundMetricKeys.map(async (metricKey) => {
      const rows = await scoped.metrics.records({ metricKey, from, to: asOfDay });
      metricRowsByKey.set(
        metricKey,
        rows.map((r) => ({ subjectId: r.subjectId, day: r.day })),
      );
    }),
  );

  // Per-person latest month score components → componentKey → normalized.
  const componentsByPerson = new Map<string, Map<string, number>>();
  // Track the latest periodEnd per (person, definition) so a later period wins.
  const latestPeriodEnd = new Map<string, string>();
  for (const row of personScores) {
    if (row.subjectLevel !== "person" || !row.personId) continue;
    if (row.periodGrain !== "month") continue;
    const key = `${row.personId}::${row.definitionId}`;
    const prev = latestPeriodEnd.get(key);
    if (prev && prev > row.periodEnd) continue;
    latestPeriodEnd.set(key, row.periodEnd);
    const map = componentsByPerson.get(row.personId) ?? new Map<string, number>();
    const components = (row.components ?? {}) as Record<
      string,
      { normalized?: number }
    >;
    for (const [componentKey, detail] of Object.entries(components)) {
      if (detail && typeof detail.normalized === "number") {
        map.set(componentKey, detail.normalized);
      }
    }
    componentsByPerson.set(row.personId, map);
  }

  const coverage = computeSignalCoverage({
    identities: identities.map((i) => ({
      subjectId: i.subjectId,
      personId: i.personId,
    })),
    subjects: subjects.map((s) => ({ id: s.id, connectionId: s.connectionId })),
    connections: connections.map((c) => ({ id: c.id, vendor: c.vendor })),
  });

  let peopleWithState = 0;
  let rowsWritten = 0;
  let peopleConsidered = 0;

  for (const person of people) {
    const exclusive = exclusiveByPerson.get(person.id);
    // A person with no exclusive subjects has no per-person evidence — its
    // state must be reconciled to empty (a prior run may have left rows).
    peopleConsidered += 1;

    const metricEvidence = new Map<
      string,
      { evidenceDays: number; count: number; lastDay: string | null }
    >();
    if (exclusive) {
      for (const [metricKey, rows] of metricRowsByKey) {
        const days = new Set<string>();
        let count = 0;
        let lastDay: string | null = null;
        for (const r of rows) {
          if (!exclusive.has(r.subjectId)) continue;
          days.add(r.day);
          count += 1;
          if (!lastDay || r.day > lastDay) lastDay = r.day;
        }
        if (count > 0) {
          metricEvidence.set(metricKey, {
            evidenceDays: days.size,
            count,
            lastDay,
          });
        }
      }
    }

    const evidence: PersonEvidenceInput = {
      componentValues: componentsByPerson.get(person.id) ?? new Map(),
      metricEvidence,
      sourceCount: coverage.get(person.id)?.sourceCount ?? 0,
    };
    const states = computeCapabilityStates(graph, evidence, asOfDay);

    // Skip the write entirely for a person with no state now AND none before —
    // nothing to reconcile, so no per-person delete is issued.
    if (states.length === 0 && !priorStateIds.has(person.id)) continue;

    await scoped.mastery.replaceForPerson(
      person.id,
      states.map((s) => ({
        personId: person.id,
        capabilitySlug: s.capabilitySlug,
        mastery: s.mastery,
        confidence: s.confidence,
        confidenceTier: s.confidenceTier,
        evidenceCount: s.evidenceCount,
        lastEvidenceAt: s.lastEvidenceAt,
        staleness: s.staleness,
        nextCapability: s.nextCapability,
        components: s.components,
      })),
    );
    if (states.length > 0) {
      peopleWithState += 1;
      rowsWritten += states.length;
    }

    // W7-5: mission completion — a MEASURED crossing. For each of this person's
    // started-but-open missions, complete it iff every step's capability mastery
    // (just computed) meets its target. Derived from the numbers, never a
    // self-asserted click.
    const open = openMissionsByPerson.get(person.id);
    if (open && open.length > 0) {
      const masteryBySlug = new Map(
        states.map((s) => [s.capabilitySlug, s.mastery]),
      );
      for (const missionSlug of open) {
        if (isMissionComplete(stepsByMission.get(missionSlug) ?? [], masteryBySlug)) {
          completions.push({ personId: person.id, missionSlug });
        }
      }
    }
  }

  // Stamp completions (idempotent — markComplete only sets a still-null row, so
  // the "you finished" moment fires exactly once).
  for (const { personId, missionSlug } of completions) {
    await scoped.missions.markComplete(personId, missionSlug, completedAt);
  }

  return {
    peopleWithState,
    rowsWritten,
    peopleConsidered,
    missionsCompleted: completions.length,
  };
}
