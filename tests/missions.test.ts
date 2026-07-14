import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  type LoadedFixture,
} from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { MISSION_COPY } from "../src/lib/capability-glossary";
import {
  completedStepCount,
  isMissionComplete,
} from "../src/scoring/mission-progress";
import { recomputeCapabilityState } from "../src/scoring/recompute-capability-state";

// W7-5: missions. The seed contract, the anti-gamification schema guard,
// MEASURED completion (never a click), self-view, and un-gamified copy.

describe("mission-progress helpers (pure)", () => {
  const steps = [
    { capabilitySlug: "a", targetMastery: 0.5 },
    { capabilitySlug: "b", targetMastery: 0.4 },
  ];
  it("counts steps whose measured mastery meets the target (missing = 0)", () => {
    expect(completedStepCount(steps, new Map([["a", 0.6]]))).toBe(1); // b missing
    expect(completedStepCount(steps, new Map([["a", 0.6], ["b", 0.4]]))).toBe(2);
    expect(completedStepCount(steps, new Map([["a", 0.3]]))).toBe(0);
  });
  it("a mission is complete only when EVERY step is met", () => {
    expect(isMissionComplete(steps, new Map([["a", 0.9], ["b", 0.9]]))).toBe(true);
    expect(isMissionComplete(steps, new Map([["a", 0.9]]))).toBe(false);
    expect(isMissionComplete([], new Map())).toBe(false); // no steps → not complete
  });
});

describe("missions seed + anti-gamification schema (drizzle/0032)", () => {
  let db: Db;
  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
  });

  it("seeds the 3 starter missions and their steps", async () => {
    const missions = await db.select().from(schema.missions);
    const steps = await db.select().from(schema.missionSteps);
    expect(missions.map((m) => m.slug).sort()).toEqual([
      "delegate-to-an-agent",
      "get-started-with-ai",
      "ship-work-with-ai",
    ]);
    expect(steps).toHaveLength(4);
  });

  it("every step binds to a LIVE capability with a sane target", async () => {
    const capSlugs = new Set(
      (await db.select().from(schema.capabilities)).map((c) => c.slug),
    );
    for (const step of await db.select().from(schema.missionSteps)) {
      expect(capSlugs.has(step.capabilitySlug), step.capabilitySlug).toBe(true);
      expect(step.targetMastery).toBeGreaterThan(0);
      expect(step.targetMastery).toBeLessThanOrEqual(1);
    }
  });

  it("mission_progress has NO gamification column (Spec V4 §8.4)", () => {
    const cols = Object.keys(getTableColumns(schema.missionProgress));
    for (const banned of ["xp", "streak", "league", "points", "level", "badge"]) {
      expect(
        cols.some((c) => c.toLowerCase().includes(banned)),
        `column matching "${banned}"`,
      ).toBe(false);
    }
  });

  it("the idempotent seed is a no-op on replay", async () => {
    await migrate(db as never, { migrationsFolder: "./drizzle" });
    expect(await db.select().from(schema.missions)).toHaveLength(3);
    expect(await db.select().from(schema.missionSteps)).toHaveLength(4);
  });
});

describe("mission completion is MEASURED, never self-asserted", () => {
  const teamFixture = JSON.parse(
    readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
  );
  const AS_OF = "2026-06-15";
  let db: Db;
  let orgA: string;
  let A: LoadedFixture;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgA = (await createFixtureOrg(db, "mission-a", "team")).id;
    A = await loadFixture(db, orgA, teamFixture);
  });

  it("completes a started mission once the person's measured mastery meets its steps", async () => {
    const scoped = forOrg(db, orgA);
    // alice has active_day evidence → high ai-coding-foundations mastery, which
    // is the only step of get-started-with-ai (target 0.5).
    await scoped.missions.start(A.people.alice, "get-started-with-ai");
    // She did NOT start delegate-to-an-agent (needs agentic-delivery she lacks).
    const summary = await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });

    const progress = await scoped.missions.progressForOrg();
    const started = progress.find(
      (p) => p.personId === A.people.alice && p.missionSlug === "get-started-with-ai",
    )!;
    expect(started.completedAt).not.toBeNull(); // measured crossing completed it
    expect(summary.missionsCompleted).toBeGreaterThanOrEqual(1);
    // A mission she never started has no row — completion never fabricated.
    expect(
      progress.some((p) => p.missionSlug === "delegate-to-an-agent"),
    ).toBe(false);
  });

  it("is idempotent: a second run does not re-stamp the completion", async () => {
    const scoped = forOrg(db, orgA);
    const before = (await scoped.missions.progressForOrg()).find(
      (p) => p.missionSlug === "get-started-with-ai",
    )!.completedAt;
    await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    const after = (await scoped.missions.progressForOrg()).find(
      (p) => p.missionSlug === "get-started-with-ai",
    )!.completedAt;
    expect(after).toEqual(before); // fired exactly once
  });

  it("does NOT complete a mission whose measured steps aren't met", async () => {
    const scoped = forOrg(db, orgA);
    // bob starts delegate-to-an-agent but has no agentic-delivery mastery.
    await scoped.missions.start(A.people.bob, "delegate-to-an-agent");
    await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    const bob = (await scoped.missions.progressForOrg()).find(
      (p) => p.personId === A.people.bob && p.missionSlug === "delegate-to-an-agent",
    )!;
    expect(bob.completedAt).toBeNull(); // not met → not completed (no self-claim)
  });

  it("start is self-view-scoped and stays inside the org", async () => {
    const scoped = forOrg(db, orgA);
    // progressForOrg only returns this org's rows; a fresh org sees none.
    const orgB = (await createFixtureOrg(db, "mission-b", "team")).id;
    expect(await forOrg(db, orgB).missions.progressForOrg()).toEqual([]);
    expect((await scoped.missions.progressForOrg()).every((p) => p.personId)).toBe(true);
  });
});

describe("mission copy is un-gamified (Spec V4 §8.4)", () => {
  it("contains no points/streak/league/badge/level-up language", () => {
    const allCopy = [
      MISSION_COPY.title,
      MISSION_COPY.subtitle,
      MISSION_COPY.startAction,
      MISSION_COPY.startedToast,
      MISSION_COPY.doneBadge,
      MISSION_COPY.completeLine,
      MISSION_COPY.stepProgress(1, 2),
    ]
      .join(" ")
      .toLowerCase();
    for (const banned of ["xp", "streak", "league", "leaderboard", "points", "level up", "level-up", "badge"]) {
      expect(allCopy.includes(banned), `banned word "${banned}"`).toBe(false);
    }
  });
});
