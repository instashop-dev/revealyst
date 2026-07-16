import type { OrgScopedDb } from "../db/org-scope";
import type { ManagedPersonSpendFacts } from "../db/org-scope/member-spend";
import {
  type ModelVolume,
  monthToDateWindow,
  priorMonthWindow,
  summarizeModelVolume,
} from "./spend-governance";
import { managerSurfaceAvailable } from "./manager-capability-view";
import type { VisibilityMode } from "./visibility";

// P3-B manager per-person SPEND drill-in read model (ADR 0045, spend half). The
// ONE loader for the spend section that renders BELOW the capability drill-in on
// /team/[personId], and ONLY when the per-team admin toggle authorizes it. It
// layers two policies on top of the org-scope `memberSpend.forManagedPerson`
// authorization (person ∈ a managed team):
//   1. VISIBILITY MODE (rule shared with the capability half): the surface is
//      UNAVAILABLE in `private` mode — spend, like the whole manager drill-in, is
//      absent (not pseudonymized) there.
//   2. THE ADMIN TOGGLE (D-TCI-2): spend renders only when a team the caller
//      manages AND that contains the person has `managersSeeIndividualCost = ON`.
//      This is the RESTRICTIVE multi-team reading (ADR 0045): access must derive
//      through a toggle-ON managed team. The loader computes that toggle-ON subset
//      from `teamSettings` and hands it to the org-scope read as the cost-visible
//      team set.
//
// The four statuses map to page behaviour:
//   - `unavailable` (private mode) / `forbidden` (person not on a team the caller
//     manages, incl. an admin without a grant, or an unknown/cross-org person) /
//     `cost-hidden` (managed, but no toggle-ON team) → the spend section is
//     ENTIRELY ABSENT (never a teaser or upsell).
//   - `ok` → the spend section renders.
// The page never 404s on the spend loader (the capability loader owns the 404
// semantics); the spend section is simply present or absent.

export type ManagerSpendView = {
  reported: { mtdCents: number; priorCents: number };
  estimated: { mtdCents: number; priorCents: number };
  /** Per-model TOKEN volume (never dollars), summarized with the shared
   * spend-governance honesty helper. */
  modelVolume: ModelVolume[];
  coverage: ManagedPersonSpendFacts["coverage"];
};

export type ManagerSpendResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "cost-hidden" }
  | { status: "ok"; spend: ManagerSpendView };

/**
 * Load one managed-team member's spend drill-in. `callerUserId` MUST be the
 * signed-in user id (the page passes `ctx.user.id`), never a request param.
 * `today` is caller-supplied (YYYY-MM-DD, UTC) so the windows are deterministic
 * and testable.
 */
export async function loadManagerSpendDrillIn(
  scope: OrgScopedDb,
  args: {
    callerUserId: string;
    personId: string;
    visibilityMode: VisibilityMode;
    today: string;
  },
): Promise<ManagerSpendResult> {
  if (!managerSurfaceAvailable(args.visibilityMode)) {
    return { status: "unavailable" };
  }
  const managedTeamIds = await scope.teamManagers.managedTeamIds(
    args.callerUserId,
  );
  if (managedTeamIds.length === 0) {
    return { status: "forbidden" };
  }

  // The toggle-ON subset of the caller's managed teams (the cost-visible set).
  // One settings read per managed team — a cold drill-in path, and managed-team
  // counts are small.
  const settings = await Promise.all(
    managedTeamIds.map((teamId) => scope.teamSettings.get(teamId)),
  );
  const costVisibleTeamIds = managedTeamIds.filter(
    (_, i) => settings[i].managersSeeIndividualCost,
  );

  const read = await scope.memberSpend.forManagedPerson(
    args.personId,
    managedTeamIds,
    costVisibleTeamIds,
    { mtd: monthToDateWindow(args.today), prior: priorMonthWindow(args.today) },
  );

  if (!read.managed) return { status: "forbidden" };
  if (!read.costVisible) return { status: "cost-hidden" };

  return {
    status: "ok",
    spend: {
      reported: read.facts.reported,
      estimated: read.facts.estimated,
      modelVolume: summarizeModelVolume(read.facts.modelTokenRows),
      coverage: read.facts.coverage,
    },
  };
}
