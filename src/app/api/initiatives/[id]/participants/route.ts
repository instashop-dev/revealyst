import { z } from "zod";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import {
  addInitiativeParticipants,
  readInitiativeRoster,
  removeInitiativeParticipant,
  type InitiativeRosterResult,
} from "@/lib/initiative-roster-view";

export const dynamic = "force-dynamic";

// GET/POST/DELETE /api/initiatives/:id/participants (TMD P2c, ADR 0062) — the
// NAMED participant roster. OWNER-ONLY, managed/full mode; every other caller
// 404s (a 404 never confirms the initiative exists). Authorization lives in the
// roster-view lib; this route only maps the result to HTTP.

/** Map a roster result → an HTTP payload (throwing for non-ok). */
function rosterPayload(result: InitiativeRosterResult) {
  if (result.status === "unavailable" || result.status === "forbidden") {
    throw new ApiError(404, "not found");
  }
  if (result.status === "invalid") {
    throw new ApiError(400, "those people aren't on a team you manage");
  }
  return { participants: result.participants, candidates: result.candidates };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) =>
    rosterPayload(
      await readInitiativeRoster(ctx.scope, {
        initiativeId: id,
        callerUserId: ctx.user.id,
        visibilityMode: ctx.org.visibilityMode,
      }),
    ),
  );
}

const addSchema = z.object({
  personIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(addSchema, req);
    return rosterPayload(
      await addInitiativeParticipants(ctx.scope, {
        initiativeId: id,
        callerUserId: ctx.user.id,
        visibilityMode: ctx.org.visibilityMode,
        personIds: body.personIds,
      }),
    );
  });
}

const removeSchema = z.object({ personId: z.string().uuid() });

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(removeSchema, req);
    return rosterPayload(
      await removeInitiativeParticipant(ctx.scope, {
        initiativeId: id,
        callerUserId: ctx.user.id,
        visibilityMode: ctx.org.visibilityMode,
        personId: body.personId,
      }),
    );
  });
}
