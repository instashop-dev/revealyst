import { z } from "zod";
import type { forOrg } from "@/db/org-scope";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

type Scoped = ReturnType<typeof forOrg>;

// Manual reconciliation actions (W2-K). Admin-only. All writes go through
// ctx.scope (forOrg) — link/unlink are method "manual" (a human decision),
// distinct from the connector's "email_match"/"vendor_asserted". Creating a
// person here is the ONLY sanctioned way a person enters the system from the
// reconciliation UI; an unresolved subject is never silently turned into one.

const reconcileSchema = z.discriminatedUnion("action", [
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

export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      const body = await parseBody(reconcileSchema, req);
      const scope = ctx.scope;

      switch (body.action) {
        case "link": {
          await requireSubject(scope, body.subjectId);
          await scope.identities.link(
            body.subjectId,
            body.personId,
            "manual",
            ctx.user.id,
          );
          return { ok: true };
        }
        case "create_and_link": {
          await requireSubject(scope, body.subjectId);
          const person = await scope.people.create({
            displayName: body.displayName,
          });
          await scope.identities.link(
            body.subjectId,
            person.id,
            "manual",
            ctx.user.id,
          );
          return { ok: true, personId: person.id };
        }
        case "unlink": {
          await scope.identities.unlink(body.subjectId, body.personId);
          return { ok: true };
        }
        case "assign_team": {
          await scope.teams.addMember(body.teamId, body.personId);
          return { ok: true };
        }
      }
    },
    { adminOnly: true },
  );
}

/** Reject a subjectId that isn't in this org before writing an identity —
 *  the identity insert's composite FK enforces it too, but a 404 is clearer
 *  than a surfaced FK violation. */
async function requireSubject(scope: Scoped, subjectId: string) {
  const subject = await scope.subjects.get(subjectId);
  if (!subject) {
    throw new ApiError(404, "subject not found in org");
  }
}
