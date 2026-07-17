import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers, session } from "./auth-schema";
import { orgs } from "./schema";

/**
 * Pre-scope org context for a signed-in user: the org row details
 * (kind, visibility mode) alongside the membership role — the exact
 * shape the frozen `/api/me` contract serves.
 *
 * Org-resolution rule (ADR 0004): the MOST RECENT membership wins, so
 * accepting an invite lands the user in the inviting org on next load.
 * The frozen `membershipForUser` (org-scope.ts) keeps earliest-first —
 * it is only the bootstrap existence check inside ensureOrgOfOne. An
 * org switcher supersedes this rule when it ships.
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
    .orderBy(desc(orgMembers.createdAt))
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
 * Same org-resolution rule as `orgContextForUser` (ADR 0004): most recent
 * membership wins.
 */
/**
 * All workspaces (orgs) the signed-in user belongs to — the list a workspace
 * switcher renders. Newest-membership first, so the CURRENTLY-ACTIVE org (the
 * one `orgContextForUser` resolves, ADR 0004: most-recent membership wins) is
 * always the first row and can be flagged as active by the caller. The
 * internal `system` org (audit-log home, ensureSystemOrg) is never a real
 * workspace, so it is excluded even if a staff account is a member.
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
    .orderBy(desc(orgMembers.createdAt));
}

/**
 * Switch which of the user's workspaces is active. Org resolution is
 * "most-recent membership wins" (ADR 0004) — the exact rule accepting an
 * invite rides (a fresh `org_members` row lands the user in the inviting org
 * on next load). Switching reuses that rule: it bumps the chosen membership's
 * `createdAt` to now, so the NEXT request's `orgContextForUser` /
 * `orgContextForSessionToken` resolves this org. No schema change, no active-org
 * pointer — the switcher is exactly what ADR 0004 anticipated when it noted
 * "an org switcher supersedes this rule when it ships".
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
    .set({ createdAt: new Date() })
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
    .orderBy(desc(orgMembers.createdAt))
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
