import { PGlite } from "@electric-sql/pglite";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { scoreComponentsSchema } from "../src/contracts/scores";

// W0-C score contracts: preset seeds validate against the frozen zod
// shapes, NULLS NOT DISTINCT upsert keys behave, the subject-shape CHECK
// holds, and results stay org-scoped. The engine itself is W1-F.

let db: Db;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db
    .insert(schema.orgs)
    .values({ name: "scores-org-a", kind: "team" })
    .returning();
  const [b] = await db
    .insert(schema.orgs)
    .values({ name: "scores-org-b", kind: "team" })
    .returning();
  orgA = a.id;
  orgB = b.id;
});

describe("preset seed", () => {
  it("seeds the three global presets, active, team-level", async () => {
    const presets = await db
      .select()
      .from(schema.scoreDefinitions)
      .where(isNull(schema.scoreDefinitions.orgId));
    expect(presets.map((p) => p.slug).sort()).toEqual([
      "adoption",
      "efficiency",
      "fluency",
    ]);
    for (const preset of presets) {
      expect(preset.version).toBe(1);
      expect(preset.status).toBe("active");
      expect(preset.subjectLevel).toBe("team");
    }
  });

  it("preset components validate against the frozen zod contract", async () => {
    const presets = await db
      .select()
      .from(schema.scoreDefinitions)
      .where(isNull(schema.scoreDefinitions.orgId));
    for (const preset of presets) {
      const parsed = scoreComponentsSchema.safeParse(preset.components);
      expect(
        parsed.success,
        `${preset.slug}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    }
    // Fluency carries the spec's three component groups.
    const fluency = presets.find((p) => p.slug === "fluency");
    const keys = (fluency?.components as { key: string }[]).map((c) => c.key);
    expect(keys.sort()).toEqual(["breadth", "depth", "effectiveness"]);
  });

  it("NULLS NOT DISTINCT: a duplicate global (slug, version) is rejected", async () => {
    await expect(
      db.insert(schema.scoreDefinitions).values({
        orgId: null,
        slug: "adoption",
        version: 1,
        name: "dup",
        subjectLevel: "team",
        components: [],
      }),
    ).rejects.toThrow();
  });

  it("definitions() returns global ∪ own-org, never another org's", async () => {
    await db.insert(schema.scoreDefinitions).values({
      orgId: orgB,
      slug: "custom-b",
      version: 1,
      name: "B custom",
      subjectLevel: "team",
      components: [],
    });
    const visible = await forOrg(db, orgA).scores.definitions();
    expect(visible.map((d) => d.slug).sort()).toEqual([
      "adoption",
      "efficiency",
      "fluency",
    ]);
    const visibleB = await forOrg(db, orgB).scores.definitions();
    expect(visibleB.map((d) => d.slug)).toContain("custom-b");
  });
});

describe("score_results shape", () => {
  let adoptionId: string;
  let teamA: string;
  let personA: string;

  beforeAll(async () => {
    const [adoption] = await db
      .select()
      .from(schema.scoreDefinitions)
      .where(isNull(schema.scoreDefinitions.orgId));
    adoptionId = adoption.id;
    teamA = (await forOrg(db, orgA).teams.create("scored-team")).id;
    personA = (await forOrg(db, orgA).people.create()).id;
  });

  it("upserts on the recompute key (org-level row, NULL subject ids)", async () => {
    const scoped = forOrg(db, orgA);
    const base = {
      definitionId: adoptionId,
      subjectLevel: "org" as const,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      periodGrain: "month" as const,
      attribution: "person" as const,
      components: {},
    };
    await scoped.scores.upsertResults([{ ...base, value: 61.5 }]);
    await scoped.scores.upsertResults([{ ...base, value: 64.25 }]); // recompute

    const rows = await scoped.scores.results({ definitionId: adoptionId });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(64.25);
  });

  it("enforces exactly-one-subject-per-level (CHECK)", async () => {
    const scoped = forOrg(db, orgA);
    const base = {
      definitionId: adoptionId,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      periodGrain: "month" as const,
      value: 50,
      attribution: "person" as const,
      components: {},
    };
    // person-level with a team id → rejected
    await expect(
      scoped.scores.upsertResults([
        { ...base, subjectLevel: "person", personId: personA, teamId: teamA },
      ]),
    ).rejects.toThrow();
    // org-level with a person id → rejected
    await expect(
      scoped.scores.upsertResults([
        { ...base, subjectLevel: "org", personId: personA },
      ]),
    ).rejects.toThrow();
    // team-level with a team id → accepted
    await scoped.scores.upsertResults([
      { ...base, subjectLevel: "team", teamId: teamA },
    ]);
  });

  it("rejects cross-org subject references (composite FKs)", async () => {
    const personB = await forOrg(db, orgB).people.create();
    await expect(
      forOrg(db, orgA).scores.upsertResults([
        {
          definitionId: adoptionId,
          subjectLevel: "person",
          personId: personB.id,
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          periodGrain: "month",
          value: 10,
          attribution: "person",
          components: {},
        },
      ]),
    ).rejects.toThrow();
  });

  it("results() never returns another org's rows", async () => {
    const rowsB = await forOrg(db, orgB).scores.results({});
    expect(rowsB).toHaveLength(0);
  });
});

describe("component contract guards (tripwire: not a DSL)", () => {
  it("rejects weights that do not sum to 1", () => {
    const parsed = scoreComponentsSchema.safeParse([
      {
        key: "only",
        metric: "active_day",
        aggregation: "sum",
        weight: 0.5,
        normalization: { min: 0, max: 10 },
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown aggregations (closed vocabulary)", () => {
    const parsed = scoreComponentsSchema.safeParse([
      {
        key: "evil",
        metric: "active_day",
        aggregation: "eval(x)",
        weight: 1,
        normalization: { min: 0, max: 10 },
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate component keys", () => {
    const component = {
      key: "dup",
      metric: "active_day",
      aggregation: "sum",
      weight: 0.5,
      normalization: { min: 0, max: 10 },
    };
    const parsed = scoreComponentsSchema.safeParse([component, component]);
    expect(parsed.success).toBe(false);
  });
});
