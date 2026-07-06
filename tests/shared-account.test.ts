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

// W2-L PR3: the shared-account flag adapter. The team-30d fixture seeds one
// shared account — `shared-console`, linked to bob + carol + dave (3
// identities). Single-identity subjects (alice-console, copilot-bob,
// eve-console) and the unresolved svc-key (0 links) must NOT flag.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);

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

describe("resolveSharedAccountSource", () => {
  it("flags the shared account and nothing else", async () => {
    const flags = await resolveSharedAccountSource().flags(scope);

    expect(flags).toHaveLength(1);
    const flag = flags[0];
    expect(flag.subjectId).toBe(loaded.subjects["shared-console"]);
    expect(flag.identityCount).toBe(3);
    expect(flag.vendor).toBe("anthropic_console");
    expect(flag.externalId).toBe("shared-team-login");
  });
});
