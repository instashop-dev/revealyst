import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { auditLog, orgMembers, orgs, teams } from "./schema";

// Shared team-workspace provisioning (D-ONB-1). Extracted out of src/db/admin.ts
// so the platform-admin seam (createTeamWorkspace, internal tooling) and the
// user-facing route (POST /api/workspaces) run the SAME transactional bootstrap
// — one code path, so the two can never drift on org shape (kind, admin
// membership, default team, audit row). Lives in the schema zone beside
// org-scope.ts: creating a NEW org has no single org to scope inside, the same
// pre-scope position invite-acceptance and ensureOrgOfOne write from.

/**
 * Modest per-user ceiling on how many team workspaces one person can own
 * (be an admin member of). A best-practice abuse guard so a single account
 * can't spam-provision orgs; deliberately generous — most real users own one.
 * Enforced by the user-facing route (POST /api/workspaces) via
 * countAdminTeamWorkspaces; the platform-admin seam is uncapped internal
 * tooling.
 */
export const MAX_TEAM_WORKSPACES_PER_USER = 5;

export type ProvisionTeamWorkspaceResult = {
  orgId: string;
  /** The default team seeded in the new workspace (named after it) so the
   * Settings → People manager-assignment card has a team to grant against
   * immediately. */
  teamId: string;
};

/**
 * Create a NEW team workspace and enroll the creator as its org admin. This is
 * the ONLY code path that sets `orgs.kind = 'team'` — the signup bootstrap
 * (`ensureOrgOfOne`) only ever creates `kind = 'personal'`.
 *
 * It does NOT convert the creator's existing personal org — a distinct org row
 * is created, so their §14 dogfood personal org is untouched.
 *
 * `bootstrapUserId` is left NULL: that column is a UNIQUE per-user "signup org"
 * marker owned by the creator's personal org (the constraint that closes the
 * `ensureOrgOfOne` race), so a team workspace must not claim it. A team org has
 * no bootstrap user.
 *
 * Transactional: the org, the admin membership, the default team, AND the
 * `org.create` audit row all commit together — no half-provisioned workspace,
 * and no post-commit audit write whose failure would 500 a request that already
 * created the org (a retry would then mint a duplicate orphan org). The audit
 * insert is a direct table write inside the tx (this module's sanctioned
 * raw-schema zone) mirroring `auditLogNamespace.record`'s exact row shape —
 * `forOrg().auditLog` closes over the outer `db`, not the tx, so it cannot be
 * reused here. Cross-org readable via platformAuditList, so the genesis event
 * shows in the /admin audit viewer. The creator is recorded as the audit
 * `actorUserId` (no separate creator id in metadata — the actor column IS the
 * creator). The admin membership row's fresh `createdAt` also makes this the
 * creator's most-recently-activated membership (ADR 0004/0051, via
 * `coalesce(last_active_at, created_at)`), so resolution lands them in the new
 * workspace on their next load — reachable without any switch.
 */
export async function provisionTeamWorkspace(
  db: Db,
  input: { name: string; creatorUserId: string },
): Promise<ProvisionTeamWorkspaceResult> {
  const name = input.name.trim();
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(orgs)
      .values({ name, kind: "team" })
      .returning({ id: orgs.id });
    await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId: input.creatorUserId, role: "admin" });
    const [team] = await tx
      .insert(teams)
      .values({ orgId: org.id, name })
      .returning({ id: teams.id });
    await tx.insert(auditLog).values({
      orgId: org.id,
      actorUserId: input.creatorUserId,
      action: "org.create",
      targetKind: "org",
      targetId: org.id,
      metadata: { name, kind: "team", defaultTeamId: team.id },
    });
    return { orgId: org.id, teamId: team.id };
  });
}

/**
 * How many team workspaces the user already owns (is an ADMIN member of).
 * Cross-org by nature — a count over the user's memberships joined to team
 * orgs — so it lives here in the pre-scope schema zone rather than behind
 * `forOrg`. Drives the per-user cap in POST /api/workspaces.
 */
export async function countAdminTeamWorkspaces(
  db: Db,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(
      and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.role, "admin"),
        eq(orgs.kind, "team"),
      ),
    );
  return row?.count ?? 0;
}
