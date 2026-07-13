import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { people, teamMembers, teams } from "../schema";

export function teamsNamespace(db: Db, orgId: string) {
  return {
    async create(name: string) {
      const [row] = await db
        .insert(teams)
        .values({ orgId, name })
        .returning();
      return row;
    },

    async list() {
      return db
        .select()
        .from(teams)
        .where(eq(teams.orgId, orgId))
        .orderBy(teams.createdAt);
    },

    /**
     * Adds a tracked person to a team. The composite (org_id, …) FKs
     * reject any cross-org combination at the DB level.
     */
    async addMember(teamId: string, personId: string) {
      await db
        .insert(teamMembers)
        .values({ orgId, teamId, personId })
        .onConflictDoNothing();
    },

    async removeMember(teamId: string, personId: string) {
      await db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.orgId, orgId),
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.personId, personId),
          ),
        );
    },

    async members(teamId: string) {
      return db
        .select({
          personId: people.id,
          pseudonym: people.pseudonym,
          displayName: people.displayName,
        })
        .from(teamMembers)
        .innerJoin(
          people,
          and(
            eq(teamMembers.personId, people.id),
            eq(teamMembers.orgId, people.orgId),
          ),
        )
        .where(
          and(eq(teamMembers.orgId, orgId), eq(teamMembers.teamId, teamId)),
        );
    },

    async allMembers() {
      return db
        .select({ teamId: teamMembers.teamId, personId: teamMembers.personId })
        .from(teamMembers)
        .where(eq(teamMembers.orgId, orgId));
    },
  };
}
