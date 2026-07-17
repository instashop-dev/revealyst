import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  type AdminEnv,
  isPlatformAdmin,
  parseAdminUserIds,
} from "../lib/admin-access";
import { trailing30dPeriod } from "../lib/entitlements";
import type { Db } from "./client";
import { forOrg } from "./org-scope";
import {
  provisionTeamWorkspace,
  type ProvisionTeamWorkspaceResult,
} from "./org-provisioning";
import {
  auditLog,
  connections,
  connectorRuns,
  orgMembers,
  orgs,
  subscriptions,
  user,
} from "./schema";
import { subscriptionsForOrg } from "./subscriptions";

// Platform-admin cross-org reads (ADR 0016, Feature 3). Mirrors
// src/db/system.ts: the only sanctioned home for raw schema access outside
// forOrg (scripts/check-org-scope.mjs allows schema imports only under
// src/db/**). Reads here are deliberately cross-org — the admin dashboard's
// whole point is a platform-wide view no org-scoped query could produce.
// Callers gate via requireAdminContext/handleAdminApi (src/lib/admin-context.ts);
// this module does no authorization itself.
//
// The one WRITE in this module is `createTeamWorkspace` — a cross-org org
// bootstrap (a platform admin provisioning a NEW team workspace) that has no
// single org scope to run inside. It is the deliberate exception to the
// "reads only" rule, and like every reader here it trusts its caller to have
// passed the handleAdminApi gate.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;

export type OrgKind = "personal" | "team";

export type RecentSignup = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

export type ConnectorFailure = {
  id: string;
  orgId: string;
  orgName: string;
  connectionId: string;
  vendor: string;
  displayName: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type PlatformStats = {
  totalUsers: number;
  /** Org counts by kind, excluding the internal "system" org (audit-log
   * home, ensureSystemOrg) — it is infrastructure, not a customer. */
  orgCountsByKind: Record<OrgKind, number>;
  signupsLast30Days: number;
  /** Newest-first, for the dashboard's "recent signups" table. */
  recentSignups: RecentSignup[];
  /** Connection status → count, e.g. { active: 12, error: 2, pending: 1 }. */
  connectionsByStatus: Record<string, number>;
  /** Newest-first connector_runs rows with status="error", capped at
   * RECENT_LIMIT — a fleet-health signal, not an exhaustive error log. */
  recentConnectorFailures: ConnectorFailure[];
  /** Subscription status → count (active/trialing/past_due/paused/canceled). */
  subscriptionsByStatus: Record<string, number>;
};

/** Reduces a `{status, count}[]` group-by result into a lookup record —
 * shared by connectionsByStatus and subscriptionsByStatus below. */
function toStatusRecord(
  rows: readonly { status: string; count: number }[],
): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/** Platform-wide aggregate stats for the /admin dashboard (Feature 3). */
export async function platformStats(db: Db): Promise<PlatformStats> {
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  const [
    [totalUserRow],
    [last30dRow],
    orgKindRows,
    recentSignups,
    connectionStatusRows,
    connectorFailureRows,
    subscriptionStatusRows,
  ] = await Promise.all([
    // Two typed counts rather than one `count(*) filter (where …)` pass: a
    // raw JS Date interpolated into a `sql` fragment bypasses the column's
    // timestamptz driver-encoder, which postgres.js/Hyperdrive rejects at
    // runtime (PGlite tolerated it in tests). `gte(user.createdAt, …)` routes
    // the Date through the column encoder — the same typed form platformAuditList
    // uses for its cursor. The extra count over `user` is trivially cheap.
    db.select({ count: sql<number>`count(*)::int` }).from(user),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(gte(user.createdAt, thirtyDaysAgo)),
    db
      .select({ kind: orgs.kind, count: sql<number>`count(*)::int` })
      .from(orgs)
      .where(ne(orgs.kind, "system"))
      .groupBy(orgs.kind),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      })
      .from(user)
      // id tiebreak: createdAt alone is not unique, and without a stable
      // secondary sort key a tie at the LIMIT boundary can return a
      // different top-10 (or a different order) across requests.
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(RECENT_LIMIT),
    db
      .select({ status: connections.status, count: sql<number>`count(*)::int` })
      .from(connections)
      .groupBy(connections.status),
    // Platform-wide scan of connector_runs with no org_id predicate — the
    // existing (org_id, connection_id, started_at) index doesn't help this
    // query. Acceptable at current volume (same trade-off src/db/system.ts
    // documents for latestHeartbeatAt); a follow-up adds a partial index on
    // (status, started_at) if this becomes a hot path.
    db
      .select({
        id: connectorRuns.id,
        orgId: connectorRuns.orgId,
        orgName: orgs.name,
        connectionId: connectorRuns.connectionId,
        vendor: connections.vendor,
        displayName: connections.displayName,
        error: connectorRuns.error,
        startedAt: connectorRuns.startedAt,
        finishedAt: connectorRuns.finishedAt,
      })
      .from(connectorRuns)
      .innerJoin(
        connections,
        and(
          eq(connectorRuns.orgId, connections.orgId),
          eq(connectorRuns.connectionId, connections.id),
        ),
      )
      .innerJoin(orgs, eq(connectorRuns.orgId, orgs.id))
      .where(eq(connectorRuns.status, "error"))
      .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.id))
      .limit(RECENT_LIMIT),
    db
      .select({
        status: subscriptions.status,
        count: sql<number>`count(*)::int`,
      })
      .from(subscriptions)
      .groupBy(subscriptions.status),
  ]);

  const orgCountsByKind: Record<OrgKind, number> = { personal: 0, team: 0 };
  for (const row of orgKindRows) {
    if (row.kind === "personal" || row.kind === "team") {
      orgCountsByKind[row.kind] = row.count;
    }
  }

  return {
    totalUsers: totalUserRow?.count ?? 0,
    orgCountsByKind,
    signupsLast30Days: last30dRow?.count ?? 0,
    recentSignups,
    connectionsByStatus: toStatusRecord(connectionStatusRows),
    recentConnectorFailures: connectorFailureRows,
    subscriptionsByStatus: toStatusRecord(subscriptionStatusRows),
  };
}

// ── Feature 4/5/7: user list, user detail, platform audit viewer (ADR 0016) ──

const USER_LIST_SORT_COLUMNS = {
  createdAt: user.createdAt,
  name: user.name,
  email: user.email,
} as const;

export type AdminUserListSort = keyof typeof USER_LIST_SORT_COLUMNS;

export type AdminUserListParams = {
  /** ILIKE over user.email + user.name. */
  search?: string;
  /** Allowlisted column; default "createdAt". */
  sort?: AdminUserListSort;
  sortDir?: "asc" | "desc";
  filter?: {
    banned?: boolean;
    platformAdmin?: boolean;
    plan?: string;
    orgKind?: "personal" | "team";
  };
  /** Clamped to <= 100; default 25. */
  limit?: number;
  /** Default 0. */
  offset?: number;
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  banned: boolean;
  /** Derived via isPlatformAdmin — both power sources (role column +
   * ADMIN_USER_IDS, ADR 0016), matching the server guards in
   * src/lib/auth.ts hooks. */
  platformAdmin: boolean;
  orgId: string | null;
  orgName: string | null;
  orgKind: "personal" | "team" | null;
  /** Membership role in that org. */
  orgRole: "admin" | "member" | null;
  /** Derived subscription status ("active"/"trialing"/"past_due"), or
   * "free" (no entitling subscription) / "none" (no org membership). */
  plan: string;
};

/** The expression a user's row is shown/filtered by: derived from their
 * most-recent non-system org membership's entitlement, mirroring
 * resolveEntitlement (src/db/subscriptions.ts) — the newest-Paddle-event
 * entitling row wins, tie-broken on subscription id. NULL when the org has
 * no entitling row ("free"); the app-side default fills that in, and
 * "none" (no org at all) is filled in the same way. Kept as a raw SQL
 * fragment (not a CTE alias) so it can be reused verbatim in WHERE — a
 * SELECT-list alias is not visible there. */
function orgPlanStatusSql() {
  return sql<string | null>`(
    select sub.status
    from ${subscriptions} sub
    where sub.org_id = ${orgMembers.orgId}
      and sub.status in ('active', 'trialing', 'past_due')
    order by sub.paddle_occurred_at desc, sub.paddle_subscription_id desc
    limit 1
  )`;
}

/** Builds the shared FROM/JOIN/WHERE for listUsersForAdmin's count + page
 * queries: user LEFT JOIN its most-recent non-system-org membership
 * (window function, ADR 0004 "most recent membership wins" rule — same as
 * orgContextForUser) LEFT JOIN that org. Kept as one function so the two
 * queries can never drift out of sync on filters. */
function buildUserListQuery(
  db: Db,
  params: AdminUserListParams,
  env: AdminEnv,
) {
  const latestMembership = db.$with("admin_latest_membership").as(
    db
      .select({
        userId: orgMembers.userId,
        orgId: orgMembers.orgId,
        role: orgMembers.role,
        orgName: orgs.name,
        orgKind: orgs.kind,
        plan: orgPlanStatusSql().as("plan"),
        rn: sql<number>`row_number() over (partition by ${orgMembers.userId} order by ${orgMembers.createdAt} desc)`.as(
          "rn",
        ),
      })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
      .where(ne(orgs.kind, "system")),
  );

  const conditions = [];
  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(or(ilike(user.email, term), ilike(user.name, term)));
  }
  if (params.filter?.banned !== undefined) {
    conditions.push(
      params.filter.banned
        ? eq(user.banned, true)
        : or(isNull(user.banned), eq(user.banned, false)),
    );
  }
  if (params.filter?.platformAdmin !== undefined) {
    // Both power sources — see isPlatformAdmin (ADR 0016). A role-only
    // filter reads as empty when all admins are env-bootstrapped (role
    // NULL). Empty bootstrap list is safe: drizzle renders inArray(col, [])
    // as `false` and notInArray(col, []) as `true`.
    const bootstrapIds = parseAdminUserIds(env);
    conditions.push(
      params.filter.platformAdmin
        ? or(eq(user.role, "admin"), inArray(user.id, bootstrapIds))
        : and(
            or(isNull(user.role), ne(user.role, "admin")),
            notInArray(user.id, bootstrapIds),
          ),
    );
  }
  if (params.filter?.orgKind) {
    conditions.push(eq(latestMembership.orgKind, params.filter.orgKind));
  }
  if (params.filter?.plan) {
    const wanted = params.filter.plan;
    conditions.push(
      wanted === "none"
        ? isNull(latestMembership.orgId)
        : wanted === "free"
          ? and(isNotNull(latestMembership.orgId), isNull(latestMembership.plan))
          : eq(latestMembership.plan, wanted),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return { latestMembership, where };
}

/**
 * Cross-org user list for the platform-admin dashboard (Feature 4). Join is
 * user → most-recent org_members (excluding the system org) → orgs; plan is
 * derived from subscriptions. `sort`/`filter` keys are validated against
 * server-side allowlists — never interpolate a raw column name from params.
 * Offset pagination (admin table, not an infinite-scroll feed). `env` is
 * required (not defaulted) so no call site can silently fall back to
 * role-only platform-admin classification — ADMIN_USER_IDS bootstrap
 * admins must classify identically to the server guards.
 */
export async function listUsersForAdmin(
  db: Db,
  params: AdminUserListParams,
  env: AdminEnv,
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const sortCol = USER_LIST_SORT_COLUMNS[params.sort ?? "createdAt"];
  const dir = params.sortDir === "asc" ? asc : desc;

  const { latestMembership, where } = buildUserListQuery(db, params, env);
  const [countRows, rows] = await Promise.all([
    db
      .with(latestMembership)
      .select({ total: sql<number>`count(*)::int` })
      .from(user)
      .leftJoin(
        latestMembership,
        and(eq(latestMembership.userId, user.id), eq(latestMembership.rn, 1)),
      )
      .where(where),
    db
      .with(latestMembership)
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        banned: user.banned,
        role: user.role,
        orgId: latestMembership.orgId,
        orgName: latestMembership.orgName,
        orgKind: latestMembership.orgKind,
        orgRole: latestMembership.role,
        plan: latestMembership.plan,
      })
      .from(user)
      .leftJoin(
        latestMembership,
        and(eq(latestMembership.userId, user.id), eq(latestMembership.rn, 1)),
      )
      .where(where)
      .orderBy(dir(sortCol), dir(user.id))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    total: countRows[0]?.total ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      createdAt: r.createdAt,
      banned: r.banned ?? false,
      platformAdmin: isPlatformAdmin({ id: r.id, role: r.role }, env),
      orgId: r.orgId,
      orgName: r.orgName,
      orgKind: (r.orgKind as "personal" | "team" | null) ?? null,
      orgRole: (r.orgRole as "admin" | "member" | null) ?? null,
      plan: r.orgId === null ? "none" : (r.plan ?? "free"),
    })),
  };
}

export type AdminUserDetail = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  platformAdmin: boolean;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  memberships: Array<{
    orgId: string;
    orgName: string;
    orgKind: "personal" | "team";
    role: "admin" | "member";
    /** Current subscription status for that org, or "free". */
    plan: string;
    /** Tracked-user count for that org, trailing 30d (billing period). */
    trackedUsers: number;
  }>;
  connections: Array<{
    id: string;
    vendor: string;
    displayName: string;
    status: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
  }>;
  /** Newest-first, actorUserId = userId, cross-org, capped at 20. */
  recentAudit: Array<{
    id: string;
    action: string;
    createdAt: Date;
    orgId: string;
    targetKind: string | null;
    targetId: string | null;
  }>;
};

const USER_DETAIL_AUDIT_LIMIT = 20;

/**
 * Cross-org user detail for the platform-admin dashboard (Feature 5). Reuses
 * the frozen entitlement (subscriptionsForOrg().current()) and tracked_user
 * (forOrg().billing.trackedUsers) helpers per membership so this can never
 * diverge from the billing paths themselves. Never selects credential
 * material — connections show status fields only. Returns null if the user
 * does not exist. `env` is required for the same reason as
 * listUsersForAdmin (see its doc).
 */
export async function userDetailForAdmin(
  db: Db,
  userId: string,
  env: AdminEnv,
): Promise<AdminUserDetail | null> {
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) {
    return null;
  }

  const memberRows = await db
    .select({
      orgId: orgs.id,
      orgName: orgs.name,
      orgKind: orgs.kind,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(and(eq(orgMembers.userId, userId), ne(orgs.kind, "system")))
    .orderBy(desc(orgMembers.createdAt));

  const period = trailing30dPeriod();
  const memberships = await Promise.all(
    memberRows.map(async (m) => {
      const [entitlement, trackedUsers] = await Promise.all([
        subscriptionsForOrg(db, m.orgId).current(),
        forOrg(db, m.orgId)
          .billing.trackedUsers(period)
          .then((r) => r.trackedPersonIds.length),
      ]);
      return {
        orgId: m.orgId,
        orgName: m.orgName,
        orgKind: m.orgKind as "personal" | "team",
        role: m.role as "admin" | "member",
        plan: entitlement.plan === "team" ? (entitlement.status ?? "team") : "free",
        trackedUsers,
      };
    }),
  );

  const orgIds = memberRows.map((m) => m.orgId);
  const connectionRows =
    orgIds.length > 0
      ? await db
          .select({
            id: connections.id,
            vendor: connections.vendor,
            displayName: connections.displayName,
            status: connections.status,
            lastSuccessAt: connections.lastSuccessAt,
            lastError: connections.lastError,
          })
          .from(connections)
          .where(inArray(connections.orgId, orgIds))
      : [];

  const recentAudit = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      orgId: auditLog.orgId,
      targetKind: auditLog.targetKind,
      targetId: auditLog.targetId,
    })
    .from(auditLog)
    .where(eq(auditLog.actorUserId, userId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(USER_DETAIL_AUDIT_LIMIT);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    platformAdmin: isPlatformAdmin(row, env),
    banned: row.banned ?? false,
    banReason: row.banReason,
    banExpires: row.banExpires,
    memberships,
    connections: connectionRows,
    recentAudit,
  };
}

export type AdminAuditParams = {
  orgId?: string;
  actorUserId?: string;
  /** Prefix match ok, e.g. "identity." matches "identity.unlink". */
  action?: string;
  /** Compound cursor — same shape as forOrg(...).auditLog.list. */
  before?: Date;
  beforeId?: string;
  /** Clamped to <= 200; default 50. */
  limit?: number;
};

export type AdminAuditRow = {
  id: string;
  orgId: string;
  orgName: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
};

/**
 * Cross-org audit viewer (Feature 7, ADR 0016) — a deliberate cross-org read
 * of audit_log, by design (platform admins investigate across every org).
 * Newest-first; joined with the acting user's email and the org name. Uses
 * the SAME exclusive (createdAt, id) compound cursor as
 * forOrg(...).auditLog.list (org-scope.ts) so pagination is stable under
 * concurrent inserts across orgs.
 */
export async function platformAuditList(
  db: Db,
  params: AdminAuditParams = {},
): Promise<AdminAuditRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  const conditions = [];
  if (params.orgId) {
    conditions.push(eq(auditLog.orgId, params.orgId));
  }
  if (params.actorUserId) {
    conditions.push(eq(auditLog.actorUserId, params.actorUserId));
  }
  if (params.action) {
    conditions.push(like(auditLog.action, `${params.action}%`));
  }
  if (params.before) {
    conditions.push(
      params.beforeId
        ? or(
            lt(auditLog.createdAt, params.before),
            and(
              eq(auditLog.createdAt, params.before),
              lt(auditLog.id, params.beforeId),
            ),
          )
        : lt(auditLog.createdAt, params.before),
    );
  }

  return db
    .select({
      id: auditLog.id,
      orgId: auditLog.orgId,
      orgName: orgs.name,
      actorUserId: auditLog.actorUserId,
      actorEmail: user.email,
      action: auditLog.action,
      targetKind: auditLog.targetKind,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .innerJoin(orgs, eq(auditLog.orgId, orgs.id))
    .leftJoin(user, eq(auditLog.actorUserId, user.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);
}

// ── Team-workspace provisioning (platform-admin unblock) ──────────────────

export type CreateTeamWorkspaceResult = ProvisionTeamWorkspaceResult;

/**
 * Create a NEW team workspace and enroll the requesting platform admin as its
 * org admin — the platform-admin seam over the shared provisioning transaction
 * (src/db/org-provisioning.ts). Kept as the admin surface's entry point (the
 * /admin dashboard button + the user-facing POST /api/workspaces route both
 * bottom out in `provisionTeamWorkspace`, so they can never diverge on org
 * shape). Callers gate via handleAdminApi; this does no authorization itself.
 * Since D-ONB-1 the user-facing flow exists too — this stays as internal
 * tooling (a platform admin can provision a workspace for someone else).
 */
export async function createTeamWorkspace(
  db: Db,
  input: { name: string; adminUserId: string },
): Promise<CreateTeamWorkspaceResult> {
  return provisionTeamWorkspace(db, {
    name: input.name,
    creatorUserId: input.adminUserId,
  });
}
