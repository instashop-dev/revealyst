import type { OrgScopedDb } from "../db/org-scope";
import { loadManagedRoster, managerSurfaceAvailable } from "./manager-capability-view";
import type { VisibilityMode } from "./visibility";

// TMD P2c (ADR 0062) — the named participant roster read/write model. This is
// the ONE loader for the initiative's NAMED participants, the wall-crossing
// surface registered as `initiativeRoster.participants[].displayName` in
// MANAGER_AUTHORIZED_IDENTITY_SURFACES (src/lib/visibility.ts). Access rules,
// enforced HERE (the routes only map the result to HTTP):
//   1. OWNER-ONLY. Names render only to the initiative's owner — the manager who
//      launched it and chose the participants from their OWN managed roster
//      (add-time enforced below). Every other caller (a different manager, a
//      plain member, and an admin WITHOUT ownership — admins get no ambient read,
//      ADR 0045) resolves to `forbidden`. The count-only card is their surface.
//   2. Org visibility must be `managed` or `full`; in `private` the surface is
//      UNAVAILABLE (absent, not pseudonymized).
//   3. A person can only be ADDED if they are in the owner's managed roster
//      (loadManagedRoster) — so the owner never names someone they couldn't
//      already see. A non-managed personId resolves to `invalid`.
// The routes map `unavailable`/`forbidden` BOTH to 404 (a 404 never confirms the
// initiative exists — ADR 0045 "expose LESS").

export type RosterPerson = { personId: string; label: string };

export type InitiativeRosterResult =
  | { status: "unavailable" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | {
      status: "ok";
      /** The current named participants (real name, or pseudonym fallback). */
      participants: RosterPerson[];
      /** The owner's managed-roster people — the pick list for adding. */
      candidates: RosterPerson[];
    };

/** Resolve the caller's managed-roster people (the add candidates), or null when
 * the surface is unavailable/forbidden. */
async function managedPeople(
  scope: OrgScopedDb,
  args: { callerUserId: string; visibilityMode: VisibilityMode },
): Promise<RosterPerson[] | null> {
  const roster = await loadManagedRoster(scope, args);
  if (roster.status !== "ok") return null;
  const seen = new Set<string>();
  const people: RosterPerson[] = [];
  for (const team of roster.teams) {
    for (const m of team.members) {
      if (seen.has(m.personId)) continue;
      seen.add(m.personId);
      people.push({ personId: m.personId, label: m.displayName ?? m.pseudonym });
    }
  }
  return people;
}

/** Owner-only gate: the surface exists, in managed/full, only to the owner. */
async function ownedInitiative(
  scope: OrgScopedDb,
  args: { initiativeId: string; callerUserId: string; visibilityMode: VisibilityMode },
): Promise<"unavailable" | "forbidden" | "ok"> {
  if (!managerSurfaceAvailable(args.visibilityMode)) return "unavailable";
  const initiative = await scope.initiatives.get(args.initiativeId);
  if (!initiative || initiative.ownerUserId !== args.callerUserId) {
    return "forbidden";
  }
  return "ok";
}

async function buildOk(
  scope: OrgScopedDb,
  args: { initiativeId: string; callerUserId: string; visibilityMode: VisibilityMode },
): Promise<InitiativeRosterResult> {
  const [rows, candidates] = await Promise.all([
    scope.initiatives.participantsWithNames(args.initiativeId),
    managedPeople(scope, args),
  ]);
  return {
    status: "ok",
    participants: rows.map((r) => ({
      personId: r.personId,
      label: r.displayName ?? r.pseudonym,
    })),
    candidates: candidates ?? [],
  };
}

/** Read the named roster + the owner's add-candidates. */
export async function readInitiativeRoster(
  scope: OrgScopedDb,
  args: { initiativeId: string; callerUserId: string; visibilityMode: VisibilityMode },
): Promise<InitiativeRosterResult> {
  const gate = await ownedInitiative(scope, args);
  if (gate !== "ok") return { status: gate };
  return buildOk(scope, args);
}

/** Add named participants (owner-only). A personId not in the owner's managed
 * roster resolves to `invalid` — the owner can't name someone they couldn't
 * already see. Returns the updated roster on success. */
export async function addInitiativeParticipants(
  scope: OrgScopedDb,
  args: {
    initiativeId: string;
    callerUserId: string;
    visibilityMode: VisibilityMode;
    personIds: readonly string[];
  },
): Promise<InitiativeRosterResult> {
  const gate = await ownedInitiative(scope, args);
  if (gate !== "ok") return { status: gate };
  const candidates = await managedPeople(scope, args);
  if (candidates === null) return { status: "unavailable" };
  const allowed = new Set(candidates.map((c) => c.personId));
  if (args.personIds.some((id) => !allowed.has(id))) {
    return { status: "invalid" };
  }
  await scope.initiatives.addParticipants(args.initiativeId, args.personIds);
  return buildOk(scope, args);
}

/** Remove one participant (owner-only). Returns the updated roster. */
export async function removeInitiativeParticipant(
  scope: OrgScopedDb,
  args: {
    initiativeId: string;
    callerUserId: string;
    visibilityMode: VisibilityMode;
    personId: string;
  },
): Promise<InitiativeRosterResult> {
  const gate = await ownedInitiative(scope, args);
  if (gate !== "ok") return { status: gate };
  await scope.initiatives.removeParticipant(args.initiativeId, args.personId);
  return buildOk(scope, args);
}
