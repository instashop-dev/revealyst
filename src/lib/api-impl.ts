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
import {
  exchangeInstallationCode,
  type FetchFn,
  getInstallationAccount,
  userControlsInstallation,
  userIsOrgAdmin,
} from "../connectors/copilot/github-app";
import type { Db } from "../db/client";
import { orgMembersList } from "../db/invites";
import type { forOrg } from "../db/org-scope";
import type { CredentialEnv } from "../lib/credentials";
import { addDays } from "../poller/backfill";
import type { PollMessage } from "../poller/messages";
import { latestTeamScoresBySlug, type DefinitionRow } from "./dashboard-read";
import { isUniqueViolation } from "../db/org-scope/shared";
import type { TeamGoalMetric } from "./team-goal";
import { collectGaps } from "./honesty-gaps";
import { managerSurfaceAvailable } from "./manager-capability-view";
import { callerIsNoteSubject } from "./manager-notes-view";
import { budgetAlertFor, readMonthToDateSpend, todayUtc } from "./spend-governance";

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
  const [teams, allMembers] = await Promise.all([
    scope.teams.list(),
    scope.teams.allMembers(),
  ]);
  const countByTeam = new Map<string, number>();
  for (const m of allMembers) {
    countByTeam.set(m.teamId, (countByTeam.get(m.teamId) ?? 0) + 1);
  }
  const withCounts = teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberCount: countByTeam.get(team.id) ?? 0,
  }));
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
  const [teams, orgPeople, currentMembers] = await Promise.all([
    scope.teams.list(),
    scope.people.list(),
    scope.teams.members(teamId),
  ]);
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    throw new ApiError(404, "team not found");
  }
  const requested = new Set(personIds);
  const orgPersonIds = new Set(orgPeople.map((p) => p.id));
  for (const personId of requested) {
    if (!orgPersonIds.has(personId)) {
      throw new ApiError(400, `person ${personId} not in this org`);
    }
  }
  const current = new Set(currentMembers.map((m) => m.personId));
  // Two PHASES, adds then removes — a failed add must abort before any remove
  // commits, so a request that reports failure never leaves someone silently
  // dropped from the team. Within each phase the writes are independent, so
  // they're issued concurrently instead of awaited one-at-a-time: N per-member
  // round trips collapse to 2 batched round-trip stages on
  // Workers→Hyperdrive→Neon. The phase ordering still holds — the removes
  // phase never starts until every add has settled, and if any add fails the
  // whole request throws before the removes phase runs. (The frozen org-scope
  // API only exposes single-row addMember/removeMember; a true multi-row
  // INSERT/DELETE would need new methods = an ADR, not worth it for this
  // admin path.) allSettled, not Promise.all: Promise.all rejects on the
  // FIRST failure and abandons its in-flight siblings, whose later rejections
  // would surface as unhandledrejection events in the Workers runtime —
  // allSettled awaits every write, then rethrows the first failure.
  const settleAll = async (writes: Promise<unknown>[]) => {
    const failed = (await Promise.allSettled(writes)).find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failed) {
      throw failed.reason;
    }
  };
  const toAdd = [...requested].filter((personId) => !current.has(personId));
  const toRemove = [...current].filter((personId) => !requested.has(personId));
  await settleAll(
    toAdd.map((personId) => scope.teams.addMember(teamId, personId)),
  );
  await settleAll(
    toRemove.map((personId) => scope.teams.removeMember(teamId, personId)),
  );
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
    // W6-G: `date` columns read back as "YYYY-MM-DD" strings (or null).
    renewalDate: connection.renewalDate ?? null,
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
 * definitionId → slug/version, personId → privacy-shaped personRef.
 * `prefetched.definitions`/`prefetched.people` let a caller that already
 * fetched (or already kicked off) those reads hand them in — array or
 * promise, either is awaited here (await is a no-op on a plain array) — so a
 * page compositing multiple reads in one Promise.all doesn't pay for the
 * same query twice. */
async function hydrateScoreResults(
  scope: OrgScope,
  rows: ScoreResultRow[],
  visibilityMode: VisibilityMode,
  prefetched?: {
    definitions?: readonly DefinitionRow[] | Promise<readonly DefinitionRow[]>;
    people?: readonly PersonRow[] | Promise<readonly PersonRow[]>;
  },
) {
  const [definitions, people] = await Promise.all([
    prefetched?.definitions ?? scope.scores.definitions(),
    prefetched?.people ?? scope.people.list(),
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
  prefetched?: {
    definitions?: readonly DefinitionRow[] | Promise<readonly DefinitionRow[]>;
    people?: readonly PersonRow[] | Promise<readonly PersonRow[]>;
    /** Score rows EXACTLY as `scope.scores.results({ from, to })` for THIS
     * period would return them (all subject levels) — callers holding a
     * wider-span read slice it to the period predicate (periodStart ≥ from
     * AND periodEnd ≤ to) before passing it in. Saves the duplicate read on
     * pages that fetch score rows for their own delta/milestone math. */
    results?: Promise<Awaited<ReturnType<OrgScope["scores"]["results"]>>>;
    /** `spend_cents` metric rows sliced to [from, to] — same sharing rule. */
    spendRows?: Promise<Awaited<ReturnType<OrgScope["metrics"]["records"]>>>;
    /** `spend_cents_estimated` rows sliced to [from, to] — same sharing rule. */
    estimatedRows?: Promise<Awaited<ReturnType<OrgScope["metrics"]["records"]>>>;
  },
) {
  const { from, to } = period;
  const [resultRows, spendRows, estimatedRows, tracked, runs] =
    await Promise.all([
      prefetched?.results ?? scope.scores.results({ from, to }),
      prefetched?.spendRows ??
        scope.metrics.records({ metricKey: "spend_cents", from, to }),
      prefetched?.estimatedRows ??
        scope.metrics.records({ metricKey: "spend_cents_estimated", from, to }),
      scope.billing.trackedUsers({ start: from, end: to }),
      scope.connectorRuns.list({ limit: 200 }),
    ]);
  const scores = await hydrateScoreResults(
    scope,
    resultRows,
    visibilityMode,
    prefetched,
  );
  return apiRoutes.dashboardSummary.response.parse({
    scores,
    spendCents: sumRecordValues(spendRows),
    spendCentsEstimated: sumRecordValues(estimatedRows),
    activePeople: tracked.trackedPersonIds.length,
    unresolvedSubjects: tracked.unresolvedSubjectIds.length,
    gaps: collectGaps(runs),
  });
}

/**
 * Org settings mutation (ADR 0018): rename and/or change visibility mode —
 * the single most privacy-sensitive mutation in the product (§9.1). Writes the
 * row through the org-scoped `org.update` writer, then records an `audit_log`
 * entry (with its from→to) for each field whose value ACTUALLY changed against
 * `current`. A patch that sets a field to its existing value writes no audit
 * entry — a no-op must not fabricate accountability rows. Parses the result
 * through the frozen `settingsUpdate` response schema. Pure over the
 * org-scoped repository, so it's tested on PGlite; the route is thin HTTP glue.
 * Throws `ApiError(404)` only if the org row vanished mid-request (unreachable
 * in normal flow — the session guarantees it exists).
 *
 * Write-then-audit ordering is deliberate and matches every sibling admin
 * mutation (connection update/delete, reconcile actions, benchmark consent):
 * auditing first would fabricate a trail entry if the write then failed —
 * the worse direction under invariant (b). A crash in the narrow window
 * between the two loses the audit row, not the change; the audit trail is
 * accountability for what HAPPENED, so it must never lead the write.
 */
export async function updateOrgSettings(
  scope: OrgScope,
  input: {
    actorUserId: string;
    current: { id: string; name: string; visibilityMode: VisibilityMode };
    patch: { name?: string; visibilityMode?: VisibilityMode };
  },
) {
  const { actorUserId, current, patch } = input;
  const renamed =
    patch.name !== undefined && patch.name !== current.name
      ? { from: current.name, to: patch.name }
      : null;
  const revisibility =
    patch.visibilityMode !== undefined &&
    patch.visibilityMode !== current.visibilityMode
      ? { from: current.visibilityMode, to: patch.visibilityMode }
      : null;

  const row = await scope.org.update(patch);
  if (!row) {
    throw new ApiError(404, "org not found");
  }

  if (renamed) {
    await scope.auditLog.record({
      actorUserId,
      action: "org.rename",
      targetKind: "org",
      targetId: current.id,
      metadata: renamed,
    });
  }
  if (revisibility) {
    await scope.auditLog.record({
      actorUserId,
      action: "org.visibility_set",
      targetKind: "org",
      targetId: current.id,
      metadata: revisibility,
    });
  }

  return apiRoutes.settingsUpdate.response.parse({ org: row });
}

/**
 * Person → engineering-role assignment (W6-B, ADR 0030). Admin-set org config:
 * a `roleSlug` of null UNASSIGNS; a non-null value must be a known `roles`
 * reference slug (400 otherwise — validated against the reference table, not
 * left to the FK, so bad input is a clean 400 not a 500) and `personId` must
 * belong to this org (404 otherwise — the composite tenant FK is the backstop).
 * Write-then-audit like every sibling admin mutation. Pure over the org-scoped
 * repository, so it's tested on PGlite; the route is thin HTTP glue.
 */
export async function setPersonRole(
  scope: OrgScope,
  input: { personId: string; roleSlug: string | null; actorUserId: string },
) {
  const { personId, roleSlug, actorUserId } = input;

  // Person must belong to this org (org-scoped get returns undefined for a
  // foreign or unknown id) — a clean 404 rather than a composite-FK 500.
  const person = await scope.people.get(personId);
  if (!person) {
    throw new ApiError(404, "person not found");
  }

  if (roleSlug === null) {
    await scope.roles.unassign(personId);
    await scope.auditLog.record({
      actorUserId,
      action: "person.role_unset",
      targetKind: "person",
      targetId: personId,
      metadata: {},
    });
    return apiRoutes.roleAssignmentSet.response.parse({ ok: true });
  }

  // Validate against the reference table so an unknown slug is a 400, not a
  // role-FK 500.
  const known = await scope.roles.list();
  if (!known.some((r) => r.slug === roleSlug)) {
    throw new ApiError(400, "unknown role");
  }

  await scope.roles.assign({ personId, roleSlug, assignedByUserId: actorUserId });
  await scope.auditLog.record({
    actorUserId,
    action: "person.role_set",
    targetKind: "person",
    targetId: personId,
    metadata: { roleSlug },
  });
  return apiRoutes.roleAssignmentSet.response.parse({ ok: true });
}

/**
 * Team → manager assignment (D-TCI-3, ADR 0044). Admin-set org config: an admin
 * makes an org member a manager of a team, or removes that grant. `teamId` must
 * be a team in this org (404 otherwise — the composite tenant FK is the
 * backstop) and `userId` must be a member of this workspace (400 otherwise — a
 * manager is an org member by definition; the user FK alone would accept any
 * account). Write-then-audit like every sibling admin mutation. Pure over the
 * org-scoped repository (+ the org-members read), so it's tested on PGlite; the
 * route is thin HTTP glue. Assigning a manager confers NO per-person data
 * visibility (D-TCI-1) — it only records who manages the team.
 */
export async function setTeamManager(
  args: { db: Db; scope: OrgScope },
  input: {
    teamId: string;
    userId: string;
    action: "add" | "remove";
    actorUserId: string;
  },
) {
  const { db, scope } = args;
  const { teamId, userId, action, actorUserId } = input;

  // The team must belong to this org — a clean 404 rather than a composite-FK
  // 500 on assign (and a meaningful error on remove).
  const teams = await scope.teams.list();
  if (!teams.some((t) => t.id === teamId)) {
    throw new ApiError(404, "team not found");
  }

  // A manager must be a member of this workspace. Validated against the roster
  // so a non-member id is a clean 400, not a silent grant to an outside account.
  const members = await orgMembersList(db, scope.orgId);
  if (!members.some((m) => m.userId === userId)) {
    throw new ApiError(400, "not a workspace member");
  }

  if (action === "remove") {
    await scope.teamManagers.remove(teamId, userId);
    await scope.auditLog.record({
      actorUserId,
      action: "team.manager_remove",
      targetKind: "team",
      targetId: teamId,
      metadata: { userId },
    });
    return { ok: true };
  }

  await scope.teamManagers.assign(teamId, userId);
  await scope.auditLog.record({
    actorUserId,
    action: "team.manager_add",
    targetKind: "team",
    targetId: teamId,
    metadata: { userId },
  });
  return { ok: true };
}

/**
 * Per-team settings update (ADR 0045 spend half, D-TCI-2). Admin-set org config:
 * toggle `managersSeeIndividualCost` for a team — the gate that lets that team's
 * managers see a managed member's per-person spend by name (default OFF). Mirrors
 * `setTeamManager` exactly: the team must belong to this org (404 otherwise — the
 * composite tenant FK is the backstop), and it writes-then-audits with a
 * `team.settings_update` row naming ONLY the changed field + its new value (never
 * a person's data). Pure over the org-scoped repository, so it's tested on PGlite;
 * the route is thin HTTP glue.
 */
export async function setTeamSettings(
  args: { scope: OrgScope },
  input: {
    teamId: string;
    managersSeeIndividualCost: boolean;
    actorUserId: string;
  },
) {
  const { scope } = args;
  const { teamId, managersSeeIndividualCost, actorUserId } = input;

  const teams = await scope.teams.list();
  if (!teams.some((t) => t.id === teamId)) {
    throw new ApiError(404, "team not found");
  }

  const settings = await scope.teamSettings.set(teamId, {
    managersSeeIndividualCost,
  });
  await scope.auditLog.record({
    actorUserId,
    action: "team.settings_update",
    targetKind: "team",
    targetId: teamId,
    metadata: { managersSeeIndividualCost },
  });
  return { managersSeeIndividualCost: settings.managersSeeIndividualCost };
}

/**
 * Write a manager coaching note about a managed-team member (D-TCI-7, ADR 0053).
 * AUTHORIZATION mirrors the manager drill-in surface: the surface is UNAVAILABLE
 * in `private` visibility mode, and the caller must be a MANAGER (≥1 team_managers
 * grant) of a team the person belongs to — the org-scope `managerNotes.create`
 * membership-JOIN is the person-∈-managed-team gate, and it stamps the caller as
 * author. Every non-authorized outcome collapses to 404 "not found" (never
 * confirms the person exists). NO audit row: a note is coaching content, not org
 * config — it is not a security-relevant configuration change (contrast
 * setTeamManager/setTeamSettings, which DO audit); the note itself, with its
 * author byline + timestamp, is the record. The route blocks impersonated writes
 * (403) before reaching here.
 */
export async function createManagerNote(
  args: { scope: OrgScope },
  input: {
    callerUserId: string;
    personId: string;
    visibilityMode: VisibilityMode;
    body: string;
    followUpOn: string | null;
  },
) {
  const { scope } = args;
  if (!managerSurfaceAvailable(input.visibilityMode)) {
    throw new ApiError(404, "not found");
  }
  const managedTeamIds = await scope.teamManagers.managedTeamIds(
    input.callerUserId,
  );
  if (managedTeamIds.length === 0) {
    throw new ApiError(404, "not found");
  }
  // Player-manager self-exclusion (ADR 0053): a manager must not author notes
  // about THEMSELVES either — self-notes would re-open the self-read the read
  // path just closed (the author byline is theirs) and muddy the surface's
  // "observations about a managed person" meaning. Same 404 collapse.
  if (await callerIsNoteSubject(scope, input.callerUserId, input.personId)) {
    throw new ApiError(404, "not found");
  }
  const note = await scope.managerNotes.create(
    input.personId,
    managedTeamIds,
    input.callerUserId,
    input.body,
    input.followUpOn,
  );
  if (note === null) {
    throw new ApiError(404, "not found");
  }
  return note;
}

/**
 * Delete a manager coaching note — AUTHOR-ONLY (D-TCI-7, ADR 0053). Co-managers of
 * the person's team can READ every note (author-attributed), but only the note's
 * AUTHOR may delete it: `managerNotes.deleteByAuthor` scopes the delete by
 * (org, id, authorUserId), so another manager's delete matches no row → 404. The
 * same surface gates as the write (private mode unavailable; caller must manage a
 * team) apply first, so a non-manager never reaches the delete. A missing row —
 * wrong author, wrong org, or already gone — is 404 "not found". No audit row
 * (append-only coaching content; see createManagerNote). The route blocks
 * impersonated writes (403) before reaching here.
 */
export async function deleteManagerNote(
  args: { scope: OrgScope },
  input: {
    callerUserId: string;
    visibilityMode: VisibilityMode;
    noteId: string;
  },
) {
  const { scope } = args;
  if (!managerSurfaceAvailable(input.visibilityMode)) {
    throw new ApiError(404, "not found");
  }
  const managedTeamIds = await scope.teamManagers.managedTeamIds(
    input.callerUserId,
  );
  if (managedTeamIds.length === 0) {
    throw new ApiError(404, "not found");
  }
  const deleted = await scope.managerNotes.deleteByAuthor(
    input.noteId,
    input.callerUserId,
  );
  if (!deleted) {
    throw new ApiError(404, "not found");
  }
  return { ok: true };
}

/**
 * POST /api/team-insights/:id/dismiss (TCI Phase 2-F, ADR 0050): dismiss ONE
 * aggregate manager insight. AUTHORIZATION: an org ADMIN or a team MANAGER (≥1
 * team_managers grant) may dismiss; a plain member 403s. The insight feed is
 * org-level (team_id null today), so any manager/admin of the org may act on
 * it. Idempotent-ish: a missing/already-dismissed id is a 404 (never a silent
 * success — the caller should know the row wasn't there). Writes an audit row.
 */
/**
 * The current MEASURED team-level value for a score slug — the goal baseline
 * source (TMD P1b). Resolved by the EXACT selection the team dashboard uses, so
 * a freshly-set goal's baseline equals the "now" the KPI cards + goal card show
 * at set time: the same window bound (`periodEnd <= today`, which drops the
 * future-dated `month` period row so the trailing-28-day row wins — the two
 * grains are different computations) and the same `latestTeamScoresBySlug`
 * tie-break (newest period, then newest definition version). Rounded to the
 * integer the `team_goals.baseline` column stores, or `null` when the metric is
 * unmeasured — NEVER a fabricated 0 (invariant b — "no data yet" ≠ measured
 * zero). A low-frequency setter path, not the hot dashboard read.
 */
async function measuredTeamValueBySlug(
  scope: OrgScope,
  metricSlug: TeamGoalMetric,
): Promise<number | null> {
  const today = todayUtc();
  const [rows, defs] = await Promise.all([
    scope.scores.results({ subjectLevel: "team", to: today }),
    scope.scores.definitions(),
  ]);
  const defById = new Map(defs.map((d) => [d.id, d]));
  // Enrich the raw score rows with the (slug, version) their definition carries
  // so `latestTeamScoresBySlug` — the SAME resolver the dashboard uses — can
  // pick the current value. A row whose definition is missing is dropped.
  const enriched = rows.flatMap((r) => {
    const def = defById.get(r.definitionId);
    return def
      ? [
          {
            subjectLevel: r.subjectLevel,
            definitionSlug: def.slug,
            definitionVersion: def.version,
            periodEnd: r.periodEnd,
            value: r.value,
          },
        ]
      : [];
  });
  const value = latestTeamScoresBySlug(enriched).get(metricSlug)?.value ?? null;
  return value === null ? null : Math.round(value);
}

/**
 * Set the active ORG-WIDE team goal (TMD P1b, ADR 0061). Manager-OR-admin only
 * (mirrors `dismissTeamInsight`). The baseline is computed SERVER-SIDE from the
 * current measured value — the client never supplies it, so a goal can't be
 * anchored to a fabricated starting number (invariant b). `ownerUserId` is the
 * caller's own auth id, never a body field. A concurrent double-submit that
 * loses the race on the partial unique index (23505) returns the goal that won,
 * not a 500 (the ADR 0061 concurrency contract).
 */
export async function setTeamGoal(
  args: {
    scope: OrgScope;
    role: "admin" | "member";
    actorUserId: string;
  },
  input: { metricSlug: TeamGoalMetric; target: number; reviewDate: string },
) {
  const { scope, role, actorUserId } = args;

  const isManager =
    role === "admin" ||
    (await scope.teamManagers.managedTeamIds(actorUserId)).length > 0;
  if (!isManager) {
    throw new ApiError(403, "only a manager or admin can set a team goal");
  }

  const baseline = await measuredTeamValueBySlug(scope, input.metricSlug);

  try {
    return await scope.goals.setActive({
      // Org-wide goal (team_id null) — the common case today. Team-scoped goals
      // arrive with the subgroup breakdown (a later, no-schema-change slice).
      teamId: null,
      metricSlug: input.metricSlug,
      baseline,
      target: input.target,
      reviewDate: input.reviewDate,
      ownerUserId: actorUserId,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await scope.goals.getActive(null);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function dismissTeamInsight(
  args: {
    scope: OrgScope;
    role: "admin" | "member";
    actorUserId: string;
  },
  id: string,
) {
  const { scope, role, actorUserId } = args;

  // Manager-OR-admin gate. Admin short-circuits (no extra read); otherwise the
  // caller must hold ≥1 team-manager grant in this org.
  const isManager =
    role === "admin" ||
    (await scope.teamManagers.managedTeamIds(actorUserId)).length > 0;
  if (!isManager) {
    throw new ApiError(403, "only a manager or admin can dismiss insights");
  }

  const dismissed = await scope.teamInsights.dismiss(id);
  if (!dismissed) {
    throw new ApiError(404, "insight not found");
  }
  await scope.auditLog.record({
    actorUserId,
    action: "team_insight.dismiss",
    targetKind: "team_insight",
    targetId: id,
    // Count-only metadata — category/subject/severity, never a person id (the
    // insight itself carries none).
    metadata: {
      category: dismissed.category,
      subject: dismissed.subject,
      severity: dismissed.severity,
    },
  });
  return { ok: true };
}

/**
 * GET /api/budget core (W4-V, ADR 0020): the org's budget config + observed
 * month-to-date spend (billed and derived kept separate) + the computed alert.
 * `today` (YYYY-MM-DD, UTC) is caller-supplied so the window is deterministic.
 * Never a stored ledger — spend is summed from metric_records at read time.
 */
export async function getBudget(scope: OrgScope, today: string) {
  // Shared month-to-date core (src/lib/spend-governance.ts) — vendor-reported
  // and derived spend summed separately; the alert is measured against
  // vendor-reported only (derived can overlap it — invariant b, no double-count).
  const { budget, reportedCents, estimatedCents } = await readMonthToDateSpend(
    scope,
    today,
  );
  const alert = budgetAlertFor(budget, reportedCents);
  return apiRoutes.budgetGet.response.parse({
    budget: budget
      ? {
          monthlyLimitCents: budget.monthlyLimitCents,
          alertThresholds: budget.alertThresholds,
        }
      : null,
    monthToDate: { reportedCents, estimatedCents },
    alert,
  });
}

/** Product ceiling for a monthly budget. The frozen `budgetSet` request schema
 * (src/contracts/api.ts) only bounds `monthlyLimitCents` as a positive int, but
 * the column is int4 (`budgets.monthly_limit_cents`), so a value above 2^31-1
 * passes zod then throws "integer out of range" at INSERT → an ungraceful 500.
 * Reject above a sane product max here — a $20,000,000.00/mo ceiling, well
 * under int4 — so the handler returns a clean 400. (Enforced at the handler,
 * not the frozen contract, to avoid an ADR-gated contract change.) */
export const MAX_BUDGET_CENTS = 2_000_000_000;

/**
 * PUT /api/budget core (W4-V, ADR 0020): create or replace the org's budget.
 * Admin-gated at the route. Thresholds default to [50, 80, 100] when omitted.
 */
export async function setBudget(
  scope: OrgScope,
  input: { monthlyLimitCents: number; alertThresholds?: number[] },
) {
  if (input.monthlyLimitCents > MAX_BUDGET_CENTS) {
    throw new ApiError(
      400,
      `monthlyLimitCents exceeds the maximum of ${MAX_BUDGET_CENTS}`,
    );
  }
  const row = await scope.budgets.set(input);
  return apiRoutes.budgetSet.response.parse({
    budget: {
      monthlyLimitCents: row.monthlyLimitCents,
      alertThresholds: row.alertThresholds,
    },
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
 * later re-PUT overwrites. Vendors with no shipped connector (the local
 * agent's device_token) skip validation. Copilot credentials are normally
 * established by the GitHub App install callback, not this route; a manual
 * PUT of a `github_app_private_key` blob still validates via the connector.
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
 * Completes a GitHub App install for the Copilot connector (W4-T): creates
 * the connection (authKind github_app; org login + app/installation ids in
 * non-secret config) and stores the App auth material as the
 * `github_app_private_key` credential — a JSON blob { appId, installationId,
 * privateKeyPem } the connector reads via ctx.credential. The private key is
 * SOURCED from the GH_COPILOT_APP_PRIVATE_KEY Worker secret by the callback
 * route (one app) and passed in here; it is stored envelope-encrypted,
 * AAD-bound to (org, connection, kind), never in config.
 *
 * Returns the created connection. Idempotency across a re-install is handled
 * by the caller (it reuses an existing github_copilot connection for the same
 * installation id rather than minting a duplicate).
 */
export async function completeGithubCopilotInstall(
  scope: OrgScope,
  env: CredentialEnv,
  input: {
    orgLogin: string;
    installationId: string;
    appId: string;
    privateKeyPem: string;
    scopeKind?: "org" | "enterprise";
    /** The org member who completed the install — audited like the sibling
     * create/store-credential paths (ADR 0010). */
    actorUserId?: string;
  },
) {
  const mode = input.scopeKind === "enterprise" ? "enterprise" : "org";
  const connection = await scope.connections.create({
    vendor: "github_copilot",
    displayName: `GitHub Copilot (${input.orgLogin})`,
    authKind: "github_app",
    config:
      mode === "enterprise"
        ? { mode, enterprise: input.orgLogin, appId: input.appId, installationId: input.installationId }
        : { mode, org: input.orgLogin, appId: input.appId, installationId: input.installationId },
  });
  await scope.connections.storeCredential(
    connection.id,
    "github_app_private_key",
    JSON.stringify({
      appId: input.appId,
      installationId: input.installationId,
      privateKeyPem: input.privateKeyPem,
    }),
    env,
  );
  // Same audit trail the POST /api/connections + credential-PUT routes write
  // (ADR 0010) — the App-install path must not be an audit blind spot. Kind
  // only, never the key material.
  if (input.actorUserId) {
    await scope.auditLog.record({
      actorUserId: input.actorUserId,
      action: "connection.create",
      targetKind: "connection",
      targetId: connection.id,
      metadata: { vendor: "github_copilot", via: "github_app_install" },
    });
    await scope.auditLog.record({
      actorUserId: input.actorUserId,
      action: "connection.store_credential",
      targetKind: "connection",
      targetId: connection.id,
      metadata: { kind: "github_app_private_key" },
    });
  }
  return connection;
}

/** Reason a Copilot install callback refused to bind, mapped 1:1 to the
 * `?copilot_error=` values the connections page renders. `ownership` covers
 * EVERY failure of the confused-deputy check (no code, bad code exchange, not
 * an org admin, or a transient error verifying) on purpose: they are
 * indistinguishable to the honest user, and a uniform message avoids leaking
 * whether a given installation exists. The precise cause is recorded in the
 * `connection.install_rejected` audit metadata, not the redirect. */
export type GithubCopilotInstallRejection =
  | "ownership"
  | "install_lookup"
  | "create_failed";

export type GithubCopilotInstallResult =
  | { ok: true; reused?: boolean }
  | { ok: false; reason: GithubCopilotInstallRejection };

/** Records a security-relevant refusal to bind an installation. Best-effort:
 * an audit-write failure must never turn a REJECTION into a bound connection
 * or a 500 — the rejection stands regardless. */
async function auditInstallRejected(
  scope: OrgScope,
  actorUserId: string | undefined,
  installationId: string,
  reason: string,
): Promise<void> {
  try {
    await scope.auditLog.record({
      actorUserId: actorUserId ?? null,
      action: "connection.install_rejected",
      targetKind: "connection",
      targetId: null,
      // installationId is a non-secret enumerable id — safe (and useful) to
      // log: it names which installation a caller tried to bind.
      metadata: { vendor: "github_copilot", installationId, reason },
    });
  } catch {
    // swallow — see doc comment.
  }
}

/** True iff `connectionId` has a usable `github_app_private_key` credential.
 * `withCredential` throws on a missing / expired / undecryptable row, so a
 * throw here means "no usable credential" → treat as an orphan to re-bind.
 * Distinguishes a healthy re-install (reuse) from a credential-less orphan
 * left by a prior create-then-store crash (create + storeCredential are not
 * one transaction). */
async function hasUsableAppCredential(
  scope: OrgScope,
  connectionId: string,
  env: CredentialEnv,
): Promise<boolean> {
  try {
    return await scope.connections.withCredential(
      connectionId,
      "github_app_private_key",
      env,
      async () => true,
    );
  } catch {
    return false;
  }
}

/**
 * Completes a Copilot GitHub-App install callback AFTER the route has verified
 * the org-bound CSRF state — the security-critical core, kept here (not in the
 * thin route) so it is unit-testable against PGlite.
 *
 * The confused-deputy fix: `installation_id` is an attacker-controllable,
 * enumerable URL param, and getInstallationAccount authenticates as Revealyst's
 * OWN App (it succeeds for ANY installation). So before binding, we PROVE the
 * connecting user controls the installation:
 *   1. exchange the install-time OAuth `code` for a user-to-server token;
 *   2. resolve which account the installation is on (App-authenticated);
 *   3. require the user to be an ACTIVE ADMIN of that org
 *      (`GET /user/memberships/orgs/{org}`). Admin — not mere access — is the
 *      bar: `/user/installations` lists installs an ordinary org member can
 *      reach, so it alone would still let a non-admin bind the whole org's
 *      data. (Non-org installs fall back to installation accessibility.)
 * Every failure of that proof is an audited refusal to bind.
 *
 * Idempotency runs FIRST: a healthy existing connection for this installation
 * is reused (a reconfigure re-install can legitimately arrive WITHOUT a fresh
 * code); that connection was bound with ownership already verified, so reuse is
 * safe. Only a first bind — or a credential-less orphan — runs the full proof.
 */
export async function connectGithubCopilotInstall(
  scope: OrgScope,
  env: CredentialEnv,
  app: {
    appId: string;
    privateKeyPem: string;
    clientId: string;
    clientSecret: string;
  },
  params: { installationId: string; code: string | null; actorUserId?: string },
  opts: { now?: Date; fetchFn?: FetchFn } = {},
): Promise<GithubCopilotInstallResult> {
  const now = opts.now ?? new Date();
  const fetchFn = opts.fetchFn ?? fetch;
  const { installationId, code, actorUserId } = params;

  // ── 1. Idempotency / orphan detection (before requiring a fresh code) ──────
  // A healthy connection for this installation → reuse it (ownership was proven
  // when it was first bound; a reconfigure re-install may carry no fresh code).
  // A credential-less orphan (create succeeded, storeCredential crashed) is NOT
  // reusable — it can't poll — so we fall through and re-run the full bind,
  // replacing it.
  let orphanToReplace: string | undefined;
  try {
    const existing = (await scope.connections.list()).find(
      (c) =>
        c.vendor === "github_copilot" &&
        (c.config as { installationId?: string }).installationId ===
          installationId,
    );
    if (existing) {
      if (await hasUsableAppCredential(scope, existing.id, env)) {
        return { ok: true, reused: true };
      }
      orphanToReplace = existing.id;
    }
  } catch {
    return { ok: false, reason: "create_failed" };
  }

  // ── 2. Prove the caller controls this installation (confused-deputy gate) ──
  if (!code) {
    // "Request user authorization during installation" is off, or the callback
    // was hand-crafted without a code — either way we cannot prove ownership.
    await auditInstallRejected(scope, actorUserId, installationId, "no_oauth_code");
    return { ok: false, reason: "ownership" };
  }
  let userToken: string;
  try {
    userToken = await exchangeInstallationCode(
      { clientId: app.clientId, clientSecret: app.clientSecret, code },
      fetchFn,
    );
  } catch {
    await auditInstallRejected(
      scope,
      actorUserId,
      installationId,
      "oauth_exchange_failed",
    );
    return { ok: false, reason: "ownership" };
  }

  // Resolve which org/enterprise this installation is on. App-authenticated, so
  // it works for any id — but the RESOLVED login (never the caller's input) is
  // what we then check admin membership against, so an attacker probing a
  // victim id only gets their own admin check to fail.
  let account: { login: string; type: string };
  try {
    account = await getInstallationAccount(
      { appId: app.appId, installationId, privateKeyPem: app.privateKeyPem },
      now,
      fetchFn,
    );
  } catch {
    return { ok: false, reason: "install_lookup" };
  }

  // Ownership proof, keyed on the account type:
  //  • Organization → active ADMIN membership of the resolved org (the fix).
  //  • otherwise (personal / founder-gated enterprise) → the user can access
  //    this specific installation (owner-only for a personal account).
  let controls: boolean;
  try {
    controls =
      account.type === "Organization"
        ? await userIsOrgAdmin(userToken, account.login, fetchFn)
        : await userControlsInstallation(userToken, installationId, fetchFn);
  } catch {
    // Fail closed: a transient GitHub error must never be read as "controls it".
    await auditInstallRejected(
      scope,
      actorUserId,
      installationId,
      "ownership_check_failed",
    );
    return { ok: false, reason: "ownership" };
  }
  if (!controls) {
    await auditInstallRejected(
      scope,
      actorUserId,
      installationId,
      account.type === "Organization" ? "not_org_admin" : "not_installation_owner",
    );
    return { ok: false, reason: "ownership" };
  }

  // ── 3. Ownership proven — bind (replacing a credential-less orphan). ───────
  try {
    if (orphanToReplace) {
      // Remove the un-pollable orphan before re-creating, so we don't mint a
      // duplicate connection for the same installation. The orphan never
      // polled, so it has no metric_records to reconcile.
      await scope.connections.delete(orphanToReplace);
    }
    await completeGithubCopilotInstall(scope, env, {
      orgLogin: account.login,
      installationId,
      appId: app.appId,
      privateKeyPem: app.privateKeyPem,
      // Enterprise detection is NLV-unverified (facts §1); V1.5 targets
      // Copilot Business (org), so a non-"Enterprise" account.type falls back
      // to org — the safe default until the first Enterprise customer.
      scopeKind: account.type === "Enterprise" ? "enterprise" : "org",
      actorUserId,
    });
  } catch {
    return { ok: false, reason: "create_failed" };
  }
  return { ok: true };
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
    // On-demand polls exist to show fresh numbers — chain a recompute after
    // the ingest lands so scores don't stay stale until the nightly cron.
    recompute: true,
  });
  return apiRoutes.connectionsPoll.response.parse({ ok: true });
}
