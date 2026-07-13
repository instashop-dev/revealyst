import { z } from "zod";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// PATCH /api/settings/exec-report — opt the WORKSPACE in or out of the monthly
// executive memo (W6-F, ADR 0031). Unlike the per-user weekly digest, the exec
// memo is an ORG-LEVEL board artifact sent to all admins, so this is a single
// per-org setting (execReportState.setEnabled), not a per-user preference.
//
// - Admin-only (`adminOnly`): a governance/board surface, like /api/settings.
// - `allowOverFreeBand`: managing your own notification setting must work even
//   for a paywalled org (turning a memo OFF is never gated).
//
// Uses a LOCAL zod schema, not the frozen src/contracts/api.ts (additive route).
const execReportPrefsSchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request) {
  return handleApi(
    async (ctx) => {
      const { enabled } = await parseBody(execReportPrefsSchema, req);
      const row = await ctx.scope.execReportState.setEnabled(enabled);
      return { enabled: row.execReportEnabled };
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
