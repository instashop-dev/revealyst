import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { teamManagers } from "../schema";

// Team → manager assignment (D-TCI-3, ADR 0044). A manager is a dashboard AUTH
// USER (org member) responsible for a team. Every read/write is org-scoped; the
// composite tenant FK (org_id, team_id) → teams rejects a team from another org,
// so cross-org assignment is unrepresentable at the DB level. Granting a manager
// row confers NO per-person data visibility (self-view-only mastery stands,
// D-TCI-1) — it only records who manages a team and drives the access seam.
export function teamManagersNamespace(db: Db, orgId: string) {
  return {
    /**
     * Every (team, manager-user) pair in this org — the Settings roster
     * fold-in (one batched round-trip, mirrors teams.allMembers). Org-filtered,
     * so a dropped filter deterministically surfaces another org's rows.
     */
    async list() {
      return db
        .select({
          teamId: teamManagers.teamId,
          userId: teamManagers.userId,
        })
        .from(teamManagers)
        .where(eq(teamManagers.orgId, orgId));
    },

    /**
     * The managers of one team (org-scoped). Returns teamId + userId so the
     * tenant-isolation sweep can detect a leaked team uuid; the Settings page
     * maps userId → member name from the org-members roster it already loads.
     */
    async listForTeam(teamId: string) {
      return db
        .select({
          teamId: teamManagers.teamId,
          userId: teamManagers.userId,
        })
        .from(teamManagers)
        .where(
          and(eq(teamManagers.orgId, orgId), eq(teamManagers.teamId, teamId)),
        )
        .orderBy(teamManagers.createdAt);
    },

    /**
     * The team ids this user manages within this org — the access seam
     * (isManager = non-empty). Backed by the (org_id, user_id) index; one query,
     * independent of team count.
     */
    async managedTeamIds(userId: string): Promise<string[]> {
      const rows = await db
        .select({ teamId: teamManagers.teamId })
        .from(teamManagers)
        .where(
          and(eq(teamManagers.orgId, orgId), eq(teamManagers.userId, userId)),
        );
      return rows.map((r) => r.teamId);
    },

    /**
     * Make a user a manager of a team. Idempotent (a repeat is a no-op). The
     * composite tenant FK rejects a teamId from another org, and the user FK
     * rejects an unknown user id.
     */
    async assign(teamId: string, userId: string) {
      await db
        .insert(teamManagers)
        .values({ orgId, teamId, userId })
        .onConflictDoNothing();
    },

    /** Remove a user's manager grant on a team (no-op if absent). Org-scoped. */
    async remove(teamId: string, userId: string) {
      await db
        .delete(teamManagers)
        .where(
          and(
            eq(teamManagers.orgId, orgId),
            eq(teamManagers.teamId, teamId),
            eq(teamManagers.userId, userId),
          ),
        );
    },
  };
}
