import { PGlite } from "@electric-sql/pglite";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { getBenchmark, listBenchmarks } from "../src/db/benchmarks";
import type { Db } from "../src/db/client";
import * as schema from "../src/db/schema";

// W2-I: published-benchmark seed rows. Global reference data (no org_id),
// same exception as metric_catalog — real migrations against PGlite (rule 2).

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("benchmarks table shape", () => {
  it("has no org_id column (global reference data, like metric_catalog)", () => {
    expect("orgId" in getTableColumns(schema.benchmarks)).toBe(false);
  });

  it("defaults status to 'draft' and value_unit to 'normalized_0_100'", async () => {
    const [row] = await db
      .insert(schema.benchmarks)
      .values({
        scoreSlug: "test_score",
        metricLabel: "test row",
        sourceName: "test",
      })
      .returning();
    expect(row.status).toBe("draft");
    expect(row.valueUnit).toBe("normalized_0_100");
    expect(row.segment).toBe("overall");
  });
});

describe("benchmark seed data", () => {
  it("seeds exactly the three placeholder rows, all status='draft'", async () => {
    const rows = await db
      .select()
      .from(schema.benchmarks)
      .where(eq(schema.benchmarks.sourceName, "GitHub Copilot"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scoreSlug: "fluency",
      componentKey: "effectiveness",
      valueUnit: "percent",
      status: "draft",
    });
    expect(rows[0].notes).toMatch(/needs founder-verified/i);
  });

  it("seeds an overall and an enterprise adoption range, both draft", async () => {
    const rows = await db
      .select()
      .from(schema.benchmarks)
      .where(eq(schema.benchmarks.scoreSlug, "adoption"));
    expect(rows).toHaveLength(2);
    const segments = rows.map((r) => r.segment).sort();
    expect(segments).toEqual(["enterprise", "overall"]);
    for (const row of rows) {
      expect(row.status).toBe("draft");
      expect(row.rangeLow).not.toBeNull();
      expect(row.rangeHigh).not.toBeNull();
    }
  });

  it("nothing is 'verified' yet — panels must not surface unverified figures", async () => {
    const verified = await db
      .select()
      .from(schema.benchmarks)
      .where(eq(schema.benchmarks.status, "verified"));
    expect(verified).toHaveLength(0);
  });
});

describe("listBenchmarks / getBenchmark query module", () => {
  it("filters by scoreSlug", async () => {
    const rows = await listBenchmarks(db, { scoreSlug: "adoption" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scoreSlug === "adoption")).toBe(true);
  });

  it("filters by componentKey", async () => {
    const rows = await listBenchmarks(db, {
      scoreSlug: "fluency",
      componentKey: "effectiveness",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceName).toBe("GitHub Copilot");
  });

  it("filters by segment", async () => {
    const rows = await listBenchmarks(db, {
      scoreSlug: "adoption",
      segment: "enterprise",
    });
    expect(rows).toHaveLength(1);
  });

  it("filtering to status='verified' returns nothing — honest, nothing is verified yet", async () => {
    const rows = await listBenchmarks(db, { status: "verified" });
    expect(rows).toHaveLength(0);
  });

  it("with no filter returns all rows", async () => {
    const rows = await listBenchmarks(db);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("getBenchmark returns a single row by id, or undefined if absent", async () => {
    const [seeded] = await listBenchmarks(db, { scoreSlug: "adoption" });
    const found = await getBenchmark(db, seeded.id);
    expect(found?.id).toBe(seeded.id);
    expect(
      await getBenchmark(db, "00000000-0000-0000-0000-000000000000"),
    ).toBeUndefined();
  });
});
