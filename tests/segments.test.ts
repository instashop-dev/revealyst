import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture, type LoadedFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { resolveSegmentSource } from "../src/lib/segments";

// W2-L PR3: user segmentation over person-level adoption scores. The team-30d
// presets are team-level, so no person scores exist by default — the panel is
// honestly empty. Seeding two person-level adoption scores exercises the
// display bands and the private-mode member gating.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const PERIOD = {
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  periodGrain: "month" as const,
};
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let scope: ReturnType<typeof forOrg>;
let loaded: LoadedFixture;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const orgId = (await createFixtureOrg(db, "w2l-segments", "team")).id;
  loaded = await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
});

describe("resolveSegmentSource", () => {
  it("returns all-zero segments and every person unsegmented before any person score", async () => {
    const { segments, unsegmented } = await resolveSegmentSource().forOrg(
      scope,
      "private",
      WINDOW,
    );
    expect(segments.map((s) => s.segment)).toEqual([
      "skeptic",
      "casual",
      "power_user",
      "ai_native",
    ]);
    expect(segments.every((s) => s.count === 0)).toBe(true);
    expect(unsegmented).toBe(5); // alice, bob, carol, dave, eve
  });

  it("buckets people by their adoption score and gates members by visibility", async () => {
    const definitions = await scope.scores.definitions();
    const adoption = definitions.find(
      (d) => d.slug === "adoption" && d.status === "active",
    )!;
    await scope.scores.upsertResults([
      {
        definitionId: adoption.id,
        subjectLevel: "person",
        personId: loaded.people["alice"],
        ...PERIOD,
        value: 82, // ai_native
        attribution: "person",
        components: {},
      },
      {
        definitionId: adoption.id,
        subjectLevel: "person",
        personId: loaded.people["bob"],
        ...PERIOD,
        value: 30, // casual
        attribution: "person",
        components: {},
      },
    ]);

    const priv = await resolveSegmentSource().forOrg(scope, "private", WINDOW);
    const byName = (s: string) =>
      priv.segments.find((seg) => seg.segment === s)!;
    expect(byName("ai_native").count).toBe(1);
    expect(byName("casual").count).toBe(1);
    expect(byName("skeptic").count).toBe(0);
    expect(priv.unsegmented).toBe(3); // 5 people − 2 scored
    // Private (default): counts only, no members surfaced.
    expect(priv.segments.every((s) => s.members.length === 0)).toBe(true);

    // Full visibility surfaces pseudonymous members.
    const full = await resolveSegmentSource().forOrg(scope, "full", WINDOW);
    const aiNatives = full.segments.find((s) => s.segment === "ai_native")!;
    expect(aiNatives.members).toHaveLength(1);
    expect(aiNatives.members[0].id).toBe(loaded.people["alice"]);
  });
});
