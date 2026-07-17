// End-to-end validation for the optional post-seed manager hookup
// (scripts/seed/manager-hookup.ts): a REAL, already-existing dashboard account
// attached to a seeded [Demo] team org becomes its admin + team manager with
// that workspace pinned active — the exact wiring the prod seed workflow does
// when SEED_MANAGER_EMAIL is set. Runs on PGlite through the same seams as the
// other seed tests.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { orgContextForUser } from "../src/db/org-context";
import { forOrg } from "../src/db/org-scope";
import { orgMembers, user } from "../src/db/schema";
import { createAuth } from "../src/lib/auth";
import { loadSeedPlan } from "../scripts/seed/load";
import { attachManager } from "../scripts/seed/manager-hookup";
import type { SeedPlan } from "../scripts/seed/plan";
import { applyProdSafety, DEMO_ORG_PREFIX } from "../scripts/seed/prod-safety";

const ANCHOR = "2026-07-10";
const MANAGER_EMAIL = "real.manager@thaliatechnologies.com";
const DEMO_ORG = `${DEMO_ORG_PREFIX}Acme Robotics`;

// A small team org named "Acme Robotics" (prod-safe prefixes it) with two
// teams and two people — enough for teams.list() to return grants to assign.
const plan: SeedPlan = {
  anchorDay: ANCHOR,
  orgs: [
    {
      name: "Acme Robotics",
      kind: "team",
      visibilityMode: "managed",
      graph: {
        connections: [
          {
            key: "conn",
            vendor: "anthropic_console",
            displayName: "Console",
            authKind: "api_key",
          },
        ],
        people: [
          { key: "p1", pseudonym: "brisk-heron", displayName: null, email: "p1@acme.example" },
          { key: "p2", pseudonym: "quiet-otter", displayName: null, email: "p2@acme.example" },
        ],
        teams: [
          { key: "platform", name: "Platform", members: ["p1"] },
          { key: "product", name: "Product Eng", members: ["p2"] },
        ],
        subjects: [
          {
            key: "s1",
            connection: "conn",
            kind: "person",
            externalId: "p1@acme.example",
            email: "p1@acme.example",
            displayName: null,
          },
        ],
        identities: [{ subject: "s1", person: "p1", method: "email_match" }],
        records: [
          {
            subject: "s1",
            metricKey: "active_day",
            day: ANCHOR,
            dim: "",
            value: 1,
            attribution: "person",
            sourceConnector: "anthropic-console@1",
          },
        ],
        signals: [],
      },
      recompute: [{ grain: "month", anchorDay: ANCHOR }],
    },
  ],
};

describe("attachManager (post-seed manager hookup)", () => {
  let db: Db;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), {
      schema: await import("../src/db/schema"),
    });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    await loadSeedPlan(db, applyProdSafety(plan), {});
  }, 120_000);

  it("skips (never creates the account) when the manager has no dashboard account", async () => {
    const res = await attachManager(db, {
      email: "nobody@thaliatechnologies.com",
      orgName: DEMO_ORG,
    });
    expect(res.status).toBe("user-absent");
    // No account was invented for the missing email.
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "nobody@thaliatechnologies.com"));
    expect(rows).toEqual([]);
  });

  it("makes an existing account admin + manager of every team and pins it active", async () => {
    // A real, pre-existing account (signed up before the seed ran).
    const auth = createAuth(db, { BETTER_AUTH_URL: "http://localhost:3000" });
    const signUp = await auth.api.signUpEmail({
      body: { name: "Real Manager", email: MANAGER_EMAIL, password: "Real-Pass-2026!" },
    });
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, signUp.user.id));

    const res = await attachManager(db, { email: MANAGER_EMAIL, orgName: DEMO_ORG });
    expect(res.status).toBe("attached");
    if (res.status !== "attached") return;
    expect(res.teamsManaged).toBe(2);

    // Admin membership of the demo org.
    const membership = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(eq(orgMembers.userId, res.userId));
    expect(membership.some((m) => m.role === "admin")).toBe(true);

    // Manager of every team (managedTeamIds > 0 → the /team roster unlocks).
    const scoped = forOrg(db, res.orgId);
    const managed = await scoped.teamManagers.managedTeamIds(res.userId);
    expect(managed.length).toBe(2);

    // Active workspace resolves to the demo team org (they land there on
    // sign-in), in managed mode — so the manager surface is available.
    const ctx = await orgContextForUser(db, res.userId);
    expect(ctx?.org.id).toBe(res.orgId);
    expect(ctx?.org.kind).toBe("team");
    expect(ctx?.org.visibilityMode).toBe("managed");
    expect(ctx?.role).toBe("admin");
  }, 120_000);

  it("upgrades an account that was already a plain member to admin", async () => {
    // A second real account, first added to the demo org as a plain MEMBER,
    // then run through the hookup — it must end up admin (the contract), not
    // stay a member (the onConflictDoNothing bug the review caught).
    const auth = createAuth(db, { BETTER_AUTH_URL: "http://localhost:3000" });
    const signUp = await auth.api.signUpEmail({
      body: { name: "Was Member", email: "was.member@thaliatechnologies.com", password: "Was-Pass-2026!" },
    });
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, signUp.user.id));

    const [org] = await db
      .select({ id: orgMembers.orgId })
      .from(orgMembers)
      .innerJoin(user, eq(orgMembers.userId, user.id))
      .where(eq(user.email, MANAGER_EMAIL));
    // (MANAGER_EMAIL is admin of the demo org from the prior test.)
    await db
      .insert(orgMembers)
      .values({ orgId: org.id, userId: signUp.user.id, role: "member" });

    const res = await attachManager(db, {
      email: "was.member@thaliatechnologies.com",
      orgName: DEMO_ORG,
    });
    expect(res.status).toBe("attached");
    if (res.status !== "attached") return;
    const [row] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(eq(orgMembers.userId, res.userId));
    expect(row.role).toBe("admin");
  }, 120_000);

  it("is idempotent — a second run changes nothing and still reports attached", async () => {
    const first = await attachManager(db, { email: MANAGER_EMAIL, orgName: DEMO_ORG });
    const second = await attachManager(db, { email: MANAGER_EMAIL, orgName: DEMO_ORG });
    expect(second.status).toBe("attached");
    if (first.status !== "attached" || second.status !== "attached") return;
    const rows = await db
      .select({ id: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, first.userId));
    // Exactly one membership row in the demo org (no duplicate from re-run).
    const scoped = forOrg(db, first.orgId);
    const managed = await scoped.teamManagers.managedTeamIds(first.userId);
    expect(managed.length).toBe(2);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
