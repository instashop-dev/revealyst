import { z } from "zod";
import { ApiError, setTeamGoal } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { teamGoalMetricSchema } from "@/lib/team-goal";

export const dynamic = "force-dynamic";

// POST /api/goals (TMD P1b, ADR 0061) — set the active org-wide team goal.
// Authorization (admin OR team manager; member 403s) lives in `setTeamGoal`,
// not `handleApi`'s `adminOnly` gate, because a non-admin manager may also set a
// goal. Default free-band paywall applies (team data behind the paywall).
// Org-scoped by `ctx.scope`.
const setGoalSchema = z.object({
  metricSlug: teamGoalMetricSchema,
  // Score slugs are 0–100; the DB column is a plain integer.
  target: z.number().int().min(0).max(100),
  // ISO calendar date. The regex fixes the shape; the refine rejects impossible
  // days the DB `date` column would 500 on — `Date.parse("2026-02-30")` succeeds
  // (V8 rolls it to Mar 2), so round-trip the parts and require they survive.
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
    // Impersonated admins never write on someone's behalf (mirrors the notes
    // route) — a goal is attributed to its owner, so it must be the real user.
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    const body = await parseBody(setGoalSchema, req);
    return setTeamGoal(
      { scope: ctx.scope, role: ctx.role, actorUserId: ctx.user.id },
      body,
    );
  });
}
