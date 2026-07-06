import { apiRoutes, personRefSchema } from "../contracts/api";
import {
  lowestAttribution,
  type AttributionLevel,
} from "../contracts/attribution";
import type { MetricKey } from "../contracts/metrics";
import type { forOrg } from "../db/org-scope";

type OrgScope = ReturnType<typeof forOrg>;
type VisibilityMode = "private" | "managed" | "full";

/**
 * Route-handler cores for the frozen W1-G contract routes. Pure functions
 * over the org-scoped repository (`forOrg`) so tests exercise them against
 * PGlite without a Worker runtime; the files under src/app/api/** are thin
 * HTTP glue. Every response is parsed through its frozen schema before it
 * leaves — contract drift fails loudly here, not in a dashboard.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function listTeams(scope: OrgScope) {
  const teams = await scope.teams.list();
  const withCounts = await Promise.all(
    teams.map(async (team) => ({
      id: team.id,
      name: team.name,
      memberCount: (await scope.teams.members(team.id)).length,
    })),
  );
  return apiRoutes.teamsList.response.parse({ teams: withCounts });
}

export async function createTeam(scope: OrgScope, name: string) {
  const team = await scope.teams.create(name);
  return apiRoutes.teamsCreate.response.parse({
    id: team.id,
    name: team.name,
  });
}

/**
 * PUT semantics: the request's personIds become the team's exact member
 * set. Unknown team or a person outside the org is a 404/400, never a
 * silent skip — the composite tenant FKs would reject cross-org rows
 * anyway; this just turns the failure into a useful status.
 */
export async function putTeamMembers(
  scope: OrgScope,
  teamId: string,
  personIds: string[],
) {
  const team = (await scope.teams.list()).find((t) => t.id === teamId);
  if (!team) {
    throw new ApiError(404, "team not found");
  }
  const requested = new Set(personIds);
  for (const personId of requested) {
    if (!(await scope.people.get(personId))) {
      throw new ApiError(400, `person ${personId} not in this org`);
    }
  }
  const current = new Set(
    (await scope.teams.members(teamId)).map((m) => m.personId),
  );
  for (const personId of requested) {
    if (!current.has(personId)) {
      await scope.teams.addMember(teamId, personId);
    }
  }
  for (const personId of current) {
    if (!requested.has(personId)) {
      await scope.teams.removeMember(teamId, personId);
    }
  }
  return apiRoutes.teamsPutMembers.response.parse({ ok: true });
}

/**
 * §7 privacy enforced by shape: personRefSchema is strict, and
 * displayName only survives when the org's visibility mode permits.
 */
export async function listPeople(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
) {
  const people = await scope.people.list();
  return apiRoutes.peopleList.response.parse({
    people: people.map((person) =>
      personRefSchema.parse({
        id: person.id,
        pseudonym: person.pseudonym,
        displayName:
          visibilityMode === "private" ? null : (person.displayName ?? null),
      }),
    ),
  });
}

export async function listConnections(scope: OrgScope) {
  const connections = await scope.connections.list();
  return apiRoutes.connectionsList.response.parse({
    connections: connections.map((connection) => ({
      id: connection.id,
      vendor: connection.vendor,
      displayName: connection.displayName,
      status: connection.status,
      lastSuccessAt: connection.lastSuccessAt?.toISOString() ?? null,
      lastError: connection.lastError,
    })),
  });
}

// ─── Personal read surface (W2-H) ─────────────────────────────────────────
// Every response is parsed through its frozen schema before it leaves, so
// contract drift fails loudly here rather than in a dashboard. §7 privacy is
// enforced by shape: a person ref only carries displayName when the org's
// visibility mode permits (personRefSchema is strict — no email/auth ids).

type PersonRow = { id: string; pseudonym: string; displayName: string | null };

function toPersonRef(
  person: PersonRow | undefined,
  visibilityMode: VisibilityMode,
) {
  if (!person) {
    return null;
  }
  return personRefSchema.parse({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName:
      visibilityMode === "private" ? null : (person.displayName ?? null),
  });
}

type ScoreResultRow = Awaited<
  ReturnType<OrgScope["scores"]["results"]>
>[number];

/** Hydrates raw score_results rows into the frozen scoreResultSchema shape:
 * definitionId → slug/version, personId → privacy-shaped personRef. */
async function hydrateScoreResults(
  scope: OrgScope,
  rows: ScoreResultRow[],
  visibilityMode: VisibilityMode,
) {
  const [definitions, people] = await Promise.all([
    scope.scores.definitions(),
    scope.people.list(),
  ]);
  const defById = new Map(definitions.map((d) => [d.id, d]));
  const personById = new Map(people.map((p) => [p.id, p]));
  return rows.map((row) => {
    const def = defById.get(row.definitionId);
    if (!def) {
      // A result row pointing at a definition this org can't see is a data
      // integrity fault, not a 4xx — surface it, don't paper over it.
      throw new ApiError(
        500,
        `score result references unknown definition ${row.definitionId}`,
      );
    }
    return {
      definitionSlug: def.slug,
      definitionVersion: def.version,
      subjectLevel: row.subjectLevel,
      person: toPersonRef(
        row.personId ? personById.get(row.personId) : undefined,
        visibilityMode,
      ),
      teamId: row.teamId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      periodGrain: row.periodGrain,
      value: row.value,
      attribution: row.attribution,
      components: row.components,
    };
  });
}

/** Distinct honesty gaps across a run set, deduped on kind+detail. Runs
 * store gaps as jsonb; keep only well-formed {kind[, detail]} entries. */
function collectGaps(runs: Array<{ gaps: unknown }>) {
  const seen = new Map<string, { kind: string; detail?: string }>();
  for (const run of runs) {
    if (!Array.isArray(run.gaps)) {
      continue;
    }
    for (const gap of run.gaps) {
      if (
        typeof gap !== "object" ||
        gap === null ||
        typeof (gap as { kind?: unknown }).kind !== "string"
      ) {
        continue;
      }
      const kind = (gap as { kind: string }).kind;
      const rawDetail = (gap as { detail?: unknown }).detail;
      const detail = typeof rawDetail === "string" ? rawDetail : undefined;
      const key = `${kind}|${detail ?? ""}`;
      if (!seen.has(key)) {
        seen.set(key, detail !== undefined ? { kind, detail } : { kind });
      }
    }
  }
  return [...seen.values()];
}

function sumRecordValues(rows: Array<{ value: number }>) {
  return rows.reduce((total, row) => total + row.value, 0);
}

/**
 * The self-view / overview payload: scores in range + consolidated spend +
 * active-people and unresolved-subject counts + honesty gaps. Spend and
 * counts come straight from real metric_records — nothing is estimated
 * except the explicitly-labelled `spendCentsEstimated` (agent-derived).
 */
export async function dashboardSummary(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  period: { from: string; to: string },
) {
  const { from, to } = period;
  const [resultRows, spendRows, estimatedRows, tracked, runs] =
    await Promise.all([
      scope.scores.results({ from, to }),
      scope.metrics.records({ metricKey: "spend_cents", from, to }),
      scope.metrics.records({ metricKey: "spend_cents_estimated", from, to }),
      scope.billing.trackedUsers({ start: from, end: to }),
      scope.connectorRuns.list({ limit: 200 }),
    ]);
  const scores = await hydrateScoreResults(scope, resultRows, visibilityMode);
  return apiRoutes.dashboardSummary.response.parse({
    scores,
    spendCents: sumRecordValues(spendRows),
    spendCentsEstimated: sumRecordValues(estimatedRows),
    activePeople: tracked.trackedPersonIds.length,
    unresolvedSubjects: tracked.unresolvedSubjectIds.length,
    gaps: collectGaps(runs),
  });
}

export async function listScores(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  filter: {
    from: string;
    to: string;
    slug?: string;
    level?: "person" | "team" | "org";
  },
) {
  const rows = await scope.scores.results({
    from: filter.from,
    to: filter.to,
    subjectLevel: filter.level,
  });
  const hydrated = await hydrateScoreResults(scope, rows, visibilityMode);
  const results = filter.slug
    ? hydrated.filter((r) => r.definitionSlug === filter.slug)
    : hydrated;
  return apiRoutes.scoresList.response.parse({ results });
}

/**
 * A single metric as a daily series, summed across subjects. Attribution
 * per day is the LOWEST across that day's rows (frozen propagation rule) —
 * a day mixing person- and account-level data is surfaced as account.
 */
export async function metricsSeries(
  scope: OrgScope,
  filter: { from: string; to: string; metric: MetricKey; dim?: string },
) {
  const rows = await scope.metrics.records({
    metricKey: filter.metric,
    from: filter.from,
    to: filter.to,
    dim: filter.dim,
  });
  const byDay = new Map<string, { value: number; levels: AttributionLevel[] }>();
  for (const row of rows) {
    const bucket = byDay.get(row.day) ?? { value: 0, levels: [] };
    bucket.value += row.value;
    bucket.levels.push(row.attribution);
    byDay.set(row.day, bucket);
  }
  const series = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucket]) => ({
      day,
      value: bucket.value,
      attribution: lowestAttribution(bucket.levels),
    }));
  return apiRoutes.metricsSeries.response.parse({ series });
}

/**
 * The tracked_user billing surface (frozen primitive). Billable count +
 * the resolved people it counts, alongside unresolved subjects — "surfaced,
 * not billed" is the payload shape itself. Unresolved subjects keep their
 * vendor identifiers (externalId/email): they are keys/accounts awaiting
 * reconciliation (W2-K), not pseudonymized people.
 */
export async function trackedUsers(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  period: { from: string; to: string },
) {
  const tracked = await scope.billing.trackedUsers({
    start: period.from,
    end: period.to,
  });
  const [people, subjects] = await Promise.all([
    scope.people.list(),
    scope.subjects.list(),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const trackedPeople = tracked.trackedPersonIds
    .map((id) => toPersonRef(personById.get(id), visibilityMode))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const unresolvedSubjects = tracked.unresolvedSubjectIds
    .map((id) => subjectById.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => ({
      id: s.id,
      connectionId: s.connectionId,
      kind: s.kind,
      externalId: s.externalId,
      email: s.email,
      displayName: s.displayName,
      resolved: false,
    }));
  return apiRoutes.billingTrackedUsers.response.parse({
    trackedUsers: tracked.trackedPersonIds.length,
    trackedPeople,
    unresolvedSubjects,
  });
}
