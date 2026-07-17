import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { managerNotes, people, teamMembers } from "../schema";

// Manager notes on a tracked person (D-TCI-7, ADR 0053). ORG-SCOPED. The
// qualitative sibling of `mastery.forManagedPerson` / `memberSpend.forManagedPerson`:
// a manager writes and reads private coaching notes about a member of a team they
// manage. Notes NEVER feed scoring, deriveAttention, or capability state — this
// namespace is imported only by the manager read/write surface, never by any
// engine (proven by tests/manager-notes-scoring-isolation.test.ts).
//
// AUTHORIZATION, fail-closed, enforced HERE — the same membership-JOIN pattern
// mastery.forManagedPerson uses (ADR 0045). The person must be a member of one
// of the SIGNED-IN caller's OWN managed teams (`managedTeamIds`, resolved from
// `teamManagers.managedTeamIds(callerUserId)` — never a caller-supplied list),
// else every method returns `null`: an unauthorized person is indistinguishable
// from a missing one (the surface never confirms a person exists).
//
// READ visibility (ADR 0045 minimal-surface scoping): ANY current manager of the
// subject's team(s) sees ALL notes about that person, regardless of author — the
// notes are author-ATTRIBUTED (a byline), not author-PRIVATE. This mirrors how
// the capability + spend drill-ins are visible to co-managers. WRITE and DELETE
// are author-only: `create` stamps the caller as author, `deleteByAuthor` removes
// only the caller's own note.
//
// The caller/loader layers the visibility-mode gate (UNAVAILABLE in `private`
// mode) on top, exactly as manager-spend-view.ts does — this namespace enforces
// only the person-∈-managed-team half.

/** One manager note, author-attributed. `authorUserId` is an auth user id (the
 * loader resolves it to a display name via `orgMembersList`). */
export type ManagerNoteRow = {
  id: string;
  personId: string;
  authorUserId: string;
  body: string;
  followUpOn: string | null;
  createdAt: Date;
};

export function managerNotesNamespace(db: Db, orgId: string) {
  /**
   * Authorize: is `personId` a member of one of the caller's managed teams? The
   * membership join IS the authorization (mirrors mastery.forManagedPerson). One
   * query; `false` collapses "not on a managed team", "unknown person", and
   * "caller manages nothing" into one indistinguishable outcome.
   */
  async function isManagedPerson(
    personId: string,
    managedTeamIds: readonly string[],
  ): Promise<boolean> {
    if (managedTeamIds.length === 0) return false;
    const [member] = await db
      .select({ id: people.id })
      .from(teamMembers)
      .innerJoin(
        people,
        and(
          eq(people.orgId, teamMembers.orgId),
          eq(people.id, teamMembers.personId),
        ),
      )
      .where(
        and(
          eq(teamMembers.orgId, orgId),
          eq(teamMembers.personId, personId),
          inArray(teamMembers.teamId, [...managedTeamIds]),
        ),
      )
      .limit(1);
    return Boolean(member);
  }

  return {
    /**
     * All notes about one managed-team member, newest first (author-attributed —
     * see the module doc: ANY current manager of the person's team reads every
     * note, not only their own). Returns `null` when the caller is NOT authorized
     * to read this person (person not on a team in `managedTeamIds`, unknown
     * person, or empty `managedTeamIds`) — indistinguishable from a missing
     * person. `managedTeamIds` MUST be the signed-in caller's own managed teams.
     */
    async listForPerson(
      personId: string,
      managedTeamIds: readonly string[],
    ): Promise<ManagerNoteRow[] | null> {
      if (!(await isManagedPerson(personId, managedTeamIds))) return null;
      const rows = await db
        .select({
          id: managerNotes.id,
          personId: managerNotes.personId,
          authorUserId: managerNotes.authorUserId,
          body: managerNotes.body,
          followUpOn: managerNotes.followUpOn,
          createdAt: managerNotes.createdAt,
        })
        .from(managerNotes)
        .where(
          and(
            eq(managerNotes.orgId, orgId),
            eq(managerNotes.personId, personId),
          ),
        )
        .orderBy(desc(managerNotes.createdAt));
      return rows;
    },

    /**
     * Write a note about a managed-team member, stamping `authorUserId` as its
     * author. Returns the created row, or `null` when the caller is NOT authorized
     * to write about this person (same membership check as the read). Append-only:
     * there is no update method.
     */
    async create(
      personId: string,
      managedTeamIds: readonly string[],
      authorUserId: string,
      body: string,
      followUpOn: string | null,
    ): Promise<ManagerNoteRow | null> {
      if (!(await isManagedPerson(personId, managedTeamIds))) return null;
      const [row] = await db
        .insert(managerNotes)
        .values({ orgId, personId, authorUserId, body, followUpOn })
        .returning({
          id: managerNotes.id,
          personId: managerNotes.personId,
          authorUserId: managerNotes.authorUserId,
          body: managerNotes.body,
          followUpOn: managerNotes.followUpOn,
          createdAt: managerNotes.createdAt,
        });
      return row;
    },

    /**
     * Delete one note — AUTHOR-ONLY. A note is removed only by the user who wrote
     * it (co-managers can READ it but never delete it); the `authorUserId`
     * predicate is the authorization. Returns `true` when a row was deleted,
     * `false` when none matched (wrong author, wrong org, or already gone).
     */
    async deleteByAuthor(
      noteId: string,
      authorUserId: string,
    ): Promise<boolean> {
      const deleted = await db
        .delete(managerNotes)
        .where(
          and(
            eq(managerNotes.orgId, orgId),
            eq(managerNotes.id, noteId),
            eq(managerNotes.authorUserId, authorUserId),
          ),
        )
        .returning({ id: managerNotes.id });
      return deleted.length > 0;
    },
  };
}
