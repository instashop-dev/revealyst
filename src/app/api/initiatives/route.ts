import { z } from "zod";
import { ApiError, launchInitiative } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// POST /api/initiatives (TMD P2b, ADR 0062) — launch an initiative. Manager-OR-
// admin (authorization lives in `launchInitiative`, not handleApi's adminOnly —
// a non-admin manager may launch). Default free-band paywall applies. Org-scoped
// by ctx.scope. Named participants are NOT set here (P2c).
const launchSchema = z.object({
  templateSlug: z.string().min(1).max(80).nullish(),
  title: z.string().trim().min(1).max(200),
  // The metric bindings are validated (closed union) server-side in the impl;
  // here we only shape them. At least one is required (enforced in the impl).
  capabilitySlug: z.string().min(1).max(80).nullish(),
  scoreSlug: z.string().min(1).max(40).nullish(),
  target: z.number().int().min(0).max(100),
  reviewDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .refine((v) => {
      const [y, m, d] = v.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    }, "not a real date"),
});

export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(launchSchema, req);
    return launchInitiative(
      { scope: ctx.scope, role: ctx.role, actorUserId: ctx.user.id },
      {
        templateSlug: body.templateSlug ?? null,
        title: body.title,
        capabilitySlug: body.capabilitySlug ?? null,
        scoreSlug: body.scoreSlug ?? null,
        target: body.target,
        reviewDate: body.reviewDate,
      },
    );
  });
}
