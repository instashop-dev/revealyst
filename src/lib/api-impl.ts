import {
  apiRoutes,
  personRefSchema,
  type ConnectionsUpdateRequest,
} from "../contracts/api";
import {
  lowestAttribution,
  type AttributionLevel,
  type VendorId,
} from "../contracts/attribution";
import type {
  AuthCheckResult,
  ConnectorContext,
} from "../contracts/connector";
import type { MetricKey } from "../contracts/metrics";
import { getConnector } from "../connectors/registry";
import type { forOrg } from "../db/org-scope";
import type { CredentialEnv } from "../lib/credentials";
import { addDays } from "../poller/backfill";
import type { PollMessage } from "../poller/messages";

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

type ConnectionRow = Awaited<
  ReturnType<OrgScope["connections"]["list"]>
>[number];

/** One connections row → the frozen connectionSchema shape. Never carries
 * credential material (there is no credential-read path anywhere). */
function toConnectionShape(connection: ConnectionRow) {
  return {
    id: connection.id,
    vendor: connection.vendor,
    displayName: connection.displayName,
    status: connection.status,
    lastSuccessAt: connection.lastSuccessAt?.toISOString() ?? null,
    lastError: connection.lastError,
  };
}

export async function listConnections(scope: OrgScope) {
  const connections = await scope.connections.list();
  return apiRoutes.connectionsList.response.parse({
    connections: connections.map(toConnectionShape),
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
      // Structured key so a literal separator inside kind/detail can't
      // collapse two distinct gaps into one.
      const key = JSON.stringify([kind, detail ?? null]);
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

// ─── Connect surface (W2-H PR2) ───────────────────────────────────────────
// The onboarding write path: create a connection, store+validate its
// credential (write-only — plaintext in, nothing credential-shaped out), and
// enqueue the first backfill + poll so the <10-min key→score promise doesn't
// wait for the next cron tick. Enqueue building blocks are shared with the
// cron dispatcher (src/poller/dispatch.ts) — same window/chunk math, so the
// on-demand and scheduled paths cannot drift.

type CredentialKind =
  | "api_key"
  | "github_app_private_key"
  | "github_app_installation"
  | "pat"
  | "device_token";

type CreateConnectionInput = {
  vendor: VendorId;
  displayName: string;
  authKind:
    | "api_key"
    | "admin_key"
    | "analytics_key"
    | "github_app"
    | "pat"
    | "device_token";
  config?: Record<string, unknown>;
};

/** Queue producer, injected so tests exercise the impl without a Worker. */
export type ConnectorEnqueue = {
  send: (
    message: PollMessage,
    opts?: { delaySeconds?: number },
  ) => Promise<void>;
  now?: () => Date;
};

export async function createConnection(
  scope: OrgScope,
  input: CreateConnectionInput,
) {
  const connection = await scope.connections.create({
    vendor: input.vendor,
    displayName: input.displayName,
    authKind: input.authKind,
    config: input.config ?? {},
  });
  return apiRoutes.connectionsCreate.response.parse({
    connection: toConnectionShape(connection),
  });
}

/** ADR 0013: rename and/or pause-resume. Resume deliberately leaves
 * lastError for the next successful poll to clear, and lands a never-synced
 * connection on "pending" (never fabricate a clean or healthy state). */
export async function updateConnection(
  scope: OrgScope,
  connectionId: string,
  patch: ConnectionsUpdateRequest,
) {
  const row = await scope.connections.update(connectionId, patch);
  if (!row) {
    throw new ApiError(404, "connection not found");
  }
  return apiRoutes.connectionsUpdate.response.parse({
    connection: toConnectionShape(row),
  });
}

/** Implements the frozen connectionsDelete contract (ADR 0013). Removes the
 * connection's metric_records plus the cascade graph (credential, subjects
 * and their records, raw payloads, run history) in one transaction; scores
 * reconcile at the next recompute. */
export async function deleteConnection(scope: OrgScope, connectionId: string) {
  const removed = await scope.connections.delete(connectionId);
  if (!removed) {
    throw new ApiError(404, "connection not found");
  }
  return apiRoutes.connectionsDelete.response.parse({ ok: true });
}

/**
 * Store the credential, then validate-on-save: if a connector for the vendor
 * is registered, decrypt within the withCredential scope and call its
 * validateAuth so onboarding gets immediate feedback on a bad key. A rejected
 * key marks the connection errored (surfaced in the connections list) and
 * 400s; the write itself already happened (write-only, no read-back), so a
 * later re-PUT overwrites. Vendors with no shipped connector (Copilot/Cursor,
 * or the local agent's device_token) skip validation.
 */
export async function putConnectionCredential(
  scope: OrgScope,
  connectionId: string,
  input: { kind: CredentialKind; value: string; expiresAt?: string | null },
  env: CredentialEnv,
  actorUserId?: string,
) {
  const connection = await scope.connections.get(connectionId);
  if (!connection) {
    throw new ApiError(404, "connection not found");
  }
  await scope.connections.storeCredential(
    connectionId,
    input.kind,
    input.value,
    env,
    input.expiresAt ? new Date(input.expiresAt) : null,
  );
  // Audit HERE, not in the route: the store is durable from this point even
  // if validate-on-save rejects the key below (400) — overwriting a working
  // key with a bad one is exactly the action the trail must attribute
  // (ADR 0010). Kind only, never the value.
  if (actorUserId) {
    await scope.auditLog.record({
      actorUserId,
      action: "connection.store_credential",
      targetKind: "connection",
      targetId: connectionId,
      metadata: { kind: input.kind },
    });
  }

  const entry = getConnector(connection.vendor);
  if (entry) {
    let check: AuthCheckResult;
    try {
      check = await scope.connections.withCredential(
        connectionId,
        input.kind,
        env,
        (plaintext) => {
          const ctx: ConnectorContext = {
            connection: {
              id: connection.id,
              orgId: scope.orgId,
              vendor: connection.vendor as VendorId,
              config: (connection.config as Record<string, unknown>) ?? {},
            },
            credential: plaintext,
            now: () => new Date(),
            log: () => {},
          };
          return entry.connector.validateAuth(ctx);
        },
      );
    } catch (error) {
      // validateAuth THREW (vendor network blip / 5xx / timeout), not a
      // definitive rejection. The credential is already stored and may be
      // perfectly valid — do NOT 500 or mark the connection errored on a
      // transient. Leave it pending; the next poll validates for real.
      console.warn(
        `credential validation inconclusive for connection ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return apiRoutes.connectionCredentialPut.response.parse({ ok: true });
    }
    if (!check.ok) {
      // A DEFINITIVE rejection (bad/expired key): surface it now. On a
      // PAUSED connection the status write no-ops (pause sticks, ADR 0013 —
      // "error" would re-enter the dispatch candidate set); the 400 below
      // still tells the caller the key is bad.
      await scope.connections.setStatus(connectionId, "error", check.reason);
      throw new ApiError(400, `credential rejected: ${check.reason}`);
    }
  }
  return apiRoutes.connectionCredentialPut.response.parse({ ok: true });
}

/**
 * Trigger an immediate poll of one connection (the onboarding "Sync now"
 * action): a regular poll over the vendor's restatement window, so recent
 * activity shows up without waiting for the next cron tick.
 *
 * It deliberately does NOT enqueue a backfill. The trailing 30–90-day
 * backfill chain-start is owned solely by the cron dispatcher
 * (dispatchDueConnectorWork), which derives "already started?" from the DB
 * (a distinct connector_runs backfill query) and runs on a single serialized
 * tick. Enqueuing a backfill from a request handler would race: the dedup
 * marker (a backfill connector_runs row) isn't written until the queue
 * consumer runs, so two rapid "Sync now" clicks — or one click plus the next
 * cron tick — would each see no backfill row and fork a duplicate full-window
 * crawl (data stays correct via idempotent upserts, but vendor-call cost
 * doubles). A duplicate *poll* is cheap and bounded, so triggering one here
 * is safe; a duplicate *backfill* is not. The dispatcher starts backfill
 * within one tick of the connection being credentialed.
 */
export async function pollConnection(
  scope: OrgScope,
  connectionId: string,
  enqueue: ConnectorEnqueue,
) {
  const connection = await scope.connections.get(connectionId);
  if (!connection) {
    throw new ApiError(404, "connection not found");
  }
  const entry = getConnector(connection.vendor);
  if (!entry) {
    throw new ApiError(
      400,
      `no connector available for ${connection.vendor} yet`,
    );
  }
  const now = (enqueue.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);
  await enqueue.send({
    kind: "connector-poll",
    orgId: scope.orgId,
    connectionId,
    window: {
      start: addDays(today, -entry.connector.capabilities.restatementWindowDays),
      end: today,
    },
  });
  return apiRoutes.connectionsPoll.response.parse({ ok: true });
}
