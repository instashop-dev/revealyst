// Removes every trace of the demo seed from a database — the counterpart to
// load.ts, and the refresh path for a decaying prod demo (data ends at its
// seed anchor, so trailing-window analytics thin out over ~4 weeks:
// teardown → re-seed). Match keys are chosen to be UNREACHABLE by real
// customers, not merely exact: "[Demo] "-prefixed org names (only
// applyProdSafety mints these), the demo users' literal .example emails
// (unverifiable addresses — a real account can never activate on one), and
// orgs bootstrapped by those users (signUpEmail's ensureOrgOfOne
// side-effect orgs, e.g. "Tara CTO"). UNPREFIXED base names ("Acme
// Robotics", "Jordan Lee") are matched ONLY behind the explicit
// `includeUnprefixed` opt-in for local DBs seeded without prod-safe mode —
// a real customer org or a real user's org-of-one can collide with those
// exact strings, and an adversarial review reproduced that deletion, so the
// default must never consider them. Purge order reuses
// src/db/account-deletion.ts's PURGE_TABLES (its completeness tripwire
// keeps that list in lockstep with the schema), then the orgs row cascades
// the rest; auth users are deleted last.
import { eq, inArray, or } from "drizzle-orm";
import { PURGE_TABLES } from "../../src/db/account-deletion";
import type { Db } from "../../src/db/client";
import { orgs, user } from "../../src/db/schema";
import { DEMO_ORG_PREFIX } from "./prod-safety";
import type { SeedPlan } from "./plan";

export type TeardownSummary = {
  orgsDeleted: { id: string; name: string }[];
  usersDeleted: string[];
};

export async function teardownDemoData(
  db: Db,
  plan: SeedPlan,
  opts: { includeUnprefixed?: boolean } = {},
): Promise<TeardownSummary> {
  const baseNames = plan.orgs.map((o) => o.name);
  const names = [
    ...new Set([
      ...baseNames.map((n) =>
        n.startsWith(DEMO_ORG_PREFIX) ? n : `${DEMO_ORG_PREFIX}${n}`,
      ),
      ...(opts.includeUnprefixed ? baseNames : []),
    ]),
  ];
  const emails = plan.orgs.flatMap(
    (o) => o.users?.map((u) => u.email.toLowerCase()) ?? [],
  );

  const userRows =
    emails.length > 0
      ? await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(inArray(user.email, emails))
      : [];
  const userIds = userRows.map((r) => r.id);

  const orgRows = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(
      userIds.length > 0
        ? or(inArray(orgs.name, names), inArray(orgs.bootstrapUserId, userIds))
        : inArray(orgs.name, names),
    );

  for (const org of orgRows) {
    // Same FK-safe order as assertDeletableAndPurgeOrg: explicit deletes for
    // tables without a cascade-to-orgs FK, then the orgs row cascades
    // invites/benchmark_consent/subscriptions/audit_log/budgets.
    await db.transaction(async (tx) => {
      for (const table of PURGE_TABLES) {
        await tx.delete(table).where(eq(table.orgId, org.id));
      }
      await tx.delete(orgs).where(eq(orgs.id, org.id));
    });
  }

  // Auth cascade removes sessions/accounts/org_members; people.authUserId
  // and shareLinks.createdByUserId are set-null FKs but those rows are
  // already gone with their orgs above.
  if (userIds.length > 0) {
    await db.delete(user).where(inArray(user.id, userIds));
  }

  return { orgsDeleted: orgRows, usersDeleted: userRows.map((r) => r.email) };
}
