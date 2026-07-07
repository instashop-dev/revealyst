// Manual reconciliation action logic (W2-K), extracted from the route so it
// is unit-testable against the repo layer rather than only through HTTP glue.
// All writes go through the org-scoped `forOrg` surface; link/unlink are
// method "manual" (a human decision), distinct from the connector's
// "email_match"/"vendor_asserted".

import { z } from "zod";
import type { forOrg } from "../db/org-scope";
import { ApiError } from "./api-impl";

type Scoped = ReturnType<typeof forOrg>;

export const reconcileActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("link"),
    subjectId: z.string().uuid(),
    personId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("create_and_link"),
    subjectId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("unlink"),
    subjectId: z.string().uuid(),
    personId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("assign_team"),
    personId: z.string().uuid(),
    teamId: z.string().uuid(),
  }),
]);

export type ReconcileAction = z.infer<typeof reconcileActionSchema>;

/**
 * Applies one reconciliation action. Creating a person here is the ONLY
 * sanctioned way one enters from the reconciliation UI — an unresolved
 * subject is never silently turned into a person (invariant b). Cross-org
 * ids can't do damage: `identities.unlink` is org-scoped (a foreign id is a
 * silent no-op) and `teams.addMember`/`identities.link` are guarded by the
 * composite tenant FKs (a foreign id is rejected, never written).
 */
export async function applyReconcileAction(
  scope: Scoped,
  actorUserId: string | null,
  action: ReconcileAction,
): Promise<{ ok: true; personId?: string }> {
  const createdBy = actorUserId ?? undefined;
  // Audit (ADR 0010): recorded after the write succeeds, so a failed action
  // never leaves a phantom trail. Especially load-bearing for unlink — a
  // hard delete that otherwise leaves no trace of who undid a mapping.
  const audit = (
    auditAction: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) =>
    scope.auditLog.record({
      actorUserId,
      action: auditAction,
      targetKind: "identity",
      targetId,
      metadata,
    });
  switch (action.action) {
    case "link": {
      await requireSubject(scope, action.subjectId);
      await scope.identities.link(
        action.subjectId,
        action.personId,
        "manual",
        createdBy,
      );
      await audit("identity.link", action.subjectId, {
        personId: action.personId,
      });
      return { ok: true };
    }
    case "create_and_link": {
      await requireSubject(scope, action.subjectId);
      // create → link is two writes, not a transaction (the forOrg surface
      // exposes no cross-statement tx). If link failed mid-flight the person
      // would be orphaned — harmless: with no identity row it is neither
      // billed nor counted as a tracked user, and link only fails on a
      // vanished subject (already ownership-checked) or a transient error.
      const person = await scope.people.create({
        displayName: action.displayName,
      });
      await scope.identities.link(
        action.subjectId,
        person.id,
        "manual",
        createdBy,
      );
      await audit("identity.create_and_link", action.subjectId, {
        personId: person.id,
      });
      return { ok: true, personId: person.id };
    }
    case "unlink": {
      await scope.identities.unlink(action.subjectId, action.personId);
      await audit("identity.unlink", action.subjectId, {
        personId: action.personId,
      });
      return { ok: true };
    }
    case "assign_team": {
      await scope.teams.addMember(action.teamId, action.personId);
      await scope.auditLog.record({
        actorUserId,
        action: "team.assign_member",
        targetKind: "team",
        targetId: action.teamId,
        metadata: { personId: action.personId },
      });
      return { ok: true };
    }
  }
}

/** Reject a subjectId that isn't in this org before writing an identity —
 *  the composite FK enforces it too, but a 404 is clearer than a surfaced
 *  FK violation. */
async function requireSubject(scope: Scoped, subjectId: string) {
  const subject = await scope.subjects.get(subjectId);
  if (!subject) {
    throw new ApiError(404, "subject not found in org");
  }
}
