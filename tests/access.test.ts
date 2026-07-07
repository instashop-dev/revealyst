import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import { applyPaddleSubscriptionEvent } from "../src/db/subscriptions";
import { computeAccess } from "../src/lib/access";
import { FREE_TRACKED_USER_LIMIT } from "../src/lib/entitlements";

// W3-M PR4: the DB-backed free-band gate shared by the app shell and handleApi.
// A stub scope supplies the tracked-user count so we test the wiring (plan +
// count → blocked) and the entitled short-circuit without seeding metrics.

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

function scopeReturning(n: number) {
  return {
    billing: {
      trackedUsers: async () => ({
        trackedPersonIds: Array.from({ length: n }, (_, i) => `p${i}`),
      }),
    },
  };
}

const scopeThatThrows = {
  billing: {
    trackedUsers: async () => {
      throw new Error("count query should not run for an entitled org");
    },
  },
};

describe("computeAccess", () => {
  it("blocks a free org over the limit", async () => {
    const org = await createFixtureOrg(db, "acc-over", "personal");
    const access = await computeAccess(db, scopeReturning(FREE_TRACKED_USER_LIMIT + 1), {
      id: org.id,
      kind: "personal",
    });
    expect(access.blocked).toBe(true);
  });

  it("does NOT block a free org at exactly the limit", async () => {
    const org = await createFixtureOrg(db, "acc-at", "personal");
    const access = await computeAccess(db, scopeReturning(FREE_TRACKED_USER_LIMIT), {
      id: org.id,
      kind: "personal",
    });
    expect(access.blocked).toBe(false);
  });

  it("short-circuits for a Team org — never runs the count query", async () => {
    const org = await createFixtureOrg(db, "acc-team", "personal");
    await applyPaddleSubscriptionEvent(db, {
      orgId: org.id,
      paddleSubscriptionId: "sub_acc",
      occurredAt: new Date(),
      status: "active",
      priceId: "pri_test",
      quantity: 3,
    });
    const access = await computeAccess(db, scopeThatThrows, {
      id: org.id,
      kind: "personal",
    });
    expect(access.blocked).toBe(false);
  });

  it("never blocks a system org", async () => {
    const org = await createFixtureOrg(db, "acc-sys", "personal");
    const access = await computeAccess(db, scopeThatThrows, {
      id: org.id,
      kind: "system",
    });
    expect(access.blocked).toBe(false);
  });
});
