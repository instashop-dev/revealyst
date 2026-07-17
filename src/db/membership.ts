import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers } from "./auth-schema";
import { auditLog, managerNotes, orgs, teamManagers } from "./schema";

// Membership removal — LEAVE (self-service) and admin REMOVE (P7). Lives in the
// schema zone beside org-scope.ts / invites.ts / account-deletion.ts: it does
// raw multi-table deletes (the cascade cleanup below), which the org-scope guard
// (scripts/check-org-scope.mjs) only permits inside src/db/**. Kept OUT of the
// frozen forOrg public API — like invites.ts and account-deletion.ts, these are
// pre-scope / cross-cutting membership mutations, not per-org repository reads.
//
// Until P7 NOTHING removed an org_members row except full account deletion
// (account-deletion.ts). Users accumulated memberships they could never shed and
// admins could never evict a departed employee's login. These two functions are
// the only sanctioned org_members DELETE paths in the app.
//
// CASCADE CLEANUP (both paths, in the SAME transaction as the org_members delete
// so a partial removal can't strand a grant):
//   1. team_managers — the departing user's manager grants in THIS org. A grant
//      confers "manager" status (an org member with >=1 row); a non-member must
//      never remain a manager, so these die with the membership. (Its user FK
//      cascades only on ACCOUNT deletion — the account survives a leave, so an
//      explicit delete is required.)
//   2. manager_notes — coaching notes AUTHORED by the departing user in THIS org.
//      They are leaving, so their authored observations here are removed (the
//      author_user_id FK cascades only on ACCOUNT deletion). Notes about the
//      person written by OTHER managers are untouched.
//
// DELIBERATELY KEPT (the user account survives a leave/remove, so no FK dangles):
//   - invites they created (invited_by_user_id) — an invite is the ORG's pending
//     addition, not a membership-derived grant; it stays valid and auditable.
//   - role_assignments.assigned_by_user_id — historical "which admin last set
//     this" attribution (the schema already documents it survives; set null only
//     on account delete).
//   - audit_log rows where they are the actor — accountability history.
//   - person-level self-view data (rec_interaction_state, user_capability_state,
//     mission_progress, recommendation_exposure) — those key on a tracked PERSON
//     (people.id), not on auth membership; removing a login does not remove a
//     tracked person.
//   - desktop_pairing_codes (consented_user_id) — minted for PERSONAL orgs only
//     (D-DA-2) with <=10-min TTLs; irrelevant to leaving/removing from a team org.

export type LeaveOrgOutcome =
  | { ok: true }
  | { ok: false; reason: "not_member" | "personal_org" | "last_admin" };

export type RemoveMemberOutcome =
  | { ok: true }
  | { ok: false; reason: "not_member" | "self" | "owner" | "last_admin" };

/**
 * Is `userId` the SOLE admin of `orgId`? Probes at most two admin rows — we only
 * need "more than one?" — so removing the last admin (which would orphan a team
 * org: no one could ever manage or invite again, and there is no delete-org
 * flow) is refused. A member (non-admin) leaving is never the last admin.
 */
async function isSoleAdmin(db: Db, orgId: string): Promise<boolean> {
  const admins = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")))
    .limit(2);
  return admins.length <= 1;
}

/**
 * Delete the membership + its cascade grants + write the audit row, all in one
 * transaction. Shared by both paths so leave and remove can never diverge on
 * WHAT gets cleaned up. `actorUserId` is who performed the action (the leaver
 * themselves, or the admin doing the removing); `userId` is whose membership is
 * being removed; `action` is the audit verb.
 */
async function purgeMembership(
  db: Db,
  params: {
    orgId: string;
    userId: string;
    actorUserId: string;
    action: "org.member_leave" | "org.member_remove";
  },
): Promise<void> {
  const { orgId, userId, actorUserId, action } = params;
  await db.transaction(async (tx) => {
    await tx
      .delete(teamManagers)
      .where(and(eq(teamManagers.orgId, orgId), eq(teamManagers.userId, userId)));
    await tx
      .delete(managerNotes)
      .where(
        and(
          eq(managerNotes.orgId, orgId),
          eq(managerNotes.authorUserId, userId),
        ),
      );
    await tx
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    // Accountability trail (ADR 0010), written in-transaction so a removed
    // membership always has its matching audit row (and vice versa). targetId
    // is the user whose membership was removed.
    await tx.insert(auditLog).values({
      orgId,
      actorUserId,
      action,
      targetKind: "member",
      targetId: userId,
      metadata: {},
    });
  });
}

/**
 * A member removes their OWN membership from a workspace (self-service leave).
 * Refuses, without any DB write, when:
 *   - `not_member`: the caller does not belong to this org (route → 404).
 *   - `personal_org`: this is the caller's bootstrap org — their identity anchor
 *     (account deletion resolves it via orgs.bootstrap_user_id). You leave a team
 *     workspace, never your own account's home.
 *   - `last_admin`: the caller is the only admin of a team org — leaving would
 *     orphan it. They must make someone else an admin first.
 * Otherwise deletes the membership + cascade grants transactionally.
 */
export async function leaveOrg(
  db: Db,
  params: { userId: string; orgId: string },
): Promise<LeaveOrgOutcome> {
  const { userId, orgId } = params;
  const [membership] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!membership) {
    return { ok: false, reason: "not_member" };
  }
  const [org] = await db
    .select({ bootstrapUserId: orgs.bootstrapUserId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (org?.bootstrapUserId === userId) {
    return { ok: false, reason: "personal_org" };
  }
  if (membership.role === "admin" && (await isSoleAdmin(db, orgId))) {
    return { ok: false, reason: "last_admin" };
  }
  await purgeMembership(db, {
    orgId,
    userId,
    actorUserId: userId,
    action: "org.member_leave",
  });
  return { ok: true };
}

/**
 * An org admin removes ANOTHER member's login membership. Refuses, without any
 * DB write, when:
 *   - `self`: the actor targeted themselves — self-removal goes through leaveOrg
 *     (which carries the personal-org / last-admin guards for the actor).
 *   - `not_member`: the target does not belong to THIS org (route → 404). This is
 *     also the cross-org guard: the route always passes the actor's own org id,
 *     so an admin of org A targeting a member of org B lands here.
 *   - `owner`: the target is this org's bootstrap owner (identity anchor) — never
 *     evictable. For a personal org this coincides with the sole admin; the guard
 *     also covers the (rare) multi-admin personal org.
 *   - `last_admin`: the target is the org's only admin — removing them orphans it.
 * Otherwise deletes the target's membership + cascade grants transactionally.
 */
export async function removeOrgMember(
  db: Db,
  params: { orgId: string; targetUserId: string; actorUserId: string },
): Promise<RemoveMemberOutcome> {
  const { orgId, targetUserId, actorUserId } = params;
  if (targetUserId === actorUserId) {
    return { ok: false, reason: "self" };
  }
  const [membership] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
    .limit(1);
  if (!membership) {
    return { ok: false, reason: "not_member" };
  }
  const [org] = await db
    .select({ bootstrapUserId: orgs.bootstrapUserId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (org?.bootstrapUserId === targetUserId) {
    return { ok: false, reason: "owner" };
  }
  if (membership.role === "admin" && (await isSoleAdmin(db, orgId))) {
    return { ok: false, reason: "last_admin" };
  }
  await purgeMembership(db, {
    orgId,
    userId: targetUserId,
    actorUserId,
    action: "org.member_remove",
  });
  return { ok: true };
}
