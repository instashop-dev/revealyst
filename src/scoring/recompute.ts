import {
  scoreComponentsSchema,
  type ScoreComponent,
} from "../contracts/scores";
import type { Db } from "../db/client";
import { forOrg, type ScoreResultUpsert } from "../db/org-scope";
import { subscriptionsForOrg } from "../db/subscriptions";
import { isCustomSlug } from "../lib/custom-index";
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

export type ParsedDefinition = {
  id: string;
  subjectLevel: "person" | "team" | "org";
  components: ScoreComponent[];
};

/** subjectId → rows, for one metric — filtered per subject set at evaluate time. */
type MetricRows = Map<string, EngineRow[]>;

async function loadActiveDefinitions(
  scoped: ScopedRepo,
  customIndexesEntitled: boolean,
): Promise<{ definitions: ParsedDefinition[]; skipped: number }> {
  const rows = await scoped.scores.definitions();
  const definitions: ParsedDefinition[] = [];
  let skipped = 0;
  for (const d of rows) {
    if (d.status !== "active") continue;
    // §8.5 guardrail 5 — entitlement lapse: custom definitions stop
    // recomputing when the org is no longer on the Team plan. Their last
    // score_results rows are left untouched (never deleted) so the UI can
    // render them in an explicit "paused" state rather than silently stale.
    // Presets (global + the personal-org preset clones) are non-custom
    // slugs and always recompute, regardless of entitlement.
    if (!customIndexesEntitled && isCustomSlug(d.slug)) continue;
    // One malformed org-authored definition must not take down the org's
    // whole nightly recompute (presets included) — skip it loudly and
    // keep scoring the rest.
    const parsed = scoreComponentsSchema.safeParse(d.components);
    if (!parsed.success) {
      skipped += 1;
      console.warn(
        `scoring: skipping definition ${d.slug}@v${d.version} (${d.id}) — components fail the frozen contract: ${parsed.error.message}`,
      );
      continue;
    }
    definitions.push({
      id: d.id,
      subjectLevel: d.subjectLevel,
      components: parsed.data,
    });
  }
  return { definitions, skipped };
}

export async function loadRowsByMetric(
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
    // The repo orders by day only; same-day order is unspecified and float
    // addition is not associative — sort on the full natural key so equal
    // inputs aggregate in one canonical order (byte-identical results).
    rows.sort(
      (a, b) =>
        a.subjectId.localeCompare(b.subjectId) ||
        a.day.localeCompare(b.day) ||
        a.dim.localeCompare(b.dim),
    );
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
export function rowsForSubjects(
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

/** Identity resolution for scoring, split by how a subject may be used:
 * - `teamSubjects(person)`: every subject the person is linked to — team
 *   aggregates include shared subjects (the frozen oracle's semantics; a
 *   team-level union is not a per-person number).
 * - `exclusiveSubjects(person)`: only subjects linked to exactly ONE
 *   person. A shared account's rows must never be credited to each linked
 *   person's individual score — that would mint N copies of one number
 *   from account-level data (§6.1: surfaced, not redistributed).
 * Key/account subjects with no identity link appear at org level only. */
export async function loadPersonSubjects(scoped: ScopedRepo): Promise<{
  linked: Map<string, Set<string>>;
  exclusive: Map<string, Set<string>>;
}> {
  const people = await scoped.people.list();
  const linked = new Map<string, Set<string>>();
  const ownersBySubject = new Map<string, number>();
  for (const person of people) {
    const links = await scoped.identities.forPerson(person.id);
    if (links.length === 0) continue;
    linked.set(person.id, new Set(links.map((l) => l.subjectId)));
    for (const link of links) {
      ownersBySubject.set(
        link.subjectId,
        (ownersBySubject.get(link.subjectId) ?? 0) + 1,
      );
    }
  }
  const exclusive = new Map<string, Set<string>>();
  for (const [personId, subjects] of linked) {
    const own = new Set(
      [...subjects].filter((s) => ownersBySubject.get(s) === 1),
    );
    if (own.size > 0) {
      exclusive.set(personId, own);
    }
  }
  return { linked, exclusive };
}

export type RecomputeSummary = {
  definitionsEvaluated: number;
  definitionsSkipped: number;
  resultsWritten: number;
  /** Stale rows reconciled away this run, across all subject levels: a
   * person relinked off an exclusive subject or dropped to zero signal, or
   * a team/org whose underlying window emptied (ADR 0012) — surfaced,
   * never silent. */
  staleResultsRemoved: number;
};

/**
 * Recomputes every active score definition for one org over one period.
 * Deterministic: same rows in, same score_results out; safe to re-run
 * (upserts on the frozen (org, definition, subject, period) key).
 *
 * `customIndexesEntitled` (§8.5 guardrail 5): when the org is not on the Team
 * plan, org-authored custom definitions are excluded from this run (their last
 * results persist for a "paused" render). Presets are always recomputed.
 * Callers that already know the entitlement (the queue consumer) pass it to
 * avoid a duplicate subscription read across the month/rolling recompute pair;
 * direct callers may omit it and it is resolved from the org's subscription.
 */
export async function recomputeOrg(
  db: Db,
  orgId: string,
  options: { period: Period; customIndexesEntitled?: boolean },
): Promise<RecomputeSummary> {
  const { period } = options;
  const scoped = forOrg(db, orgId);
  const customIndexesEntitled =
    options.customIndexesEntitled ??
    (await subscriptionsForOrg(db, orgId).current()).plan === "team";
  const { definitions, skipped } = await loadActiveDefinitions(
    scoped,
    customIndexesEntitled,
  );
  if (definitions.length === 0) {
    return {
      definitionsEvaluated: 0,
      definitionsSkipped: skipped,
      resultsWritten: 0,
      staleResultsRemoved: 0,
    };
  }

  const byMetric = await loadRowsByMetric(scoped, definitions, period);
  const { linked, exclusive } = await loadPersonSubjects(scoped);
  const upserts: ScoreResultUpsert[] = [];
  let staleRemoved = 0;

  const needsTeams = definitions.some((d) => d.subjectLevel === "team");
  const teamSubjects = new Map<string, Set<string>>();
  if (needsTeams) {
    for (const team of await scoped.teams.list()) {
      const subjects = new Set<string>();
      for (const member of await scoped.teams.members(team.id)) {
        for (const subjectId of linked.get(member.personId) ?? []) {
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
      // Exclusive subjects only: shared accounts never mint per-person rows.
      const scoredPersonIds: string[] = [];
      for (const [personId, subjectIds] of exclusive) {
        const result = evaluateDefinition(
          definition.components,
          rowsForSubjects(definition, byMetric, subjectIds),
          period,
        );
        if (result) {
          upserts.push({ ...base, personId, ...result });
          scoredPersonIds.push(personId);
        }
      }
      // A person who no longer qualifies this round (relinked off an
      // exclusive subject, or dropped to zero signal) must not keep a
      // stale row from a prior recompute — reconcile down to exactly who
      // was actually scored just now.
      const removed = await scoped.scores.deleteStalePersonResults(
        definition.id,
        period,
        scoredPersonIds,
      );
      staleRemoved += removed;
    } else if (definition.subjectLevel === "team") {
      const scoredTeamIds: string[] = [];
      for (const [teamId, subjectIds] of teamSubjects) {
        const result = evaluateDefinition(
          definition.components,
          rowsForSubjects(definition, byMetric, subjectIds),
          period,
        );
        if (result) {
          upserts.push({ ...base, teamId, ...result });
          scoredTeamIds.push(teamId);
        }
      }
      // Same reconcile-down as the person branch (ADR 0012): a team whose
      // underlying rows vanished (restatement-to-empty, purged connection)
      // must not keep a score computed from data that no longer exists.
      staleRemoved += await scoped.scores.deleteStaleTeamResults(
        definition.id,
        period,
        scoredTeamIds,
      );
    } else {
      const result = evaluateDefinition(
        definition.components,
        rowsForSubjects(definition, byMetric, null),
        period,
      );
      if (result) {
        upserts.push({ ...base, ...result });
      } else {
        // Org sibling of the same reconcile (ADR 0012).
        staleRemoved += await scoped.scores.deleteStaleOrgResults(
          definition.id,
          period,
        );
      }
    }
  }

  if (upserts.length > 0) {
    await scoped.scores.upsertResults(upserts);
  }
  return {
    definitionsEvaluated: definitions.length,
    definitionsSkipped: skipped,
    resultsWritten: upserts.length,
    staleResultsRemoved: staleRemoved,
  };
}
