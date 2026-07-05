import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers } from "./auth-schema";
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
