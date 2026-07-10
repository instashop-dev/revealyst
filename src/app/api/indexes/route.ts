import {
  assertCustomIndexEntitledForOrg,
  listCustomIndexes,
  publishCustomIndex,
} from "@/lib/custom-index-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { customIndexPublishSchema } from "@/lib/custom-index";

// Custom Index Builder routes (W4-U, ADR 0021). Not in the frozen api.ts
// contract (that surface is closed) — these follow the /api/share pattern:
// inline-validated, admin-only, and Team-paid gated. handleApi supplies the
// 401/403/402(free-band) gates; `assertCustomIndexEntitled` adds the Team-plan
// requirement (§8.5 guardrail 6). Listing is allowed while lapsed so the
// paused UI can render; publishing requires an active entitlement.

export const dynamic = "force-dynamic";

/** GET /api/indexes — list this org's custom indexes (all versions grouped).
 * Admin-only. Allowed while entitlement is lapsed so the builder can render
 * last results in a paused state. */
export async function GET() {
  return handleApi((ctx) => listCustomIndexes(ctx.scope), { adminOnly: true });
}

/** POST /api/indexes — publish a custom index (new index, or a new version of
 * an existing one when `slug` is supplied). Admin-only, Team-paid. */
export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      await assertCustomIndexEntitledForOrg(ctx.db, ctx.org.id);
      const body = await parseBody(customIndexPublishSchema, req);
      const view = await publishCustomIndex(ctx.scope, body);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "custom_index.publish",
        targetKind: "score_definition",
        targetId: view.slug,
        metadata: {
          slug: view.slug,
          name: view.name,
          subjectLevel: view.subjectLevel,
          version: view.versions[0]?.version ?? null,
        },
      });
      return view;
    },
    { adminOnly: true },
  );
}
