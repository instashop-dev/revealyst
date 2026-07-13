import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { roleAssignments, roles } from "../schema";

// Engineering roles (W6-B, ADR 0030). Two surfaces:
//   1. `list()` — the GLOBAL `roles` reference table (no org_id; visible to
//      every org, like metric_catalog). Not an org-scoped read, so it is not
//      part of the tenant-isolation sweep.
//   2. person → role ASSIGNMENTS — org-scoped rows (org_id, person_id) → role.
//      `assignments()` is the batch read that folds into the Settings page's
//      existing flat Promise.all (G10: +1 query). `assign`/`unassign` are the
//      admin-set writes; the composite tenant FK rejects a personId from
//      another org, so cross-org assignment is unrepresentable.
// Nothing consumes roles until W6-C (the recommendation catalog FKs
// applicable_roles → roles.slug).
export function rolesNamespace(db: Db, orgId: string) {
  return {
    /**
     * The global engineering-role reference list (active roles, presentation
     * order). Global reference data — NOT org-filtered (there is no org_id on
     * `roles`); every org sees the same closed set. The Settings picker's
     * option source.
     */
    async list() {
      return db
        .select()
        .from(roles)
        .where(eq(roles.isActive, true))
        .orderBy(asc(roles.sort), asc(roles.slug));
    },

    /**
     * Every person→role assignment in this org. The Settings roster fold-in
     * (batch read, one round-trip) and the tenant-isolation sweep's read
     * surface. Org-filtered, so a dropped filter deterministically surfaces
     * another org's rows.
     */
    async assignments() {
      return db
        .select({
          personId: roleAssignments.personId,
          roleSlug: roleAssignments.roleSlug,
          updatedAt: roleAssignments.updatedAt,
        })
        .from(roleAssignments)
        .where(eq(roleAssignments.orgId, orgId));
    },

    /** This person's role assignment within this org, or undefined if none. */
    async getForPerson(personId: string) {
      const [row] = await db
        .select({
          personId: roleAssignments.personId,
          roleSlug: roleAssignments.roleSlug,
        })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.orgId, orgId),
            eq(roleAssignments.personId, personId),
          ),
        );
      return row;
    },

    /**
     * Assign (or reassign) a person's role. Upserts on the
     * (org_id, person_id) key so a second call replaces the role rather than
     * failing — one role per person by construction. The composite tenant FK
     * rejects a personId from another org (and a `roleSlug` absent from the
     * `roles` reference table fails the role FK). Returns the stored row.
     */
    async assign(input: {
      personId: string;
      roleSlug: string;
      assignedByUserId?: string | null;
    }) {
      const [row] = await db
        .insert(roleAssignments)
        .values({
          orgId,
          personId: input.personId,
          roleSlug: input.roleSlug,
          assignedByUserId: input.assignedByUserId ?? null,
        })
        .onConflictDoUpdate({
          target: [roleAssignments.orgId, roleAssignments.personId],
          set: {
            roleSlug: input.roleSlug,
            assignedByUserId: input.assignedByUserId ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    /** Remove a person's role assignment (no-op if none). Org-scoped. */
    async unassign(personId: string) {
      await db
        .delete(roleAssignments)
        .where(
          and(
            eq(roleAssignments.orgId, orgId),
            eq(roleAssignments.personId, personId),
          ),
        );
    },
  };
}
