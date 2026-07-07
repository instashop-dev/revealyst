import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { latestHeartbeatAt } from "../src/db/system";

// Exercises the actual heartbeat SQL behind /api/health against a migrated
// DB — the pure evaluateHealth test can't catch a wrong column/ordering.
describe("latestHeartbeatAt", () => {
  let db: Db;
  let orgId: string;

  beforeAll(async () => {
    const pglite = drizzle(new PGlite(), { schema });
    await migrate(pglite, { migrationsFolder: "./drizzle" });
    db = pglite as unknown as Db;
    orgId = (await createFixtureOrg(db, "health-org", "team")).id;
  });

  it("returns null before any heartbeat", async () => {
    expect(await latestHeartbeatAt(db)).toBeNull();
  });

  it("returns the newest heartbeat's observed_at", async () => {
    const scope = forOrg(db, orgId);
    await scope.heartbeats.record();
    await scope.heartbeats.record();

    const latest = await latestHeartbeatAt(db);
    expect(latest).toBeInstanceOf(Date);

    // Must equal the max observed_at across the (ASC-ordered) log.
    const all = await scope.heartbeats.list();
    const newest = all[all.length - 1].observedAt;
    expect(latest?.getTime()).toBe(newest.getTime());
  });
});
