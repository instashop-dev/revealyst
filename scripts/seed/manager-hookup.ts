// Optional post-seed step: attach a REAL, already-existing dashboard account
// to a seeded [Demo] team org as its manager, so that account can sign in and
// see the full manager view (team overview + the per-person /team capability
// roster) against the demo data — without knowing the fixture users' random
// prod-safe passwords.
//
// This is deliberately SEPARATE from the pure plan generator (activity.ts) and
// gated behind the SEED_MANAGER_EMAIL env var, so:
//   - the local `dev:seed:demo` and every test that pins buildDemoSeedPlan stay
//     byte-identical (the hookup only runs when the env var is set), and
//   - it never invents a person for a real account — the manager is a dashboard
//     user (org member + team manager), not a tracked `people` row.
//
// It only ever writes rows a real admin action would: an org_members admin row
// (the same raw insert ensureOrgOfOne / load.ts use), a team_managers grant per
// team (scoped `teamManagers.assign`, ADR 0044), and a switchActiveOrg stamp
// (ADR 0051). It NEVER creates the auth account and NEVER sets a password — if
// the account doesn't exist yet, it warns and skips (the person must sign up
// first). When the demo org is later torn down, these rows cascade away with
// the org; the real account itself is untouched (it isn't a `.example` user).
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { switchActiveOrg } from "../../src/db/org-context";
import { forOrg } from "../../src/db/org-scope";
import { orgMembers, orgs, user } from "../../src/db/schema";

export type ManagerHookupResult =
  | { status: "user-absent"; email: string }
  | { status: "org-absent"; orgName: string }
  | {
      status: "attached";
      email: string;
      userId: string;
      orgId: string;
      orgName: string;
      teamsManaged: number;
    };

/**
 * Make `email` an admin + team-manager of the (already-seeded) org named
 * `orgName`, and pin that org active for the account. Idempotent: safe to
 * re-run (membership upserts to admin, grants are onConflictDoNothing, the
 * active-org switch is a monotonic stamp).
 */
export async function attachManager(
  db: Db,
  args: { email: string; orgName: string },
): Promise<ManagerHookupResult> {
  const email = args.email.trim().toLowerCase();

  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!account) {
    return { status: "user-absent", email };
  }

  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.name, args.orgName))
    .limit(1);
  if (!org) {
    return { status: "org-absent", orgName: args.orgName };
  }

  // Admin membership — the same raw org_members insert ensureOrgOfOne itself
  // uses (load.ts documents this as the one sanctioned raw exception). Admin,
  // not member, so the account also gets Settings → People (the named roster)
  // and workspace settings alongside the team overview. Upsert (not
  // do-nothing) so a re-run — or an account that was already a plain member —
  // is guaranteed admin, matching this function's contract and the log below.
  await db
    .insert(orgMembers)
    .values({ orgId: org.id, userId: account.id, role: "admin" })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      set: { role: "admin" },
    });

  // Manager grant on every team — unlocks the /team per-person capability
  // roster + drill-in (managedTeamIds > 0, ADR 0044/0045). Managed/full
  // visibility is required for that surface; the demo org is `managed`.
  const scoped = forOrg(db, org.id);
  const teams = await scoped.teams.list();
  for (const team of teams) {
    await scoped.teamManagers.assign(team.id, account.id);
  }

  // Land the account on this workspace at next sign-in (ADR 0051). Never
  // touches created_at.
  await switchActiveOrg(db, account.id, org.id);

  return {
    status: "attached",
    email,
    userId: account.id,
    orgId: org.id,
    orgName: args.orgName,
    teamsManaged: teams.length,
  };
}
