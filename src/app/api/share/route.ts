import { z } from "zod";
import { shareLinksForOrg } from "@/db/share-links";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// Create an opt-in public share link for one of the org's people (ADR 0008).
// Non-frozen route (share links post-date the W0-C API freeze). Returns the
// plaintext token ONCE; the caller builds the public /s/<token> URL.
const createShareSchema = z.object({
  personId: z.string().uuid(),
  scoreSlug: z.string().min(1),
  publicLabel: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const body = await parseBody(createShareSchema, req);
    // Ownership: the person must belong to this org (the composite FK would
    // reject a foreign person anyway; this returns a useful 400) AND must be
    // the caller themselves — this is an opt-in self-share (ADR 0008), not a
    // way for any org member to publish a teammate's score without consent.
    const person = await ctx.scope.people.get(body.personId);
    if (!person) {
      throw new ApiError(400, "person not in this org");
    }
    if (person.authUserId !== ctx.user.id) {
      throw new ApiError(403, "you can only share your own score");
    }
    const { token } = await shareLinksForOrg(ctx.db, ctx.org.id).create({
      personId: body.personId,
      scoreSlug: body.scoreSlug,
      publicLabel: body.publicLabel,
      createdByUserId: ctx.user.id,
    });
    return { token };
  });
}
