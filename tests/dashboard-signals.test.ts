import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { readToolCoverage } from "../src/lib/dashboard-read";
import { readActivityHeatmap } from "../src/lib/dashboard-signals";

// W2-L PR2: the activity heatmap and tool-coverage reads over the team-30d
// fixture. The fixture seeds three signal rows — two with hour histograms
// (alice 2026-06-03 Wed, shared 2026-06-04 Thu) and one with none
// (copilot-bob, sourceGranularity 'none') — so the honesty omission is tested.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };

// Sums from the fixture histograms.
const ALICE_HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 5, 2, 0, 3, 4, 5, 2, 0, 0, 0, 0, 0, 0];
const SHARED_HOURS = [3, 2, 4, 3, 2, 3, 4, 5, 6, 5, 4, 5, 6, 5, 4, 5, 6, 5, 4, 3, 4, 3, 2, 3];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

let db: Db;
let scope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const orgId = (await createFixtureOrg(db, "w2l-signals", "team")).id;
  await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
});

describe("readActivityHeatmap", () => {
  it("aggregates hour histograms into a weekday × hour grid, omitting no-signal days", async () => {
    const heatmap = await readActivityHeatmap(scope, WINDOW);

    // Two subject-days had intra-day data; copilot-bob's 'none' row is omitted.
    expect(heatmap.daysWithSignals).toBe(2);
    expect(heatmap.daysWithoutSubDaily).toBe(1);
    // Peak concurrency is the max over contributing rows (alice 1, shared 3).
    expect(heatmap.peakConcurrency).toBe(3);

    // 2026-06-03 is a Wednesday (Mon-indexed 2); 2026-06-04 a Thursday (3).
    expect(sum(heatmap.grid[2])).toBe(sum(ALICE_HOURS));
    expect(sum(heatmap.grid[3])).toBe(sum(SHARED_HOURS));
    expect(heatmap.grid[2][9]).toBe(4); // alice hour 09 = 4
    expect(heatmap.grid[3][0]).toBe(3); // shared hour 00 = 3

    // Every other weekday is empty — absence, not a fabricated row.
    for (const weekday of [0, 1, 4, 5, 6]) {
      expect(sum(heatmap.grid[weekday])).toBe(0);
    }
  });
});

describe("readToolCoverage", () => {
  it("lists connected vendors and the distinct features in use", async () => {
    const coverage = await readToolCoverage(scope, WINDOW);

    expect(coverage.connections.map((c) => c.vendor).sort()).toEqual([
      "anthropic_console",
      "github_copilot",
    ]);
    // Distinct feature_used dims: chat_panel, mcp (anthropic) + completions (copilot).
    expect(coverage.features).toEqual([
      "feature=chat_panel",
      "feature=completions",
      "feature=mcp",
    ]);
  });
});
