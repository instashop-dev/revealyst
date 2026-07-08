import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { loadFixture } from "../src/db/fixtures";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { dashboardSummary } from "../src/lib/api-impl";
import { periodFor, recomputeOrg } from "../src/scoring";

// ADR 0014: a personal org renders subjectLevel='person' scores, but the global
// presets (drizzle/0009) are team-level and a personal org has no teams. The
// signup bootstrap (ensureOrgOfOne) clones the global team presets into
// org-scoped person-level definitions so a real personal org can actually
// produce scores — the gap that left the founder's dashboard blank. Real
// migrations against PGlite (rule 2), including the 0017 backfill.

const SLUGS = ["adoption", "fluency", "efficiency"] as const;

const personalFixture = JSON.parse(
  readFileSync("fixtures/metric-records/personal-30d.json", "utf8"),
);
const JUNE = periodFor("month", "2026-06-15");
const RANGE = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let userSeq = 0;

async function createAuthUser() {
  const id = `preset-user-${++userSeq}`;
  const email = `preset-${userSeq}@example.com`;
  await db.insert(schema.user).values({ id, name: `User ${userSeq}`, email });
  return { id, name: `User ${userSeq}`, email };
}

async function personDefs(orgId: string) {
  const defs = await forOrg(db, orgId).scores.definitions();
  return defs.filter((d) => d.subjectLevel === "person" && d.orgId === orgId);
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("ensureOrgOfOne seeds person-level presets (ADR 0014)", () => {
  it("gives a new personal org three org-scoped person definitions", async () => {
    const { orgId } = await ensureOrgOfOne(db, await createAuthUser());
    const mine = await personDefs(orgId);
    expect(mine.map((d) => d.slug).sort()).toEqual([...SLUGS].sort());
    for (const d of mine) {
      expect(d.status).toBe("active");
      expect(d.version).toBe(1);
    }
  });

  it("clones the global team presets verbatim (components + name unchanged)", async () => {
    const { orgId } = await ensureOrgOfOne(db, await createAuthUser());
    const globals = await db
      .select()
      .from(schema.scoreDefinitions)
      .where(
        and(
          isNull(schema.scoreDefinitions.orgId),
          eq(schema.scoreDefinitions.subjectLevel, "team"),
        ),
      );
    const mine = await personDefs(orgId);
    for (const slug of SLUGS) {
      const team = globals.find((d) => d.slug === slug)!;
      const person = mine.find((d) => d.slug === slug)!;
      expect(person.name).toBe(team.name);
      expect(person.version).toBe(team.version);
      expect(person.components).toEqual(team.components);
    }
  });

  it("keeps person defs org-scoped — no leakage across orgs", async () => {
    const a = (await ensureOrgOfOne(db, await createAuthUser())).orgId;
    const b = (await ensureOrgOfOne(db, await createAuthUser())).orgId;
    const bDefs = await forOrg(db, b).scores.definitions();
    // B never sees A's org-scoped person rows; it only sees the globals + its own.
    expect(bDefs.some((d) => d.orgId === a)).toBe(false);
    expect((await personDefs(b)).map((d) => d.slug).sort()).toEqual(
      [...SLUGS].sort(),
    );
  });

  it("is idempotent — a re-run doesn't duplicate person defs", async () => {
    const user = await createAuthUser();
    const { orgId } = await ensureOrgOfOne(db, user);
    await ensureOrgOfOne(db, user);
    await ensureOrgOfOne(db, user);
    expect(await personDefs(orgId)).toHaveLength(3);
  });
});

describe("backfill migration 0017 (pre-existing personal orgs)", () => {
  // The migration ran on an empty orgs table in beforeAll (no-op). Re-run the
  // idempotent statement after orgs exist to prove it clones for a personal org
  // that predated the migration — and leaves team orgs untouched.
  const backfillSql = readFileSync(
    "drizzle/0017_seed-personal-person-presets.sql",
    "utf8",
  );

  it("clones for personal orgs only, not team orgs", async () => {
    const [personal] = await db
      .insert(schema.orgs)
      .values({ name: "pre-existing personal", kind: "personal" })
      .returning();
    const [team] = await db
      .insert(schema.orgs)
      .values({ name: "pre-existing team", kind: "team" })
      .returning();

    await db.execute(sql.raw(backfillSql));

    expect((await personDefs(personal.id)).map((d) => d.slug).sort()).toEqual(
      [...SLUGS].sort(),
    );
    expect(await personDefs(team.id)).toHaveLength(0);
  });

  it("is idempotent — re-running adds no duplicates", async () => {
    const [personal] = await db
      .insert(schema.orgs)
      .values({ name: "idempotent personal", kind: "personal" })
      .returning();
    await db.execute(sql.raw(backfillSql));
    await db.execute(sql.raw(backfillSql));
    expect(await personDefs(personal.id)).toHaveLength(3);
  });
});

describe("seeded defs actually produce scores (end-to-end)", () => {
  it("a signup-seeded personal org with per-person spend renders all three scores", async () => {
    const { orgId } = await ensureOrgOfOne(db, await createAuthUser());
    // personal-30d.json attributes spend_cents to an identity-linked person
    // subject (a Cursor-like topology) — every component has rows.
    await loadFixture(db, orgId, personalFixture);
    await recomputeOrg(db, orgId, { period: JUNE });

    const summary = await dashboardSummary(forOrg(db, orgId), "full", RANGE);
    expect(summary.scores).toHaveLength(3);
    expect(new Set(summary.scores.map((s) => s.definitionSlug))).toEqual(
      new Set(SLUGS),
    );
    for (const score of summary.scores) {
      expect(score.subjectLevel).toBe("person");
    }
  });

  it("an org-level (unresolved) spend topology honestly omits Efficiency, not fabricates it", async () => {
    // The real Anthropic/OpenAI cost-report topology (src/connectors/*/normalize.ts):
    // spend_cents lands on an unresolved account:org subject with NO identity
    // link, while per-user usage resolves to the person. Efficiency's two
    // components are ratios against spend_cents (drizzle/0009) — with no
    // exclusive-subject spend rows, both components are omitted
    // (src/scoring/evaluate.ts ratio-omission rule), so Efficiency must not
    // render at all (never fabricate a rate from absent data).
    const { orgId } = await ensureOrgOfOne(db, await createAuthUser());
    await loadFixture(db, orgId, {
      connections: [
        { key: "anthropic", vendor: "anthropic_console", displayName: "Anthropic", authKind: "admin_key" },
      ],
      people: [
        { key: "solo", pseudonym: "solar-tern", displayName: "Solo Founder", email: "solo@fixture.example" },
      ],
      teams: [],
      subjects: [
        { key: "solo-usage", connection: "anthropic", kind: "person", externalId: "solo@fixture.example", email: "solo@fixture.example" },
        { key: "org-account", connection: "anthropic", kind: "account", externalId: "org" },
      ],
      identities: [{ subject: "solo-usage", person: "solo", method: "email_match" }],
      records: [
        { subject: "solo-usage", metricKey: "active_day", day: "2026-06-16", value: 1, attribution: "person", sourceConnector: "fixture@1" },
        { subject: "solo-usage", metricKey: "active_day", day: "2026-06-17", value: 1, attribution: "person", sourceConnector: "fixture@1" },
        { subject: "solo-usage", metricKey: "feature_used", day: "2026-06-17", dim: "feature=chat", value: 1, attribution: "person", sourceConnector: "fixture@1" },
        // org-level spend — no identity link, so it never enters the person's exclusive set.
        { subject: "org-account", metricKey: "spend_cents", day: "2026-06-17", value: 13758, attribution: "account", sourceConnector: "fixture@1" },
      ],
      signals: [],
    });
    await recomputeOrg(db, orgId, { period: JUNE });

    const summary = await dashboardSummary(forOrg(db, orgId), "full", RANGE);
    const slugs = new Set(summary.scores.map((s) => s.definitionSlug));
    expect(slugs).toEqual(new Set(["adoption", "fluency"]));
    expect(slugs.has("efficiency")).toBe(false);
    // Spend still shows — it's read live from metric_records, off the score path.
    expect(summary.spendCents).toBe(13758);
  });
});
