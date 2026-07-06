import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { readScoreTrends } from "../src/lib/dashboard-trends";
import { periodFor, recomputeOrg } from "../src/scoring";

// W2-L PR2: score trends grouped by preset slug. The fixture spans one month,
// so each preset has a single point — the trend renders a point, never an
// invented line. A second period proves chronological grouping.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const JUNE = periodFor("month", "2026-06-15");
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let orgId: string;
let scope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2l-trends", "team")).id;
  await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
  await recomputeOrg(db, orgId, { period: JUNE });
});

describe("readScoreTrends", () => {
  it("returns one series per preset in slug order", async () => {
    const trends = await readScoreTrends(scope, WINDOW);
    expect(trends.map((t) => t.slug)).toEqual([
      "adoption",
      "fluency",
      "efficiency",
    ]);
    for (const trend of trends) {
      expect(trend.points).toHaveLength(1);
    }
    const adoption = trends.find((t) => t.slug === "adoption");
    expect(adoption!.points[0].value).toBe(47.5);
    expect(adoption!.points[0].periodEnd).toBe("2026-06-30");
  });
});
