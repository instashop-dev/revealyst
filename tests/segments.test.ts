import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture, type LoadedFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  championSegment,
  resolveSegmentSource,
  SEGMENT_MIN_PEOPLE_TO_NAME,
  type SegmentDistribution,
} from "../src/lib/segments";

// W2-L PR3: user segmentation over person-level adoption scores. The team-30d
// presets are team-level, so no person scores exist by default — the panel is
// honestly empty. Seeding person-level adoption scores exercises the display
// bands. W5-H (errata §1.2 (5)): segments are COUNT-ONLY in every visibility
// mode — members are never surfaced, and a champion band is only named above
// the SEGMENT_MIN_PEOPLE_TO_NAME de-anonymization floor.

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

  it("buckets people by adoption score and stays count-only in EVERY mode", async () => {
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
    expect(priv.segments.every((s) => s.members.length === 0)).toBe(true);

    // Errata §1.2 (5): full/managed visibility is ALSO count-only — a
    // personality label is never attached to a name on a team surface.
    for (const mode of ["managed", "full"] as const) {
      const view = await resolveSegmentSource().forOrg(scope, mode, WINDOW);
      expect(view.segments.every((s) => s.members.length === 0)).toBe(true);
      // Counts are unchanged by mode — pseudonymity is not erasure.
      expect(view.segments.find((s) => s.segment === "ai_native")!.count).toBe(1);
    }
  });
});

describe("championSegment (de-anonymization floor)", () => {
  const dist = (counts: Partial<Record<string, number>>): SegmentDistribution => ({
    segments: [
      { segment: "skeptic", label: "Skeptics", count: counts.skeptic ?? 0, members: [] },
      { segment: "casual", label: "Casual", count: counts.casual ?? 0, members: [] },
      { segment: "power_user", label: "Power Users", count: counts.power_user ?? 0, members: [] },
      { segment: "ai_native", label: "AI Natives", count: counts.ai_native ?? 0, members: [] },
    ],
    unsegmented: 0,
  });

  it("returns null below the naming floor (a lone bucket occupant is de-anonymizing)", () => {
    expect(SEGMENT_MIN_PEOPLE_TO_NAME).toBe(4);
    // 3 segmented people < floor → no champion named at all.
    expect(championSegment(dist({ ai_native: 1, casual: 2 }))).toBeNull();
  });

  it("names the most-advanced populated band once the floor is met", () => {
    const champ = championSegment(dist({ ai_native: 2, power_user: 2, casual: 1 }));
    expect(champ?.segment).toBe("ai_native");
    // Still count-only — naming a band never surfaces members.
    expect(champ?.members).toHaveLength(0);
  });

  it("falls back to the next band down when the top is empty", () => {
    const champ = championSegment(dist({ power_user: 3, casual: 2 }));
    expect(champ?.segment).toBe("power_user");
  });
});
