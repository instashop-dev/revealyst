import { and, eq, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers, orgs, pollHeartbeats } from "./schema";

/**
 * Resolves a user's org membership — the one query that runs *before* an
 * org scope exists (it's how the scope is established). Lives here so the
 * tenancy seam stays in a single reviewed module.
 */
export async function membershipForUser(db: Db, userId: string) {
  const [membership] = await db
    .select({
      orgId: orgMembers.orgId,
      orgName: orgs.name,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgMembers.createdAt)
    .limit(1);
  return membership;
}

/**
 * Creates a user's org of one + admin membership if they have none, and
 * returns their membership. Transactional (no org without membership) and
 * idempotent (re-running returns the existing membership) — Better Auth's
 * `after` hooks run post-commit, so a hook failure must be recoverable on
 * the next request rather than leaving the user permanently org-less.
 * Concurrent first requests can still race to create two orgs; the
 * earliest-created membership wins deterministically via the orderBy above.
 * W0-C's frozen contract should close that race properly.
 */
export async function ensureOrgOfOne(
  db: Db,
  user: { id: string; name?: string | null; email: string },
) {
  const existing = await membershipForUser(db, user.id);
  if (existing) {
    return existing;
  }
  await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(orgs)
      .values({ name: user.name || user.email })
      .returning();
    await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId: user.id, role: "admin" })
      .onConflictDoNothing();
  });
  const membership = await membershipForUser(db, user.id);
  if (!membership) {
    throw new Error(`org bootstrap failed for user ${user.id}`);
  }
  return membership;
}

/**
 * Org-scoped repository layer — the tenancy rule's enforcement point.
 *
 * Every query in application code goes through `forOrg(db, orgId)`; raw
 * table access outside this module is a review-blocker (CLAUDE.md). W0-C
 * freezes the full contract (RLS or this layer, decided there); this is
 * the walking-skeleton version proving the shape: the org filter is
 * applied inside the layer, so call sites cannot forget it.
 */
export function forOrg(db: Db, orgId: string) {
  return {
    orgId,

    heartbeats: {
      async record(source = "noop-poller") {
        const [row] = await db
          .insert(pollHeartbeats)
          .values({ orgId, source })
          .returning();
        return row;
      },

      async list(where?: SQL) {
        return db
          .select()
          .from(pollHeartbeats)
          .where(
            where
              ? and(eq(pollHeartbeats.orgId, orgId), where)
              : eq(pollHeartbeats.orgId, orgId),
          )
          .orderBy(pollHeartbeats.observedAt);
      },
    },
  };
}

export type OrgScopedDb = ReturnType<typeof forOrg>;
