import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import { shareLinksForOrg } from "../src/db/share-links";
import * as schema from "../src/db/schema";
import { fixtureBenchmarkSource } from "../src/lib/benchmarks/fixture";

// §8.5 guardrail 2 — no fabricated comparability: a custom index is NEVER
// shareable and NEVER gets a benchmark comparison. Both surfaces are tested
// here; the benchmark surface is safe by omission, the share surface by an
// explicit reject.

describe("share cards exclude custom indexes", () => {
  let db: Db;
  let orgId: string;
  let personId: string;

  beforeEach(async () => {
    const pglite = drizzle(new PGlite(), { schema });
    await migrate(pglite, { migrationsFolder: "./drizzle" });
    db = pglite as unknown as Db;
    orgId = (await createFixtureOrg(db, "share-org", "team")).id;
    const person = await forOrg(db, orgId).people.create({ displayName: "Ada" });
    personId = person.id;
  });

  it("rejects a custom slug at the db factory (defense in depth)", async () => {
    await expect(
      shareLinksForOrg(db, orgId).create({
        personId,
        scoreSlug: "custom-velocity",
        publicLabel: "My velocity",
      }),
    ).rejects.toThrow(/custom indexes are not shareable/i);
  });

  it("still allows a preset slug to be shared", async () => {
    const { token } = await shareLinksForOrg(db, orgId).create({
      personId,
      scoreSlug: "fluency",
      publicLabel: "My fluency",
    });
    expect(typeof token).toBe("string");
  });
});

describe("benchmark panel excludes custom indexes", () => {
  it("returns no benchmark row for a custom slug (omit, never invent)", () => {
    const summaries = fixtureBenchmarkSource.forScores([
      { slug: "custom-velocity", value: 80 },
    ]);
    expect(summaries).toHaveLength(0);
  });

  it("still returns a benchmark row for a preset slug", () => {
    const summaries = fixtureBenchmarkSource.forScores([
      { slug: "adoption", value: 60 },
    ]);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].slug).toBe("adoption");
  });
});
