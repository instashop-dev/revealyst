import { apiRoutes } from "@/contracts/api";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { DEFAULT_SNOOZE_DAYS, snoozeUntilFrom } from "@/lib/rec-interactions";

export const dynamic = "force-dynamic";

// Set the current person's interaction state for one coaching recommendation
// (W5-D, ADR 0028) — snooze / dismiss / mark-tried. Non-frozen route; the
// contract shape lives in the frozen contracts/api.ts (ADR-covered). The 402
// free-band paywall applies by default (handleApi) — NOT opted out.
//
// SELF-VIEW ONLY (§8.3): the personId must be the CALLER's own tracked person
// (people.auth_user_id === session user), mirroring the share route's
// ownership check. A manager cannot set another person's state — and because
// there is no interaction-state READ route at all, cannot read it either. No
// audit_log entry is written: audit is a manager-visible surface, so recording
// "person X dismissed rec Y" there would itself be the self-view leak this
// feature forbids.
export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const body = await parseBody(apiRoutes.recInteractionSet.request, req);

    // Only a real recommendation can be interacted with — an unknown id is a
    // client bug, not a row to store (keeps the table free of orphan rec_ids).
    // The valid ids are the catalog `slug`s visible to this org (W6-C, ADR
    // 0033) — a live per-org read (global presets ∪ this org's rows), not a
    // TS mirror of catalog content. This POST is a write path, so the one extra
    // read is not on any hot render.
    const catalog = await ctx.scope.catalog.list();
    if (!catalog.some((rec) => rec.id === body.recId)) {
      throw new ApiError(400, "unknown recommendation");
    }

    // Ownership: the person must belong to this org AND be the caller. The
    // composite FK would reject a foreign person on write anyway; this returns
    // a useful status and enforces the self-view rule up front.
    const person = await ctx.scope.people.get(body.personId);
    if (!person) {
      throw new ApiError(400, "person not in this org");
    }
    if (person.authUserId !== ctx.user.id) {
      throw new ApiError(403, "you can only act on your own recommendations");
    }

    const snoozeUntil =
      body.state === "snoozed"
        ? snoozeUntilFrom(new Date(), body.snoozeDays ?? DEFAULT_SNOOZE_DAYS)
        : null;

    await ctx.scope.recInteractions.set({
      personId: body.personId,
      recId: body.recId,
      state: body.state,
      snoozeUntil,
    });

    return { ok: true as const };
  });
}
