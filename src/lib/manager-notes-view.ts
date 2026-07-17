import type { OrgScopedDb } from "../db/org-scope";
import type { ManagerNoteRow } from "../db/org-scope/manager-notes";
import { managerSurfaceAvailable } from "./manager-capability-view";
import { resolveSelfPersonId } from "./score-insights";
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
//     manages, incl. an admin without a grant, an unknown/cross-org person, OR
//     the caller reading notes about THEMSELVES — see below) → the notes section
//     is ENTIRELY ABSENT.
//   - `ok` → the notes section renders (an empty note list is still `ok` — the
//     add-a-note form shows).
// The page never 404s on the notes loader (the capability loader owns the 404
// semantics); the notes section is simply present or absent.
//
// SELF-EXCLUSION (the player-manager edge, ADR 0053): a manager who is ALSO a
// tracked member of a team they manage must not read co-managers' notes about
// themselves. The person∈managed-team join can't express this (the org-scope
// namespace only sees ids), so THIS seam — the one holding session context —
// enforces it, using the app's ONE session-user→tracked-person resolution rule
// (`resolveSelfPersonId`: the people.auth_user_id link, or the org's only
// person). When the caller resolves to the requested person, the read is
// `forbidden`. HONEST LIMIT: an UNLINKED player-manager in a multi-person org
// resolves to null and cannot be structurally excluded — the recorded residual
// risk in ADR 0053; account linking is the mitigation.

export type ManagerNotesResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "ok"; notes: ManagerNoteRow[] };

/**
 * Is the CALLER the tracked person the notes are about? The self-exclusion
 * check shared by the read loader and the write impl (ADR 0053) — one people
 * read + the app's one self-resolution rule, so the notes surface can never
 * drift onto a private identity heuristic of its own. Cold drill-in path.
 */
export async function callerIsNoteSubject(
  scope: OrgScopedDb,
  callerUserId: string,
  personId: string,
): Promise<boolean> {
  const people = await scope.people.list();
  return resolveSelfPersonId(people, callerUserId) === personId;
}

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
  // Player-manager self-exclusion (ADR 0053): a manager never reads notes
  // about themselves, whenever the person↔account link identifies them.
  if (await callerIsNoteSubject(scope, args.callerUserId, args.personId)) {
    return { status: "forbidden" };
  }
  const notes = await scope.managerNotes.listForPerson(
    args.personId,
    managedTeamIds,
  );
  if (notes === null) return { status: "forbidden" };
  return { status: "ok", notes };
}
