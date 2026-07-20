import { z } from "zod";
import {
  ApiError,
  addInitiativeDecision,
  readInitiativeDecisionLog,
} from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { orgMembersList } from "@/db/invites";

export const dynamic = "force-dynamic";

// GET/POST /api/initiatives/:id/decisions (TMD P3 tail, T3.2) — the manager
// DECISION LOG: the append-only who/why trail for one initiative. Owner-OR-admin
// (authorization lives in the impl, mirroring the review route). The log is a
// management artifact — it never feeds scoring, and it is never on the count-only
// team view; it is fetched on demand when a manager opens the review drawer.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    const decisions = await readInitiativeDecisionLog(
      { scope: ctx.scope, role: ctx.role, actorUserId: ctx.user.id },
      id,
    );
    // Resolve author ids → display names (auth users / org members — never a
    // §7 tracked person), the manager-notes-page pattern. A departed author
    // falls back to a neutral label; the row keeps its byline honest.
    const members = await orgMembersList(ctx.db, ctx.org.id);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    return {
      decisions: decisions.map((d) => ({
        id: d.id,
        event: d.event,
        note: d.note,
        createdAt: d.createdAt.toISOString(),
        authorName: names.get(d.authorUserId) ?? "A former manager",
      })),
    };
  });
}

const addSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    // A decision is attributed to its real author — never mint one under an
    // impersonated session (the manager-notes + review posture, ADR 0053/0062).
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(addSchema, req);
    const decision = await addInitiativeDecision(
      { scope: ctx.scope, role: ctx.role, actorUserId: ctx.user.id },
      { initiativeId: id, note: body.note },
    );
    return {
      id: decision.id,
      event: decision.event,
      note: decision.note,
      createdAt: decision.createdAt.toISOString(),
    };
  });
}
