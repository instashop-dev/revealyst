// Prod-safety transform + teardown for the demo seed (scripts/seed/
// prod-safety.ts, scripts/seed/teardown.ts). The full-plan end-to-end pass
// lives in tests/seed-demo.test.ts; this suite covers the two pieces that
// guard PRODUCTION: the safety transform's invariants (pure, full plan) and
// a DB round-trip on a minimal plan proving teardown removes exactly the
// demo footprint and nothing else.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { orgs, user } from "../src/db/schema";
import { buildDemoSeedPlan } from "../scripts/seed/activity";
import { loadSeedPlan } from "../scripts/seed/load";
import type { SeedPlan } from "../scripts/seed/plan";
import { applyProdSafety, DEMO_ORG_PREFIX } from "../scripts/seed/prod-safety";
import { teardownDemoData } from "../scripts/seed/teardown";

const ANCHOR = "2026-07-10";

describe("applyProdSafety (pure transform, full plan)", () => {
  const base = buildDemoSeedPlan(ANCHOR);
  const safe = applyProdSafety(base);

  it("prefixes every org name and drops the global benchmark flip", () => {
    expect(safe.verifyBenchmark).toBeUndefined();
    expect(base.verifyBenchmark).toBeDefined();
    for (const org of safe.orgs) {
      expect(org.name.startsWith(DEMO_ORG_PREFIX)).toBe(true);
    }
  });

  it("randomizes passwords, strips platformAdmin, keeps users otherwise", () => {
    const baseUsers = base.orgs.flatMap((o) => o.users ?? []);
    const safeUsers = safe.orgs.flatMap((o) => o.users ?? []);
    expect(safeUsers.length).toBe(baseUsers.length);
    expect(baseUsers.some((u) => u.platformAdmin)).toBe(true);
    for (const [i, u] of safeUsers.entries()) {
      expect(u.platformAdmin).toBe(false);
      expect(u.password).not.toBe(baseUsers[i]!.password);
      expect(u.password.length).toBeGreaterThanOrEqual(64);
      expect(u.email).toBe(baseUsers[i]!.email);
    }
    // Randomness is per-call — two transforms must not agree on passwords.
    const again = applyProdSafety(base).orgs.flatMap((o) => o.users ?? []);
    expect(again[0]!.password).not.toBe(safeUsers[0]!.password);
  });

  it("strips share links (public /s/ pages must never claim fabricated data)", () => {
    expect(base.orgs.some((o) => (o.shareLinks?.length ?? 0) > 0)).toBe(true);
    for (const org of safe.orgs) {
      expect(org.shareLinks).toBeUndefined();
    }
  });

  it("forces subscriptions to past_due (entitling, never metered) only", () => {
    expect(
      base.orgs.some((o) => o.subscription?.status === "active"),
    ).toBe(true);
    for (const org of safe.orgs) {
      if (org.subscription) {
        expect(org.subscription.status).toBe("past_due");
      }
    }
    // Base plan untouched (transform returns a new plan).
    expect(base.orgs.some((o) => o.subscription?.status === "active")).toBe(
      true,
    );
  });
});

describe("teardownDemoData (DB round-trip, minimal plan)", () => {
  let db: Db;

  // One-org plan shaped like the real one: an auth user (whose signup
  // side-effect org must also be swept), a subscription, and a tiny graph.
  const miniPlan: SeedPlan = {
    anchorDay: ANCHOR,
    orgs: [
      {
        name: "Teardown Probe Org",
        kind: "team",
        users: [
          {
            key: "probe-admin",
            name: "Probe Admin",
            email: "probe-admin@teardown.example",
            password: "Probe-Pass-2026!",
            orgRole: "admin",
          },
        ],
        graph: {
          connections: [
            {
              key: "conn",
              vendor: "anthropic_console",
              displayName: "Probe Console",
              authKind: "api_key",
            },
          ],
          people: [
            {
              key: "p1",
              pseudonym: "probe-heron",
              displayName: null,
              email: "p1@teardown.example",
            },
          ],
          teams: [{ key: "t1", name: "Probe Team", members: ["p1"] }],
          subjects: [
            {
              key: "s1",
              connection: "conn",
              kind: "person",
              externalId: "p1@teardown.example",
              email: "p1@teardown.example",
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
        subscription: { status: "past_due", quantity: 1 },
        recompute: [{ grain: "month", anchorDay: ANCHOR }],
      },
    ],
  };

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), {
      schema: await import("../src/db/schema"),
    });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
  }, 120_000);

  it("removes ONLY the demo footprint — a real org sharing the base name survives", async () => {
    const survivor = await createFixtureOrg(db, "Real Customer Org", "team");
    // The adversarial-review scenario: a REAL org whose name collides
    // exactly with a demo base name. Default teardown must never touch it.
    const collision = await createFixtureOrg(db, "Teardown Probe Org", "team");
    await loadSeedPlan(db, applyProdSafety(miniPlan), {});

    const before = await db.select({ name: orgs.name }).from(orgs);
    expect(before.map((o) => o.name).sort()).toEqual(
      [
        "Probe Admin", // signup side-effect org-of-one
        "Real Customer Org",
        "Teardown Probe Org", // the collision org
        "[Demo] Teardown Probe Org",
      ].sort(),
    );

    const summary = await teardownDemoData(db, miniPlan);
    expect(summary.orgsDeleted.map((o) => o.name).sort()).toEqual(
      ["Probe Admin", "[Demo] Teardown Probe Org"].sort(),
    );
    expect(summary.usersDeleted).toEqual(["probe-admin@teardown.example"]);

    const after = await db.select({ name: orgs.name }).from(orgs);
    expect(after.map((o) => o.name).sort()).toEqual(
      ["Real Customer Org", "Teardown Probe Org"].sort(),
    );
    expect(await db.select().from(user)).toEqual([]);

    // Idempotent: a second teardown matches nothing.
    const again = await teardownDemoData(db, miniPlan);
    expect(again.orgsDeleted).toEqual([]);
    expect(again.usersDeleted).toEqual([]);

    // Local-db opt-in DOES remove the unprefixed base name — the mode the
    // prod workflow never sets.
    const unprefixed = await teardownDemoData(db, miniPlan, {
      includeUnprefixed: true,
    });
    expect(unprefixed.orgsDeleted.map((o) => o.name)).toEqual([
      "Teardown Probe Org",
    ]);
    expect(
      (await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, collision.id))).length,
    ).toBe(0);

    // Survivor untouched through everything.
    const [row] = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.id, survivor.id));
    expect(row).toBeDefined();
  }, 120_000);
});
