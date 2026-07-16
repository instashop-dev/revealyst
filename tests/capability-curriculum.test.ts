import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import * as schema from "../src/db/schema";
import {
  CAPABILITY_CURRICULUM,
  CAPABILITY_CURRICULUM_COPY,
  CAPABILITY_CURRICULUM_ORDER,
} from "../src/lib/capability-curriculum";
import { CAPABILITY_PROFILE_COPY, MISSION_COPY } from "../src/lib/capability-glossary";

// T4.1 (GJ-007): the curriculum module. Two contracts — completeness against
// the LIVE seed (mirrors tests/capability-catalog.test.ts's migrated-PGlite
// idiom, not a hardcoded slug list, so a future capability-graph change fails
// this test instead of silently shipping an incomplete drawer) — and an
// LMS/anti-gamification banned-phrasing sweep (NOT-019 + Spec V4 §8.4).

let db: Db;
let seededSlugs: string[];

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const caps = await db
    .select({ slug: schema.capabilities.slug, isActive: schema.capabilities.isActive })
    .from(schema.capabilities);
  seededSlugs = caps.filter((c) => c.isActive).map((c) => c.slug);
});

describe("CAPABILITY_CURRICULUM completeness", () => {
  it("has an entry for every active seeded capability slug", () => {
    expect(seededSlugs.length).toBeGreaterThan(0);
    for (const slug of seededSlugs) {
      expect(CAPABILITY_CURRICULUM[slug], `missing curriculum for "${slug}"`).toBeTruthy();
    }
  });

  it("CAPABILITY_CURRICULUM_ORDER is exactly the seeded active slug set", () => {
    expect([...CAPABILITY_CURRICULUM_ORDER].sort()).toEqual([...seededSlugs].sort());
  });

  it("every entry has a non-empty summary and at least one howTo/tryThis item", () => {
    for (const slug of CAPABILITY_CURRICULUM_ORDER) {
      const entry = CAPABILITY_CURRICULUM[slug];
      expect(entry.summary.trim().length, `${slug} summary`).toBeGreaterThan(0);
      expect(entry.howTo.length, `${slug} howTo`).toBeGreaterThan(0);
      expect(entry.tryThis.length, `${slug} tryThis`).toBeGreaterThan(0);
    }
  });
});

describe("curriculum copy is not an LMS and not gamified (NOT-019, Spec V4 §8.4)", () => {
  it("contains no course/lesson/module/certification or XP/streak/badge/points language", () => {
    const allCopy = [
      ...Object.values(CAPABILITY_CURRICULUM).flatMap((e) => [
        e.summary,
        ...e.howTo,
        ...e.tryThis,
      ]),
      ...Object.values(CAPABILITY_CURRICULUM_COPY),
    ]
      .join(" ")
      .toLowerCase();

    const bannedSubstrings = [
      "course",
      "certification",
      "lesson ", // trailing space avoids flagging words like "lessons-learned" mid-token
      "module 1",
      "module 2",
      "module n",
      "streak",
      "badge",
      "leaderboard",
      "league",
      "level up",
      "level-up",
    ];
    for (const word of bannedSubstrings) {
      expect(allCopy.includes(word), `banned word "${word}"`).toBe(false);
    }
    // Word-boundary checks for short/ambiguous tokens that otherwise false-
    // positive inside ordinary words ("xp" inside "expect"/"explain", "points"
    // inside "appointments" etc.).
    for (const word of ["xp", "points"]) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      expect(re.test(allCopy), `banned word "${word}" (word boundary)`).toBe(false);
    }
  });

  it("existing anti-gamification copy stays green alongside the new sweep (regression guard)", () => {
    const allCopy = [
      MISSION_COPY.title,
      MISSION_COPY.subtitle,
      MISSION_COPY.startAction,
      MISSION_COPY.startedToast,
      MISSION_COPY.doneBadge,
      MISSION_COPY.completeLine,
      MISSION_COPY.stepProgress(1, 2),
      CAPABILITY_PROFILE_COPY.title,
      CAPABILITY_PROFILE_COPY.subtitle,
      CAPABILITY_PROFILE_COPY.nextLead,
    ]
      .join(" ")
      .toLowerCase();
    for (const word of ["xp", "streak", "league", "leaderboard", "points", "badge", "course", "certification"]) {
      expect(allCopy.includes(word), `banned word "${word}"`).toBe(false);
    }
  });
});
