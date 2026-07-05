import { apiRoutes, personRefSchema } from "../contracts/api";
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
