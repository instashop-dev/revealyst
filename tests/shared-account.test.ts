import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture, type LoadedFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { resolveSharedAccountSource } from "../src/lib/shared-account";

// W2-L: the dashboard's shared-account source, now backed by W2-K's real
// detector (round-the-clock / concurrency / volume-vs-median) enriched with
// display fields. The team-30d fixture's `shared-console` has an all-hours
// histogram (round-the-clock) and peakConcurrency 3 (concurrent), so it flags
// with high confidence; single-user subjects (alice, copilot, eve) and the
// signal-less svc-key do not.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let scope: ReturnType<typeof forOrg>;
let loaded: LoadedFixture;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const orgId = (await createFixtureOrg(db, "w2l-shared", "team")).id;
  loaded = await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
});

describe("resolveSharedAccountSource (W2-K detector)", () => {
  it("flags the shared account with usage-pattern reasons, and nothing else", async () => {
    const flags = await resolveSharedAccountSource().flags(scope, WINDOW);

    expect(flags).toHaveLength(1);
    const flag = flags[0];
    expect(flag.subjectId).toBe(loaded.subjects["shared-console"]);
    // Enriched display fields.
    expect(flag.vendor).toBe("anthropic_console");
    expect(flag.externalId).toBe("shared-team-login");
    expect(flag.identityCount).toBe(3);
    // W2-K detection: all-hours histogram + peakConcurrency 3.
    expect(flag.reasons.sort()).toEqual(["concurrent_usage", "round_the_clock"]);
    expect(flag.confidence).toBe("high");
  });
});
