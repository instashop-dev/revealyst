import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers } from "./auth-schema";
import {
  auditLog,
  benchmarkConsent,
  digestPreferences,
  managerNotes,
  orgs,
  teamManagers,
} from "./schema";

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
// LAST-ADMIN SAFETY (concurrency). The "don't orphan a team org" invariant is
// enforced INSIDE the removal transaction, holding a `SELECT ... FOR UPDATE` lock
// on the org row (below). A pre-transaction count is check-then-act racy: two
// co-admins leaving concurrently each read [A,B], each pass a stale guard, each
// delete their own row (no write conflict under READ COMMITTED) → ZERO admins,
// and an orphaned team org is unrecoverable (invites need an admin; there is no
// promote-non-admin or delete-org path). The lock serializes all membership
// mutations for one org, so the second transaction recounts AFTER the first
// commits and correctly refuses.
//
// CASCADE CLEANUP (both paths, in the SAME transaction as the org_members delete
// so a partial removal can't strand a row):
//   1. team_managers — the departing user's manager grants in THIS org. A grant
//      confers "manager" status (an org member with >=1 row); a non-member must
//      never remain a manager, so these die with the membership. (Its user FK
//      cascades only on ACCOUNT deletion — the account survives a leave, so an
//      explicit delete is required.)
//   2. manager_notes — coaching notes AUTHORED by the departing user in THIS org.
//      They are leaving, so their authored observations here are removed (the
//      author_user_id FK cascades only on ACCOUNT deletion). Notes about the
//      person written by OTHER managers are untouched.
//   3. digest_preferences — the (org_id, user_id) weekly-digest row. Membership-
//      derived: on RE-INVITE a stale row would silently resurrect a digest
//      subscription (old digest_enabled + unsubscribe token). Its FK cascades
//      only on org/account delete, so an explicit delete is required (and keeps
//      digest.ts's "a member who leaves keeps no dangling preference" claim true).
//   4. benchmark_consent — the (org_id, user_id) consent row. Membership-derived:
//      a re-invite must start from NO consent, never a stale prior grant (consent
//      freshness). Its FK likewise cascades only on org/account delete.
//
// DELIBERATELY KEPT (account-level attribution, NOT membership-derived — the user
// account survives a leave/remove, so no FK dangles):
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

/** Internal sentinel: thrown inside purgeMembership's transaction when the
 * (locked) recount shows the user is the org's sole admin, rolling the whole
 * removal back. Mapped to the `last_admin` outcome by the callers. */
class LastAdminError extends Error {}

/**
 * Delete the membership + its cascade rows + write the audit row, all in ONE
 * transaction guarded by a row lock. Shared by both paths so leave and remove can
 * never diverge on WHAT gets cleaned up OR on the last-admin invariant.
 *
 * Steps (order matters):
 *   1. `SELECT id FROM orgs WHERE id = :orgId FOR UPDATE` — serializes every
 *      membership mutation for this org against concurrent leaves/removes.
 *   2. Re-read the target's role UNDER THE LOCK; if they are an admin and the
 *      (also-under-lock) admin count is <= 1, throw LastAdminError to roll back.
 *   3. Delete the cascade rows + the membership; insert the audit row.
 *
 * `actorUserId` is who performed the action; `userId` is whose membership is
 * removed; `action` is the audit verb. Returns "ok" or "last_admin".
 */
async function purgeMembership(
  db: Db,
  params: {
    orgId: string;
    userId: string;
    actorUserId: string;
    action: "org.member_leave" | "org.member_remove";
  },
): Promise<"ok" | "last_admin"> {
  const { orgId, userId, actorUserId, action } = params;
  try {
    await db.transaction(async (tx) => {
      // Serialize membership mutations for this org (see the LAST-ADMIN SAFETY
      // note above). Every leave/remove takes this same lock first.
      await tx.execute(
        sql`select id from ${orgs} where ${orgs.id} = ${orgId} for update`,
      );
      // Authoritative last-admin check, holding the lock. Re-read the role too
      // (it may have changed since the caller's pre-checks).
      const [membership] = await tx
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
        .limit(1);
      if (membership?.role === "admin") {
        const admins = await tx
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")))
          .limit(2);
        if (admins.length <= 1) {
          throw new LastAdminError();
        }
      }
      await tx
        .delete(teamManagers)
        .where(
          and(eq(teamManagers.orgId, orgId), eq(teamManagers.userId, userId)),
        );
      await tx
        .delete(managerNotes)
        .where(
          and(
            eq(managerNotes.orgId, orgId),
            eq(managerNotes.authorUserId, userId),
          ),
        );
      await tx
        .delete(digestPreferences)
        .where(
          and(
            eq(digestPreferences.orgId, orgId),
            eq(digestPreferences.userId, userId),
          ),
        );
      await tx
        .delete(benchmarkConsent)
        .where(
          and(
            eq(benchmarkConsent.orgId, orgId),
            eq(benchmarkConsent.userId, userId),
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
    return "ok";
  } catch (error) {
    if (error instanceof LastAdminError) {
      return "last_admin";
    }
    throw error;
  }
}

/**
 * A member removes their OWN membership from a workspace (self-service leave).
 * Refuses, without any DB write, when:
 *   - `not_member`: the caller does not belong to this org (route → 404).
 *   - `personal_org`: this is the caller's bootstrap org — their identity anchor
 *     (account deletion resolves it via orgs.bootstrap_user_id). You leave a team
 *     workspace, never your own account's home.
 *   - `last_admin`: the caller is the only admin of a team org — leaving would
 *     orphan it. They must make someone else an admin first. (Enforced under a
 *     row lock inside the transaction — see purgeMembership.)
 * Otherwise deletes the membership + cascade rows transactionally.
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
  const result = await purgeMembership(db, {
    orgId,
    userId,
    actorUserId: userId,
    action: "org.member_leave",
  });
  return result === "last_admin"
    ? { ok: false, reason: "last_admin" }
    : { ok: true };
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
 *   - `last_admin`: the target is the org's only admin — removing them orphans it
 *     (enforced under a row lock inside the transaction — see purgeMembership).
 * Otherwise deletes the target's membership + cascade rows transactionally.
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
  const result = await purgeMembership(db, {
    orgId,
    userId: targetUserId,
    actorUserId,
    action: "org.member_remove",
  });
  return result === "last_admin"
    ? { ok: false, reason: "last_admin" }
    : { ok: true };
}
