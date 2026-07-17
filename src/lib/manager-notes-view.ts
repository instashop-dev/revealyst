import type { OrgScopedDb } from "../db/org-scope";
import type { ManagerNoteRow } from "../db/org-scope/manager-notes";
import { managerSurfaceAvailable } from "./manager-capability-view";
import type { VisibilityMode } from "./visibility";

// D-TCI-7 manager NOTES read model (ADR 0053). The ONE loader for the notes
// section that renders BELOW the spend section on /team/[personId], mirroring
// manager-spend-view.ts. It layers the shared VISIBILITY-MODE gate on top of the
// org-scope `managerNotes.listForPerson` authorization (person ∈ a managed team):
// the surface is UNAVAILABLE in `private` mode — notes, like the whole manager
// drill-in, are absent (not pseudonymized) there.
//
// The three statuses map to page behaviour:
//   - `unavailable` (private mode) / `forbidden` (person not on a team the caller
//     manages, incl. an admin without a grant, or an unknown/cross-org person) →
//     the notes section is ENTIRELY ABSENT.
//   - `ok` → the notes section renders (an empty note list is still `ok` — the
//     add-a-note form shows).
// The page never 404s on the notes loader (the capability loader owns the 404
// semantics); the notes section is simply present or absent.

export type ManagerNotesResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "ok"; notes: ManagerNoteRow[] };

/**
 * Load the manager notes about one managed-team member. `callerUserId` MUST be
 * the signed-in user id (the page passes `ctx.user.id`), never a request param.
 */
export async function loadManagerNotes(
  scope: OrgScopedDb,
  args: {
    callerUserId: string;
    personId: string;
    visibilityMode: VisibilityMode;
  },
): Promise<ManagerNotesResult> {
  if (!managerSurfaceAvailable(args.visibilityMode)) {
    return { status: "unavailable" };
  }
  const managedTeamIds = await scope.teamManagers.managedTeamIds(
    args.callerUserId,
  );
  if (managedTeamIds.length === 0) {
    return { status: "forbidden" };
  }
  const notes = await scope.managerNotes.listForPerson(
    args.personId,
    managedTeamIds,
  );
  if (notes === null) return { status: "forbidden" };
  return { status: "ok", notes };
}
