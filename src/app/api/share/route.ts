import { z } from "zod";
import { shareLinksForOrg } from "@/db/share-links";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody, parseQuery } from "@/lib/api-route";
import { isCustomSlug } from "@/lib/custom-index";

export const dynamic = "force-dynamic";

// Create an opt-in public share link for one of the org's people (ADR 0008).
// Non-frozen route (share links post-date the W0-C API freeze). Returns the
// plaintext token ONCE; the caller builds the public /s/<token> URL.
//
// §8.5 guardrail 2: custom indexes are NEVER shareable — no public benchmark
// exists for an org-specific formula, so a shared "vs" card would fabricate
// comparability (invariant b). Reject `custom-` slugs here (and the db factory
// rejects them too, belt-and-suspenders). Customs are also team/org-level, so
// a person-level share could never legitimately reference one anyway.
const createShareSchema = z.object({
  personId: z.string().uuid(),
  scoreSlug: z
    .string()
    .min(1)
    .refine((slug) => !isCustomSlug(slug), {
      message: "custom indexes are not shareable",
    }),
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
    const { link, token } = await shareLinksForOrg(ctx.db, ctx.org.id).create({
      personId: body.personId,
      scoreSlug: body.scoreSlug,
      publicLabel: body.publicLabel,
      createdByUserId: ctx.user.id,
    });
    // Audit the share creation — never the token (it IS the capability).
    await ctx.scope.auditLog.record({
      actorUserId: ctx.user.id,
      action: "share.create",
      targetKind: "person",
      targetId: body.personId,
      metadata: { scoreSlug: body.scoreSlug },
    });
    // id lets the dialog correlate this link with the active list (e.g. to
    // clear the shown one-time URL if the user immediately revokes it).
    return { token, id: link.id };
  });
}

const listShareSchema = z.object({ personId: z.string().uuid() });

// The owner's "my share links" list. Plaintext tokens are never stored, so
// this returns metadata only (no URLs) — the URL is shown once at creation.
// Same self-only rule as POST: you can only list your own links.
export async function GET(req: Request) {
  return handleApi(async (ctx) => {
    const { personId } = parseQuery(listShareSchema, req);
    const person = await ctx.scope.people.get(personId);
    if (!person) {
      throw new ApiError(400, "person not in this org");
    }
    if (person.authUserId !== ctx.user.id) {
      throw new ApiError(403, "you can only list your own share links");
    }
    const links = await shareLinksForOrg(ctx.db, ctx.org.id).listForPerson(
      personId,
    );
    return {
      links: links.map((l) => ({
        id: l.id,
        scoreSlug: l.scoreSlug,
        publicLabel: l.publicLabel,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });
}
