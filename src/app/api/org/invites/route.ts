import { z } from "zod";
import { InviteError, invitesForOrg } from "@/db/invites";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// App-level routes (ADR 0004) — not part of the frozen api.ts contract.
const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

/** GET /api/org/invites — pending invites. Admin-only. */
export async function GET() {
  return handleApi(
    async (ctx) => ({
      invites: (await invitesForOrg(ctx.db, ctx.org.id).listPending()).map(
        (invite) => ({
          ...invite,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        }),
      ),
    }),
    { adminOnly: true },
  );
}

/** POST /api/org/invites — create an invite; the token is returned ONCE. */
export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      const body = await parseBody(createInviteSchema, req);
      try {
        const { invite, token } = await invitesForOrg(
          ctx.db,
          ctx.org.id,
        ).create(body.email, body.role, ctx.user.id);
        return {
          invite: {
            id: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt.toISOString(),
          },
          token,
        };
      } catch (error) {
        if (
          error instanceof InviteError &&
          error.reason === "duplicate_pending"
        ) {
          throw new ApiError(409, "a pending invite for this email exists");
        }
        throw error;
      }
    },
    { adminOnly: true },
  );
}
