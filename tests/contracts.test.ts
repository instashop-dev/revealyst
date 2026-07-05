import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { fixtureGraphSchema, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  apiRoutes,
  CANONICAL_METRICS,
  countTrackedUsers,
  lowestAttribution,
  METRIC_KEYS,
  personRefSchema,
} from "../src/contracts";

// The W0-C contract tests — the failing-on-drift hook W1-S inherits.
// Fixtures ⊨ zod, catalog ≡ CANONICAL_METRICS, tracked_user pure ≡ SQL.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const personalFixture = JSON.parse(
  readFileSync("fixtures/metric-records/personal-30d.json", "utf8"),
);
const scoreOracle = JSON.parse(
  readFileSync("fixtures/score-results/team-30d.json", "utf8"),
);

describe("CANONICAL_METRICS ≡ metric_catalog seed", () => {
  let db: Db;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
  });

  it("keys, families, units, and dim kinds match exactly", async () => {
    const rows = await db.select().from(schema.metricCatalog);
    expect(rows.map((r) => r.key).sort()).toEqual([...METRIC_KEYS].sort());
    for (const row of rows) {
      const entry = CANONICAL_METRICS[row.key as keyof typeof CANONICAL_METRICS];
      expect(entry, `catalog row ${row.key} missing from CANONICAL_METRICS`).toBeDefined();
      expect({ key: row.key, family: row.family, unit: row.unit, dimKind: row.dimKind })
        .toEqual({ key: row.key, family: entry.family, unit: entry.unit, dimKind: entry.dimKind });
    }
  });
});

describe("lowestAttribution (frozen propagation rule)", () => {
  it("propagates the weakest level", () => {
    expect(lowestAttribution(["person"])).toBe("person");
    expect(lowestAttribution(["person", "key_project"])).toBe("key_project");
    expect(lowestAttribution(["person", "account", "key_project"])).toBe(
      "account",
    );
    expect(lowestAttribution(["key_project", "person", "person"])).toBe(
      "key_project",
    );
  });

  it("refuses an empty input set", () => {
    expect(() => lowestAttribution([])).toThrow();
  });
});

describe("fixtures validate against the frozen contracts", () => {
  it("team-30d and personal-30d parse", () => {
    expect(fixtureGraphSchema.safeParse(teamFixture).success).toBe(true);
    expect(fixtureGraphSchema.safeParse(personalFixture).success).toBe(true);
  });

  it("score oracle is internally consistent (contribution arithmetic)", () => {
    for (const result of scoreOracle.results) {
      const components = Object.values(result.expected.components) as Array<{
        normalized: number;
        weight: number;
        contribution: number;
      }>;
      let total = 0;
      for (const c of components) {
        expect(c.contribution).toBeCloseTo(c.normalized * c.weight, 6);
        total += c.contribution;
      }
      expect(result.expected.value).toBeCloseTo(total, 6);
    }
  });

  it("a fixture using an unknown metric key fails validation", () => {
    const broken = structuredClone(teamFixture);
    broken.records[0].metricKey = "made_up_metric";
    expect(fixtureGraphSchema.safeParse(broken).success).toBe(false);
  });
});

describe("tracked_user (frozen billing primitive)", () => {
  const PERIOD = { start: "2026-06-01", end: "2026-06-30" };

  it("pure matrix: shared accounts, unresolved subjects, zero-record people", () => {
    const result = countTrackedUsers({
      identities: [
        { subjectId: "s-alice", personId: "p-alice" },
        { subjectId: "s-shared", personId: "p-bob" },
        { subjectId: "s-shared", personId: "p-carol" },
        { subjectId: "s-eve", personId: "p-eve" }, // eve: no records
        { subjectId: "s-bob-2", personId: "p-bob" }, // bob via 2nd subject
      ],
      activeSubjectDays: [
        { subjectId: "s-alice", day: "2026-06-03" },
        { subjectId: "s-shared", day: "2026-06-04" },
        { subjectId: "s-bob-2", day: "2026-06-05" },
        { subjectId: "s-svc", day: "2026-06-06" }, // no identity → unresolved
        { subjectId: "s-alice", day: "2026-05-30" }, // outside period
        { subjectId: "s-old", day: "2026-05-01" }, // outside period, unresolved
      ],
      period: PERIOD,
    });
    // Shared account = its RESOLVED identities only; bob counted once;
    // eve (zero records) excluded; svc surfaced NOT billed; May rows ignored.
    expect(result.trackedPersonIds).toEqual(["p-alice", "p-bob", "p-carol"]);
    expect(result.unresolvedSubjectIds).toEqual(["s-svc"]);
  });

  it("SQL twin agrees with the pure function on the team fixture", { timeout: 60_000 }, async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    const db = pgliteDb as unknown as Db;
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: "tracked-user-org", kind: "team" })
      .returning();
    const loaded = await loadFixture(db, org.id, teamFixture);

    const fromSql = await forOrg(db, org.id).billing.trackedUsers(PERIOD);

    // Expected from the fixture: alice (direct), bob+carol+dave (via the
    // 3-identity shared account; bob also via copilot, counted once).
    // eve has an identity but zero records; svc-key is active but
    // unresolved — surfaced, not billed.
    const expectTracked = ["alice", "bob", "carol", "dave"]
      .map((k) => loaded.people[k])
      .sort();
    expect(fromSql.trackedPersonIds).toEqual(expectTracked);
    expect(fromSql.unresolvedSubjectIds).toEqual([loaded.subjects["svc-key"]]);

    // Pure ≡ SQL on identical inputs assembled from the fixture.
    const subjectKeyOf = (recordSubject: string) => loaded.subjects[recordSubject];
    const pure = countTrackedUsers({
      identities: teamFixture.identities.map(
        (i: { subject: string; person: string }) => ({
          subjectId: loaded.subjects[i.subject],
          personId: loaded.people[i.person],
        }),
      ),
      activeSubjectDays: teamFixture.records.map(
        (r: { subject: string; day: string }) => ({
          subjectId: subjectKeyOf(r.subject),
          day: r.day,
        }),
      ),
      period: PERIOD,
    });
    expect(fromSql).toEqual(pure);
  });
});

describe("API contracts (privacy by shape)", () => {
  it("no credential-read route exists", () => {
    for (const route of Object.values(apiRoutes)) {
      const touchesCredential = route.path.includes("credential");
      if (touchesCredential) {
        expect(route.method).not.toBe("GET");
      }
    }
  });

  it("person payloads reject leaked fields (strict shape)", () => {
    const leak = personRefSchema.safeParse({
      id: "8b7f0f6e-3c1d-4a2b-9e5f-1a2b3c4d5e6f",
      pseudonym: "brisk-otter",
      displayName: null,
      email: "leak@example.com",
    });
    expect(leak.success).toBe(false);
  });

  it("every route declares a response schema", () => {
    for (const [name, route] of Object.entries(apiRoutes)) {
      expect(route.response, `${name} has no response schema`).toBeDefined();
      expect(route.path.startsWith("/api/"), `${name} path`).toBe(true);
    }
  });
});
