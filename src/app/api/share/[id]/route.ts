import { z } from "zod";
import { shareLinksForOrg } from "@/db/share-links";
import { ApiError } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

const idSchema = z.string().uuid();

export const dynamic = "force-dynamic";

// Revoke an opt-in public share link (ADR 0008 — tombstone via revoked_at;
// the public /s/<token> URL 404s immediately). Non-frozen route, sibling of
// POST /api/share. Same self-only rule as creation: you can only revoke a
// link on your own person.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    // Pre-validate: a non-UUID segment would otherwise hit the uuid column
    // as a driver error → 500 instead of 404.
    if (!idSchema.safeParse(id).success) {
      throw new ApiError(404, "share link not found");
    }
    const links = shareLinksForOrg(ctx.db, ctx.org.id);
    const link = await links.get(id);
    if (!link) {
      throw new ApiError(404, "share link not found");
    }
    const person = await ctx.scope.people.get(link.personId);
    if (!person || person.authUserId !== ctx.user.id) {
      throw new ApiError(403, "you can only revoke your own share links");
    }
    const revoked = await links.revoke(id);
    if (!revoked) {
      // Already revoked — idempotent success from the owner's perspective.
      return { revoked: true };
    }
    // Audit the revocation — mirrors share.create's audit entry.
    await ctx.scope.auditLog.record({
      actorUserId: ctx.user.id,
      action: "share.revoke",
      targetKind: "person",
      targetId: link.personId,
      // linkId disambiguates which link was revoked — a person can hold
      // several active links for the same slug.
      metadata: { scoreSlug: link.scoreSlug, linkId: link.id },
    });
    return { revoked: true };
  });
}
