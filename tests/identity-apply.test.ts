import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { applyEmailMatches } from "../src/lib/identity/apply";

// DB apply-path suite: real migrations on PGlite, the team fixture loaded
// through the repo layer, then applyEmailMatches over the frozen forOrg
// surface (rule 2). No live database or credentials.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);

let db: Db;
let orgId: string;
let ids: Awaited<ReturnType<typeof loadFixture>>;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2k-apply", "team")).id;
  ids = await loadFixture(db, orgId, teamFixture);
});

describe("applyEmailMatches — over the team fixture", () => {
  it("links nothing new when every eligible subject is already resolved", async () => {
    const scoped = forOrg(db, orgId);
    const result = await applyEmailMatches(scoped);

    // alice/eve pre-resolved (email_match), shared/copilot pre-resolved
    // (manual/vendor). Only svc-key has no identity — and it is a
    // service_account with no email, so it stays unresolved, not fabricated.
    expect(result.matches).toEqual([]);
    expect(result.unresolvedSubjectIds).toEqual([ids.subjects["svc-key"]]);
    expect(result.ambiguousSubjectIds).toEqual([]);
  });

  it("re-links a person subject after its identity is removed", async () => {
    const scoped = forOrg(db, orgId);
    const aliceSubject = ids.subjects["alice-console"];
    const alice = ids.people["alice"];

    await scoped.identities.unlink(aliceSubject, alice);
    expect(await scoped.identities.forSubject(aliceSubject)).toHaveLength(0);

    const result = await applyEmailMatches(scoped);
    expect(result.matches).toEqual([
      { subjectId: aliceSubject, personId: alice, method: "email_match" },
    ]);

    const rows = await scoped.identities.forSubject(aliceSubject);
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe("email_match");
    expect(rows[0].personId).toBe(alice);
  });

  it("is idempotent on a second run", async () => {
    const scoped = forOrg(db, orgId);
    const result = await applyEmailMatches(scoped);
    expect(result.matches).toEqual([]);
  });
});
