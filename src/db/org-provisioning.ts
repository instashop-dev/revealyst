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
 * Modest per-user ceiling on how many team workspaces one person can CREATE
 * (orgs.created_by_user_id, ADR 0052 — never memberships: being invited as an
 * admin to someone else's workspace must not consume the cap). A best-practice
 * abuse guard so a single account can't spam-provision orgs; deliberately
 * generous — most real users create one. Enforced inside the provisioning
 * transaction when the caller passes `cap` (the user-facing POST /api/workspaces
 * does); the platform-admin seam is uncapped internal tooling.
 */
export const MAX_TEAM_WORKSPACES_PER_USER = 5;

/** Thrown by provisionTeamWorkspace when the creator is at their cap; the
 * route maps it to a plain-English 403. Carries the cap so the message can
 * derive the number from the enforced limit. */
export class TeamWorkspaceCapError extends Error {
  constructor(public readonly cap: number) {
    super(`team workspace cap reached (${cap})`);
  }
}

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
 * `ensureOrgOfOne` race), so a team workspace must not claim it. Creation
 * provenance is the separate `createdByUserId` (ADR 0052), stamped here and
 * ONLY here — signup personal orgs keep it NULL (their provenance is already
 * `bootstrapUserId`; stamping the same fact twice invites drift).
 *
 * `cap` (optional): the per-user creation ceiling. When set, the transaction
 * FIRST takes a per-user advisory lock
 * (`pg_advisory_xact_lock(hashtext('team-ws-create:' || userId))`) so
 * concurrent creates by the same user serialize, THEN counts the user's
 * created team workspaces and throws `TeamWorkspaceCapError` at the limit —
 * the check-then-insert pair is atomic under the lock, so N simultaneous
 * requests at cap−1 cannot all pass (the lock releases on commit/rollback).
 * Omitted (the platform-admin seam), no lock is taken and no cap applies.
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
  input: { name: string; creatorUserId: string; cap?: number },
): Promise<ProvisionTeamWorkspaceResult> {
  const name = input.name.trim();
  const { creatorUserId, cap } = input;
  return db.transaction(async (tx) => {
    if (cap !== undefined) {
      // Per-user serialization + in-tx count (ADR 0052): both statements run
      // inside THIS transaction, so a concurrent create by the same user
      // blocks on the lock until this one commits, then sees its row.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`team-ws-create:${creatorUserId}`}))`,
      );
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orgs)
        .where(
          and(eq(orgs.kind, "team"), eq(orgs.createdByUserId, creatorUserId)),
        );
      if ((row?.count ?? 0) >= cap) {
        throw new TeamWorkspaceCapError(cap);
      }
    }
    const [org] = await tx
      .insert(orgs)
      .values({ name, kind: "team", createdByUserId: creatorUserId })
      .returning({ id: orgs.id });
    await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId: creatorUserId, role: "admin" });
    const [team] = await tx
      .insert(teams)
      .values({ orgId: org.id, name })
      .returning({ id: teams.id });
    await tx.insert(auditLog).values({
      orgId: org.id,
      actorUserId: creatorUserId,
      action: "org.create",
      targetKind: "org",
      targetId: org.id,
      metadata: { name, kind: "team", defaultTeamId: team.id },
    });
    return { orgId: org.id, teamId: team.id };
  });
}

/**
 * How many team workspaces the user CREATED (orgs.created_by_user_id, ADR
 * 0052) — never how many they administer: an invited-admin membership must not
 * consume the creation cap. Cross-org by nature, so it lives here in the
 * pre-scope schema zone rather than behind `forOrg`. The route's cap
 * enforcement uses the in-transaction count inside provisionTeamWorkspace
 * (race-safe under the advisory lock); this standalone reader exists for
 * tests/tooling.
 */
export async function countCreatedTeamWorkspaces(
  db: Db,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgs)
    .where(and(eq(orgs.kind, "team"), eq(orgs.createdByUserId, userId)));
  return row?.count ?? 0;
}
