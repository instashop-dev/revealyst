import { z } from "zod";
import { benchmarkConsentForOrg } from "@/db/benchmark-consent";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// Anonymized-benchmark opt-in (ADR 0008). Per (org, user); GET reads the
// current state, POST sets it. Non-frozen route.

export async function GET() {
  return handleApi(async (ctx) => {
    const row = await benchmarkConsentForOrg(ctx.db, ctx.org.id).get(ctx.user.id);
    return { granted: row?.granted ?? false };
  });
}

const setSchema = z.object({ granted: z.boolean() });

export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const { granted } = await parseBody(setSchema, req);
    await benchmarkConsentForOrg(ctx.db, ctx.org.id).set(ctx.user.id, granted);
    // Audit the consent CHANGE history — the row itself stores only the
    // current value (ADR 0008), so this is the change trail.
    await ctx.scope.auditLog.record({
      actorUserId: ctx.user.id,
      action: "consent.benchmark_set",
      targetKind: "user",
      targetId: ctx.user.id,
      metadata: { granted },
    });
    return { granted };
  });
}
