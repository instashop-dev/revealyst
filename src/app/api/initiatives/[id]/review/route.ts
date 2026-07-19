import { z } from "zod";
import { ApiError, recordInitiativeOutcome, stopInitiative } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// POST /api/initiatives/:id/review (TMD P3, ADR 0062) — record an initiative's
// outcome, or stop it. Owner-OR-admin (authorization lives in the impl). The
// outcome is the manager's own read of the measured before/after — never a
// Revealyst causality claim. Impersonation-blocked (a review is attributed).
const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("complete"),
    outcome: z.enum(["improved", "unchanged", "worsened", "inconclusive"]),
  }),
  z.object({ action: z.literal("stop") }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(reviewSchema, req);
    const authArgs = {
      scope: ctx.scope,
      role: ctx.role,
      actorUserId: ctx.user.id,
    };
    if (body.action === "stop") {
      return stopInitiative(authArgs, id);
    }
    return recordInitiativeOutcome(authArgs, {
      initiativeId: id,
      outcome: body.outcome,
    });
  });
}
