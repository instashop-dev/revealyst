import { and, desc, eq, gt, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers, session } from "./auth-schema";
import { orgs } from "./schema";

/**
 * The active-org resolution expression (ADR 0004 as amended by ADR 0051): the
 * membership the user most recently ACTIVATED wins. `last_active_at` is
 * written only by the workspace switcher; a membership that was never
 * explicitly switched to falls back to its immutable `created_at` (join
 * date), so invite-acceptance — a fresh row — still lands the user in the
 * inviting org with zero writes here. One shared expression so the two
 * resolvers and the switcher's workspace listing can never disagree.
 */
function activityRank(): SQL {
  return sql`coalesce(${orgMembers.lastActiveAt}, ${orgMembers.createdAt})`;
}

/**
 * Pre-scope org context for a signed-in user: the org row details
 * (kind, visibility mode) alongside the membership role — the exact
 * shape the frozen `/api/me` contract serves.
 *
 * Org-resolution rule (ADR 0004, amended by ADR 0051): the most recently
 * ACTIVATED membership wins — `coalesce(last_active_at, created_at)` DESC
 * with a deterministic org-id DESC tiebreak (timestamps can tie; a flapping
 * active org would reshuffle the whole app shell between requests). Invite
 * acceptance still lands the user in the inviting org on next load. The
 * frozen `membershipForUser` (org-scope.ts) keeps earliest-first — it is
 * only the bootstrap existence check inside ensureOrgOfOne.
 */
export async function orgContextForUser(db: Db, userId: string) {
  const [row] = await db
    .select({
      orgId: orgs.id,
      orgName: orgs.name,
      orgKind: orgs.kind,
      visibilityMode: orgs.visibilityMode,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(desc(activityRank()), desc(orgMembers.orgId))
    .limit(1);
  if (!row) {
    return undefined;
  }
  return {
    org: {
      id: row.orgId,
      name: row.orgName,
      kind: row.orgKind,
      visibilityMode: row.visibilityMode,
    },
    role: row.role,
  };
}

export type OrgContext = NonNullable<
  Awaited<ReturnType<typeof orgContextForUser>>
>;

/**
 * SPECULATIVE org context keyed by the raw session token (perf: collapses the
 * session→orgContext round-trip chain). `appContext` fires this CONCURRENTLY
 * with Better Auth's `getSession` using the token parsed from the cookie —
 * one Workers→Hyperdrive→Neon round-trip wave instead of two sequential ones
 * (~600ms of authenticated TTFB at the measured per-trip cost).
 *
 * This is NOT an authentication path and grants nothing on its own:
 * `getSession` remains the sole authority (ban checks, impersonation, expiry
 * refresh). The caller uses this result ONLY when `getSession` returns a
 * valid session AND `userId` here equals the verified `session.user.id`
 * (they key off the same token, so a mismatch means a race — fall back to
 * `orgContextForUser`). The expiry predicate mirrors the session's validity
 * conservatively; an expired token returns undefined AND `getSession`
 * rejects it, so nothing is ever served off this read alone.
 *
 * Same org-resolution rule as `orgContextForUser` (ADR 0004 as amended by
 * ADR 0051): most recently activated membership wins, org-id tiebreak.
 */
/**
 * All workspaces (orgs) the signed-in user belongs to — the list a workspace
 * switcher renders. Ordered by the SAME activity rank the resolvers use
 * (ADR 0051: `coalesce(last_active_at, created_at)` DESC, org-id tiebreak),
 * so the CURRENTLY-ACTIVE org is always the first row. The internal `system`
 * org (audit-log home, ensureSystemOrg) is never a real workspace, so it is
 * excluded even if a staff account is a member.
 *
 * Cross-org by nature (it enumerates a user's orgs before any single scope is
 * chosen), so it lives beside `orgContextForUser` in this pre-scope module
 * rather than behind `forOrg` — the same seam invite-acceptance and
 * `ensureOrgOfOne` write through.
 */
export async function membershipsForUser(db: Db, userId: string) {
  return db
    .select({
      orgId: orgs.id,
      orgName: orgs.name,
      orgKind: orgs.kind,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(and(eq(orgMembers.userId, userId), ne(orgs.kind, "system")))
    .orderBy(desc(activityRank()), desc(orgMembers.orgId));
}

/**
 * Switch which of the user's workspaces is active (ADR 0051, amending ADR
 * 0004): stamp the chosen membership's `last_active_at` to now, so the NEXT
 * request's `orgContextForUser` / `orgContextForSessionToken` resolves this
 * org via the `coalesce(last_active_at, created_at)` rank. `created_at` is
 * NEVER touched — it is the immutable join date rendered as "Joined" in
 * Settings → People (a rendered date is an invariant-(b) claim surface).
 *
 * Fails closed: only a membership the user actually holds is switchable (the
 * WHERE matches on both org_id AND user_id), and the `system` org is never
 * switchable. Returns false when the user is not a member of `orgId` — the
 * caller maps that to 404, so this can't be used to probe org existence.
 */
export async function switchActiveOrg(
  db: Db,
  userId: string,
  orgId: string,
): Promise<boolean> {
  // Guard the org kind separately so a (theoretical) system-org membership
  // can never be activated — the switcher must not expose infrastructure.
  const [target] = await db
    .select({ kind: orgs.kind })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);
  if (!target || target.kind === "system") {
    return false;
  }
  await db
    .update(orgMembers)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)));
  return true;
}

export async function orgContextForSessionToken(db: Db, token: string) {
  const [row] = await db
    .select({
      userId: session.userId,
      orgId: orgs.id,
      orgName: orgs.name,
      orgKind: orgs.kind,
      visibilityMode: orgs.visibilityMode,
      role: orgMembers.role,
    })
    .from(session)
    .innerJoin(orgMembers, eq(orgMembers.userId, session.userId))
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
    .orderBy(desc(activityRank()), desc(orgMembers.orgId))
    .limit(1);
  if (!row) {
    return undefined;
  }
  return {
    userId: row.userId,
    org: {
      id: row.orgId,
      name: row.orgName,
      kind: row.orgKind,
      visibilityMode: row.visibilityMode,
    },
    role: row.role,
  };
}
