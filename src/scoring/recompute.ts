import {
  scoreComponentsSchema,
  type ScoreComponent,
} from "../contracts/scores";
import type { Db } from "../db/client";
import { forOrg, type ScoreResultUpsert } from "../db/org-scope";
import {
  componentMetricKeys,
  evaluateDefinition,
  type EngineRow,
} from "./evaluate";
import type { Period } from "./periods";

// Recompute orchestration: loads active definitions and the period's metric
// rows through the org-scoped repository (the only query surface), resolves
// subject sets per definition level, evaluates, and upserts score_results on
// the frozen recompute key — so nightly, on-demand post-backfill, and
// definition-version recomputes are all the same idempotent call. A new
// definition version is a new row/id, so recomputing a period writes fresh
// results and leaves the old version's history untouched.

type ScopedRepo = ReturnType<typeof forOrg>;

type ParsedDefinition = {
  id: string;
  subjectLevel: "person" | "team" | "org";
  components: ScoreComponent[];
};

/** subjectId → rows, for one metric — filtered per subject set at evaluate time. */
type MetricRows = Map<string, EngineRow[]>;

async function loadActiveDefinitions(
  scoped: ScopedRepo,
): Promise<ParsedDefinition[]> {
  const rows = await scoped.scores.definitions();
  return rows
    .filter((d) => d.status === "active")
    .map((d) => ({
      id: d.id,
      subjectLevel: d.subjectLevel,
      // Throw on drift: a definition row that fails the frozen contract is
      // a data bug to surface, not to score around.
      components: scoreComponentsSchema.parse(d.components),
    }));
}

async function loadRowsByMetric(
  scoped: ScopedRepo,
  definitions: ParsedDefinition[],
  period: Period,
): Promise<Map<string, MetricRows>> {
  const metricKeys = new Set(
    definitions.flatMap((d) => d.components.flatMap(componentMetricKeys)),
  );
  const byMetric = new Map<string, MetricRows>();
  for (const metricKey of metricKeys) {
    const rows = await scoped.metrics.records({
      metricKey,
      from: period.periodStart,
      to: period.periodEnd,
    });
    const bySubject: MetricRows = new Map();
    for (const row of rows) {
      const engineRow: EngineRow = {
        subjectId: row.subjectId,
        metricKey: row.metricKey,
        day: row.day,
        dim: row.dim,
        value: row.value,
        attribution: row.attribution,
      };
      const bucket = bySubject.get(row.subjectId);
      if (bucket) {
        bucket.push(engineRow);
      } else {
        bySubject.set(row.subjectId, [engineRow]);
      }
    }
    byMetric.set(metricKey, bySubject);
  }
  return byMetric;
}

/** Rows for one definition's metrics, restricted to a subject set (or all
 * subjects when `subjectIds` is null — the org level). */
function rowsForSubjects(
  definition: ParsedDefinition,
  byMetric: Map<string, MetricRows>,
  subjectIds: ReadonlySet<string> | null,
): Map<string, EngineRow[]> {
  const result = new Map<string, EngineRow[]>();
  for (const metricKey of new Set(
    definition.components.flatMap(componentMetricKeys),
  )) {
    const bySubject = byMetric.get(metricKey);
    if (!bySubject) continue;
    const rows: EngineRow[] = [];
    for (const [subjectId, subjectRows] of bySubject) {
      if (subjectIds === null || subjectIds.has(subjectId)) {
        rows.push(...subjectRows);
      }
    }
    if (rows.length > 0) {
      result.set(metricKey, rows);
    }
  }
  return result;
}

/** person id → the subjects their identities resolve to. Only
 * identity-resolved people are scored at person/team level — key/account
 * subjects with no identity link never become per-person numbers (§6.1). */
async function loadPersonSubjects(
  scoped: ScopedRepo,
): Promise<Map<string, Set<string>>> {
  const people = await scoped.people.list();
  const bySubjectOwner = new Map<string, Set<string>>();
  for (const person of people) {
    const links = await scoped.identities.forPerson(person.id);
    if (links.length > 0) {
      bySubjectOwner.set(person.id, new Set(links.map((l) => l.subjectId)));
    }
  }
  return bySubjectOwner;
}

export type RecomputeSummary = {
  definitionsEvaluated: number;
  resultsWritten: number;
};

/**
 * Recomputes every active score definition for one org over one period.
 * Deterministic: same rows in, same score_results out; safe to re-run
 * (upserts on the frozen (org, definition, subject, period) key).
 */
export async function recomputeOrg(
  db: Db,
  orgId: string,
  options: { period: Period },
): Promise<RecomputeSummary> {
  const { period } = options;
  const scoped = forOrg(db, orgId);
  const definitions = await loadActiveDefinitions(scoped);
  if (definitions.length === 0) {
    return { definitionsEvaluated: 0, resultsWritten: 0 };
  }

  const byMetric = await loadRowsByMetric(scoped, definitions, period);
  const personSubjects = await loadPersonSubjects(scoped);
  const upserts: ScoreResultUpsert[] = [];

  const needsTeams = definitions.some((d) => d.subjectLevel === "team");
  const teamSubjects = new Map<string, Set<string>>();
  if (needsTeams) {
    for (const team of await scoped.teams.list()) {
      const subjects = new Set<string>();
      for (const member of await scoped.teams.members(team.id)) {
        for (const subjectId of personSubjects.get(member.personId) ?? []) {
          subjects.add(subjectId);
        }
      }
      teamSubjects.set(team.id, subjects);
    }
  }

  for (const definition of definitions) {
    const base = {
      definitionId: definition.id,
      subjectLevel: definition.subjectLevel,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodGrain: period.periodGrain,
    } as const;

    if (definition.subjectLevel === "person") {
      for (const [personId, subjectIds] of personSubjects) {
        const result = evaluateDefinition(
          definition.components,
          rowsForSubjects(definition, byMetric, subjectIds),
          period,
        );
        if (result) {
          upserts.push({ ...base, personId, ...result });
        }
      }
    } else if (definition.subjectLevel === "team") {
      for (const [teamId, subjectIds] of teamSubjects) {
        const result = evaluateDefinition(
          definition.components,
          rowsForSubjects(definition, byMetric, subjectIds),
          period,
        );
        if (result) {
          upserts.push({ ...base, teamId, ...result });
        }
      }
    } else {
      const result = evaluateDefinition(
        definition.components,
        rowsForSubjects(definition, byMetric, null),
        period,
      );
      if (result) {
        upserts.push({ ...base, ...result });
      }
    }
  }

  if (upserts.length > 0) {
    await scoped.scores.upsertResults(upserts);
  }
  return {
    definitionsEvaluated: definitions.length,
    resultsWritten: upserts.length,
  };
}
