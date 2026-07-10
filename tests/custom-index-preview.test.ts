import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { previewCustomIndex } from "../src/lib/custom-index-impl";

// Preview honesty (§8.5 preview requirement + invariant b): the read-only
// preview runs the SAME evaluate path as recompute, so a ratio component with
// data on only one side is OMITTED (never floored to 0), and a definition with
// no data at all yields no entry (never a fabricated zero).

// previewCustomIndex anchors on rolling-28d ending "yesterday"; freeze now so
// the seeded June rows fall inside the window.
const NOW = new Date("2026-06-30T00:00:00Z");
const DAY_A = "2026-06-10";
const DAY_B = "2026-06-11";

let db: Db;
let orgId: string;

async function seedSubject() {
  const scope = forOrg(db, orgId);
  const connection = await scope.connections.create({
    vendor: "openai",
    displayName: "OpenAI",
    authKind: "admin_key",
  });
  const [subject] = await scope.subjects.upsertMany(connection.id, [
    { kind: "account", externalId: "acct-1" },
  ]);
  return { connectionId: connection.id, subjectId: subject.id };
}

async function insertRecord(
  ids: { connectionId: string; subjectId: string },
  metricKey: string,
  day: string,
  value: number,
) {
  await forOrg(db, orgId).metrics.upsertRecords([
    {
      subjectId: ids.subjectId,
      connectionId: ids.connectionId,
      metricKey,
      day,
      value,
      attribution: "account",
      sourceConnector: "openai@1",
    },
  ]);
}

beforeEach(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "preview-org", "team")).id;
});

describe("previewCustomIndex", () => {
  it("scores an org-level single-metric index against recent data", async () => {
    const ids = await seedSubject();
    await insertRecord(ids, "active_day", DAY_A, 1);
    await insertRecord(ids, "active_day", DAY_B, 1);

    const preview = await previewCustomIndex(
      forOrg(db, orgId),
      {
        subjectLevel: "org",
        components: [
          {
            key: "depth",
            metric: "active_day",
            aggregation: "active_days",
            weight: 1,
            normalization: { min: 0, max: 20 },
          },
        ],
      },
      NOW,
    );

    expect(preview.subjectLevel).toBe("org");
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].label).toBe("Whole organization");
    // 2 active days / 20 = 10/100 × weight 1.
    expect(preview.entries[0].result.value).toBeCloseTo(10, 4);
  });

  it("omits a ratio component with data on only one side (never floors to 0)", async () => {
    const ids = await seedSubject();
    await insertRecord(ids, "active_day", DAY_A, 1);
    await insertRecord(ids, "active_day", DAY_B, 1);
    // Numerator present, denominator absent → ratio must be omitted.
    await insertRecord(ids, "suggestions_accepted", DAY_A, 40);

    const preview = await previewCustomIndex(
      forOrg(db, orgId),
      {
        subjectLevel: "org",
        components: [
          {
            key: "depth",
            metric: "active_day",
            aggregation: "active_days",
            weight: 0.5,
            normalization: { min: 0, max: 20 },
          },
          {
            key: "acceptance",
            ratio: {
              numerator: { metric: "suggestions_accepted", aggregation: "sum" },
              denominator: { metric: "suggestions_offered", aggregation: "sum" },
            },
            weight: 0.5,
            normalization: { min: 0, max: 1 },
          },
        ],
      },
      NOW,
    );

    expect(preview.entries).toHaveLength(1);
    const breakdown = preview.entries[0].result.components;
    // Honesty: the plain component is present; the one-sided ratio is OMITTED
    // from the breakdown entirely, not scored as 0.
    expect(Object.keys(breakdown)).toContain("depth");
    expect(Object.keys(breakdown)).not.toContain("acceptance");
    // Value reflects only the present component (depth: 10 × 0.5 = 5), never a
    // fabricated ratio contribution.
    expect(preview.entries[0].result.value).toBeCloseTo(5, 4);
  });

  it("returns no entries when there is no recent data (never a zero score)", async () => {
    await seedSubject(); // subject exists, but no metric rows
    const preview = await previewCustomIndex(
      forOrg(db, orgId),
      {
        subjectLevel: "org",
        components: [
          {
            key: "depth",
            metric: "active_day",
            aggregation: "active_days",
            weight: 1,
            normalization: { min: 0, max: 20 },
          },
        ],
      },
      NOW,
    );
    expect(preview.entries).toHaveLength(0);
  });
});
