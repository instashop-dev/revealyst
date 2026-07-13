import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { orgs } from "../schema";

/**
 * The org row itself (ADR 0018). The FIRST-ever `orgs` writer on this
 * surface — V1 wrote `orgs` only at signup (ensureOrgOfOne). Rename and
 * visibility-mode change go through here so the single privacy-sensitive
 * mutation stays inside the org-scoped repository (raw `orgs` access
 * elsewhere is a review-blocker). `orgId` is closure-bound, so a
 * cross-org write is unrepresentable.
 */
export function orgNamespace(db: Db, orgId: string) {
  return {
    /** Update the org's name and/or visibility mode. Callers pass only the
     * fields that changed (an empty patch is rejected upstream at the route,
     * ADR 0018). Returns the updated row's id/name/kind/visibilityMode. */
    async update(patch: {
      name?: string;
      visibilityMode?: "private" | "managed" | "full";
    }) {
      const [row] = await db
        .update(orgs)
        .set(patch)
        .where(eq(orgs.id, orgId))
        .returning({
          id: orgs.id,
          name: orgs.name,
          kind: orgs.kind,
          visibilityMode: orgs.visibilityMode,
        });
      return row;
    },
  };
}
