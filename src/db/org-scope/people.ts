import { and, eq } from "drizzle-orm";
import {
  generatePseudonym,
  generateSuffixedPseudonym,
} from "../../lib/pseudonym";
import type { Db } from "../client";
import { people } from "../schema";
import { isUniqueViolation } from "./shared";

export type CreatePersonInput = {
  pseudonym?: string;
  displayName?: string | null;
  email?: string | null;
  authUserId?: string | null;
};

export function peopleNamespace(db: Db, orgId: string) {
  return {
    /**
     * Creates a tracked person. Pseudonyms are auto-generated and retried
     * on per-org collision (suffixed on the final attempt, so creation
     * cannot fail on pseudonym exhaustion). An explicitly supplied
     * pseudonym is never retried — its collision is the caller's error.
     */
    async create(input: CreatePersonInput = {}) {
      const values = {
        orgId,
        displayName: input.displayName ?? null,
        email: input.email?.toLowerCase() ?? null,
        authUserId: input.authUserId ?? null,
      };
      if (input.pseudonym) {
        const [row] = await db
          .insert(people)
          .values({ ...values, pseudonym: input.pseudonym })
          .returning();
        return row;
      }
      const MAX_ATTEMPTS = 4;
      for (let attempt = 1; ; attempt++) {
        const pseudonym =
          attempt < MAX_ATTEMPTS
            ? generatePseudonym()
            : generateSuffixedPseudonym();
        try {
          const [row] = await db
            .insert(people)
            .values({ ...values, pseudonym })
            .returning();
          return row;
        } catch (error) {
          if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS + 2) {
            throw error;
          }
        }
      }
    },

    async list() {
      return db
        .select()
        .from(people)
        .where(eq(people.orgId, orgId))
        .orderBy(people.createdAt);
    },

    async get(id: string) {
      const [row] = await db
        .select()
        .from(people)
        .where(and(eq(people.orgId, orgId), eq(people.id, id)));
      return row;
    },
  };
}
