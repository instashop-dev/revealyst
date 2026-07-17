import { z } from "zod";
import { ApiError, createManagerNote } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// POST /api/team/:personId/notes — write a manager coaching note about a member
// of a team the caller manages (D-TCI-7, ADR 0053). All authorization lives in
// `createManagerNote`: the manager surface is UNAVAILABLE in `private` mode, and
// the caller must be a manager of a team the person belongs to (every other
// outcome → 404, never confirming the person exists).
//
// - handleApi: 401 for signed-out.
// - Impersonation → 403 (mirrors /api/workspaces): a platform admin wearing a
//   user's hat must not author a persistent note as that user. READS of the
//   drill-in stay allowed under impersonation (ADR 0045); only WRITES are blocked.
// - No `allowOverFreeBand`: this is normal gated data, so a paywalled org gets 402
//   like every other data write.
// - The author is derived from the session (ctx.user.id), never the body — no
//   mass-assignment path to author a note as someone else.

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  // Optional reminder date (YYYY-MM-DD). Absent/empty → no follow-up. The
  // round-trip refine rejects impossible dates the shape regex admits
  // (2026-13-45, 2026-02-30) — Postgres would otherwise 500 on the `date`
  // column instead of this clean 400.
  followUpOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => {
      const parsed = new Date(`${s}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === s
      );
    }, "not a real calendar date")
    .nullish(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ personId: string }> },
) {
  const { personId } = await params;
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const parsed = await parseBody(createSchema, req);
    return createManagerNote(
      { scope: ctx.scope },
      {
        callerUserId: ctx.user.id,
        personId,
        visibilityMode: ctx.org.visibilityMode,
        body: parsed.body,
        followUpOn: parsed.followUpOn ?? null,
      },
    );
  });
}
