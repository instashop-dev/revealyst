import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { identities } from "../schema";

export function identitiesNamespace(db: Db, orgId: string) {
  return {
    /**
     * Resolves a subject to a person. Many-to-many: a shared account is
     * one subject with N identity rows (§6.2). Cross-org links are
     * rejected by the composite FKs on both sides.
     */
    async link(
      subjectId: string,
      personId: string,
      method: (typeof identities.method.enumValues)[number],
      createdByUserId?: string,
    ) {
      await db
        .insert(identities)
        .values({
          orgId,
          subjectId,
          personId,
          method,
          createdByUserId: createdByUserId ?? null,
        })
        .onConflictDoNothing();
    },

    async unlink(subjectId: string, personId: string) {
      await db
        .delete(identities)
        .where(
          and(
            eq(identities.orgId, orgId),
            eq(identities.subjectId, subjectId),
            eq(identities.personId, personId),
          ),
        );
    },

    async forSubject(subjectId: string) {
      return db
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.orgId, orgId),
            eq(identities.subjectId, subjectId),
          ),
        );
    },

    async forPerson(personId: string) {
      return db
        .select()
        .from(identities)
        .where(
          and(eq(identities.orgId, orgId), eq(identities.personId, personId)),
        );
    },

    async all() {
      return db
        .select()
        .from(identities)
        .where(eq(identities.orgId, orgId));
    },
  };
}
