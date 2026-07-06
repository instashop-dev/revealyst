import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture, type LoadedFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { periodFor, recomputeOrg } from "../src/scoring";
import {
  segmentFor,
  segmentTeams,
  SEGMENT_THRESHOLDS_V1,
} from "../src/scoring/segment";

// W2-I segmentation: honesty rules mirror evaluate.ts's ratio-component
// absence handling — missing score input never gets a fabricated segment.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const oracle = JSON.parse(
  readFileSync("fixtures/score-results/team-30d.json", "utf8"),
) as {
  results: Array<{
    definitionSlug: string;
    teamKey: string;
    expected: { value: number };
  }>;
};

const JUNE = periodFor("month", "2026-06-15");

describe("segmentFor (pure, boundary values)", () => {
  it("returns null when either input is absent — never a fabricated segment", () => {
    expect(segmentFor(null, null)).toBeNull();
    expect(segmentFor(null, 80)).toBeNull();
    expect(segmentFor(80, null)).toBeNull();
  });

  it("high fluency (>= threshold) is 'ai_native' regardless of adoption", () => {
    expect(segmentFor(10, 90)).toBe("ai_native");
    expect(segmentFor(0, SEGMENT_THRESHOLDS_V1.powerUserMaxFluency)).toBe(
      "ai_native",
    );
  });

  it("low adoption (< threshold) is 'skeptic' when fluency isn't high enough for ai_native", () => {
    expect(segmentFor(10, 40)).toBe("skeptic");
    expect(segmentFor(SEGMENT_THRESHOLDS_V1.skepticMaxAdoption - 1, 0)).toBe(
      "skeptic",
    );
  });

  it("high adoption or moderately-high fluency (with mid adoption) is 'power_user'", () => {
    expect(segmentFor(70, 40)).toBe("power_user"); // adoption clears the power-user floor
    expect(segmentFor(30, 60)).toBe("power_user"); // fluency alone clears the casual ceiling
  });

  it("mid adoption and low-mid fluency is 'casual'", () => {
    expect(segmentFor(30, 30)).toBe("casual");
  });
});

describe("segmentTeams (fixture-integrated, oracle-pinned)", () => {
  let db: Db;
  let orgId: string;
  let loaded: LoadedFixture;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;

    orgId = (await createFixtureOrg(db, "segment-fixture-org", "team")).id;
    loaded = await loadFixture(db, orgId, teamFixture);

    await recomputeOrg(db, orgId, { period: JUNE });
  });

  it("classifies the 'core' team per the oracle's known adoption/fluency values", async () => {
    const oracleAdoption = oracle.results.find(
      (r) => r.definitionSlug === "adoption",
    )!.expected.value;
    const oracleFluency = oracle.results.find(
      (r) => r.definitionSlug === "fluency",
    )!.expected.value;
    expect(segmentFor(oracleAdoption, oracleFluency)).toBe("casual");

    const segments = await segmentTeams(db, orgId, {
      periodStart: JUNE.periodStart,
      periodEnd: JUNE.periodEnd,
    });
    const core = segments.find((s) => s.teamId === loaded.teams.core);
    expect(core).toBeDefined();
    expect(core!.adoption).toBeCloseTo(oracleAdoption, 4);
    expect(core!.fluency).toBeCloseTo(oracleFluency, 4);
    expect(core!.segment).toBe("casual");
  });

  it("a team with no score results yet gets no segment, not a default one", async () => {
    const empty = await forOrg(db, orgId).teams.create("empty-team");
    const segments = await segmentTeams(db, orgId, {
      periodStart: JUNE.periodStart,
      periodEnd: JUNE.periodEnd,
    });
    const emptyTeam = segments.find((s) => s.teamId === empty.id);
    expect(emptyTeam).toBeDefined();
    expect(emptyTeam!.adoption).toBeNull();
    expect(emptyTeam!.fluency).toBeNull();
    expect(emptyTeam!.segment).toBeNull();
  });
});
