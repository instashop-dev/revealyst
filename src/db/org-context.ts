import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers } from "./auth-schema";
import { orgs } from "./schema";

/**
 * Pre-scope org context for a signed-in user: the org row details
 * (kind, visibility mode) alongside the membership role — the exact
 * shape the frozen `/api/me` contract serves.
 *
 * Companion to `membershipForUser` in org-scope.ts: it runs *before* an
 * org scope exists and uses the same earliest-membership ordering, so
 * both always resolve the same org for the same user. Lives in its own
 * file because org-scope.ts is frozen (contracts-v1); folding this into
 * `forOrg` is earmarked for the W1-G invite-flow ADR.
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
    .orderBy(orgMembers.createdAt)
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
