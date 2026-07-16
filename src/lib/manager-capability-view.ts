import type { OrgScopedDb } from "../db/org-scope";
import type { VisibilityMode } from "./visibility";

// P3-A manager per-person capability drill-in read model (ADR 0045, capability
// half). The ONE loader for the manager-only surface where a manager reads a
// member of a team they manage. All three access rules (ADR 0045) are enforced
// HERE + in the org-scope `mastery.forManagedPerson` method it calls:
//   1. Reader must be a MANAGER OF THE SUBJECT'S TEAM (team_managers × team_
//      members). Admins get NO ambient read — an admin without a grant resolves
//      to `forbidden` exactly like any other non-manager.
//   2. Org visibility must be `managed` or `full`. In `private` the surface is
//      UNAVAILABLE (absent, not pseudonymized) — resolved as `unavailable`.
//   3. What renders is capability mastery/profile ONLY. The output types below
//      carry NO recommendation / coaching / rec-interaction / exposure / mission
//      field, and the loader SELECTs none of those tables (structurally enforced
//      by tests/manager-capability-view.test.ts). Those surfaces stay self-view-
//      only FOREVER (V4 NOT-list).
//
// The page maps `unavailable` and `forbidden` BOTH to notFound() (404): a 404
// never confirms the person exists, which is the most privacy-preserving mapping
// (ADR 0045 "when in doubt, expose LESS").

/** One capability row on the manager drill-in. DELIBERATELY the four fields
 * ADR 0045 / the surface spec name — band (from `mastery`), confidence tier,
 * evidence count, last-evidence recency — and NOTHING coaching-flavored (no
 * next-focus / curriculum / recommendation). Rendered with the same positive-
 * first vocabulary as the self-view card (masteryBand / confidenceTierLabel). */
export type ManagerCapabilityRow = {
  capabilitySlug: string;
  /** Display label from the capability catalog (`capabilities.label`). */
  label: string;
  /** [0,1] mastery — rendered as a band, never the raw number. */
  mastery: number;
  confidenceTier: string;
  /** How many signals back this read (plain count — never a fabricated bar). */
  evidenceCount: number;
  /** Most-recent measured evidence (ISO date) or null — never fabricated. */
  lastEvidenceAt: string | null;
};

/** The drill-in payload for one managed-team member. Its key set is asserted by
 * a structural test to exclude every self-view-only surface. */
export type ManagerCapabilitySubject = {
  personId: string;
  /** Real name (surfaces only because we already gated on managed/full mode);
   * falls back to the pseudonym when a person has no display name. */
  displayName: string | null;
  pseudonym: string;
  capabilities: ManagerCapabilityRow[];
};

export type ManagerDrillInResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "ok"; subject: ManagerCapabilitySubject };

export type ManagerRosterMember = {
  personId: string;
  displayName: string | null;
  pseudonym: string;
};

export type ManagerRosterTeam = {
  teamId: string;
  teamName: string;
  members: ManagerRosterMember[];
};

export type ManagerRosterResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "ok"; teams: ManagerRosterTeam[] };

/** True iff the org's visibility mode allows the manager per-person surface at
 * all. `private` keeps everyone team-only pseudonymized, so the surface is
 * UNAVAILABLE there (ADR 0045). Exported so the entry-point card can hide the
 * link in private mode too (never dangle a link to a 404). */
export function managerSurfaceAvailable(mode: VisibilityMode): boolean {
  return mode === "managed" || mode === "full";
}

/**
 * Load one managed-team member's capability drill-in. Enforces visibility mode
 * (rule 2) then delegates the manager-of-this-team authorization (rule 1) to
 * `mastery.forManagedPerson`, which returns null unless the person is a member
 * of a team the caller manages. `callerUserId` MUST be the signed-in user id
 * (the page passes `ctx.user.id`), never a request param.
 */
export async function loadManagerCapabilityDrillIn(
  scope: OrgScopedDb,
  args: {
    callerUserId: string;
    personId: string;
    visibilityMode: VisibilityMode;
  },
): Promise<ManagerDrillInResult> {
  if (!managerSurfaceAvailable(args.visibilityMode)) {
    return { status: "unavailable" };
  }
  const managedTeamIds = await scope.teamManagers.managedTeamIds(
    args.callerUserId,
  );
  const [read, labels] = await Promise.all([
    scope.mastery.forManagedPerson(args.personId, managedTeamIds),
    scope.capabilities.list(),
  ]);
  if (!read) {
    return { status: "forbidden" };
  }
  const labelBySlug = new Map(labels.map((c) => [c.slug, c.label]));
  return {
    status: "ok",
    subject: {
      personId: read.person.id,
      displayName: read.person.displayName,
      pseudonym: read.person.pseudonym,
      capabilities: read.capabilities.map((r) => ({
        capabilitySlug: r.capabilitySlug,
        label: labelBySlug.get(r.capabilitySlug) ?? r.capabilitySlug,
        mastery: r.mastery,
        confidenceTier: r.confidenceTier,
        evidenceCount: r.evidenceCount,
        lastEvidenceAt: r.lastEvidenceAt,
      })),
    },
  };
}

/**
 * Load the manager's roster — the members of every team the caller manages, by
 * name (names surface only because we already gated on managed/full). The entry
 * point for the drill-in. `forbidden` = the caller manages no team (a plain
 * member, or an admin without a self-assigned grant, or a personal org where no
 * team_managers rows exist). Reuses existing org-scoped reads only (no new
 * frozen surface): `teams.list()` + `teams.members()` per managed team.
 */
export async function loadManagedRoster(
  scope: OrgScopedDb,
  args: { callerUserId: string; visibilityMode: VisibilityMode },
): Promise<ManagerRosterResult> {
  if (!managerSurfaceAvailable(args.visibilityMode)) {
    return { status: "unavailable" };
  }
  const [managedTeamIds, allTeams] = await Promise.all([
    scope.teamManagers.managedTeamIds(args.callerUserId),
    scope.teams.list(),
  ]);
  if (managedTeamIds.length === 0) {
    return { status: "forbidden" };
  }
  const managed = allTeams.filter((t) => managedTeamIds.includes(t.id));
  const memberLists = await Promise.all(
    managed.map((t) => scope.teams.members(t.id)),
  );
  return {
    status: "ok",
    teams: managed.map((t, i) => ({
      teamId: t.id,
      teamName: t.name,
      members: memberLists[i].map((m) => ({
        personId: m.personId,
        displayName: m.displayName,
        pseudonym: m.pseudonym,
      })),
    })),
  };
}
