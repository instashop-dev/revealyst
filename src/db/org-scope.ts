import { and, eq, type SQL } from "drizzle-orm";
import {
  generatePseudonym,
  generateSuffixedPseudonym,
} from "../lib/pseudonym";
import type { Db } from "./client";
import {
  orgMembers,
  orgs,
  people,
  pollHeartbeats,
  teamMembers,
  teams,
} from "./schema";

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
 * Concurrent first requests serialize on the orgs.bootstrap_user_id unique
 * constraint: the losing insert no-ops and adopts the winner's org, so two
 * orgs for one signup are unrepresentable (the W0-C race fix).
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
    const [inserted] = await tx
      .insert(orgs)
      .values({
        name: user.name || user.email,
        kind: "personal",
        bootstrapUserId: user.id,
      })
      .onConflictDoNothing({ target: orgs.bootstrapUserId })
      .returning({ id: orgs.id });
    const orgId =
      inserted?.id ??
      (
        await tx
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.bootstrapUserId, user.id))
      )[0]?.id;
    if (orgId) {
      await tx
        .insert(orgMembers)
        .values({ orgId, userId: user.id, role: "admin" })
        .onConflictDoNothing();
    }
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
/** Postgres unique-violation, across postgres.js and PGlite drivers. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export type CreatePersonInput = {
  pseudonym?: string;
  displayName?: string | null;
  email?: string | null;
  authUserId?: string | null;
};

export function forOrg(db: Db, orgId: string) {
  return {
    orgId,

    people: {
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
    },

    teams: {
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
    },

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
