import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { SYSTEM_ORG_ID } from "../src/poller/messages";
import { ensureSystemOrg, processPollMessage } from "../src/poller/process";
import * as schema from "../src/db/schema";

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("no-op poll message", () => {
  it("creates the system org on first run and writes a heartbeat", async () => {
    await processPollMessage(db, {
      kind: "noop-poll",
      orgId: SYSTEM_ORG_ID,
    });
    const [row] = await db.select().from(schema.pollHeartbeats);
    expect(row?.orgId).toBe(SYSTEM_ORG_ID);
    expect(row?.source).toBe("noop-poller");
  });

  it("is idempotent on the system org across repeated runs", async () => {
    await ensureSystemOrg(db);
    await processPollMessage(db, { kind: "noop-poll", orgId: SYSTEM_ORG_ID });

    const orgRows = await db.select().from(schema.orgs);
    expect(orgRows.filter((o) => o.id === SYSTEM_ORG_ID)).toHaveLength(1);

    const beats = await db.select().from(schema.pollHeartbeats);
    expect(beats.length).toBeGreaterThanOrEqual(2);
  });
});
