import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { computeSharedAccountFlags } from "../src/lib/shared-account/query";

// End-to-end evidence for the exit gate: the seeded shared-account fixture
// loaded through the repo layer into PGlite, then flags computed from the
// real forOrg reads (subjects/metrics/signals) — proving the heuristics fire
// on live schema data, not just in-memory arrays. No live DB or credentials.

const fixture = JSON.parse(
  readFileSync("fixtures/metric-records/shared-account-patterns.json", "utf8"),
);

let db: Db;
let orgId: string;
let ids: Awaited<ReturnType<typeof loadFixture>>;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2k-shared", "team")).id;
  ids = await loadFixture(db, orgId, fixture);
});

describe("computeSharedAccountFlags — over the seeded fixture in PGlite", () => {
  it("fires the seeded patterns against real forOrg reads", async () => {
    const flags = await computeSharedAccountFlags(forOrg(db, orgId), {
      from: "2026-06-01",
      to: "2026-06-30",
    });

    const byId = new Map(flags.map((f) => [f.subjectId, f]));
    const flaggedKeys = new Set(
      flags.map((f) => {
        const entry = Object.entries(ids.subjects).find(([, id]) => id === f.subjectId);
        return entry?.[0];
      }),
    );

    // Exactly the five seeded shared accounts, no normal subjects.
    expect(flaggedKeys).toEqual(
      new Set([
        "shared-roundclock",
        "shared-concurrent",
        "shared-volume",
        "shared-copilot",
        "shared-power",
      ]),
    );

    // Confidence tiers survive the DB round-trip.
    expect(byId.get(ids.subjects["shared-power"])?.confidence).toBe("high");
    expect(byId.get(ids.subjects["shared-roundclock"])?.confidence).toBe("medium");
    expect(byId.get(ids.subjects["shared-volume"])?.confidence).toBe("low");

    // Copilot subject (source_granularity "none") degrades to volume only.
    expect(byId.get(ids.subjects["shared-copilot"])?.reasons).toEqual([
      "volume_exceeds_team_median",
    ]);
  });

  it("flags no normal single-user subject", async () => {
    const flags = await computeSharedAccountFlags(forOrg(db, orgId), {
      from: "2026-06-01",
      to: "2026-06-30",
    });
    const flaggedIds = new Set(flags.map((f) => f.subjectId));
    for (const key of ["alice-key", "bob-key", "carol-key"]) {
      expect(flaggedIds.has(ids.subjects[key])).toBe(false);
    }
  });
});
