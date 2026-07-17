import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { applyPaddleSubscriptionEvent } from "../src/db/subscriptions";
import {
  cachedAccessDecision,
  cachedCapabilityGraph,
  cachedMissionCatalog,
  cachedRecommendationCatalog,
  clearReferenceCache,
} from "../src/lib/reference-cache";

// The isolate-scope reference cache (src/lib/reference-cache.ts) sits on the
// authenticated hot path — these tests pin its three load-bearing properties:
// (1) DISABLED outside production, so dev/tests always read live rows; (2) a
// warm entry serves without re-querying and returns an independent clone (one
// request's mutation can't corrupt another's); (3) the recommendation catalog
// key carries the orgId — the org-override rows in `catalog.list()` must
// never leak across tenants through a shared cache key (invariant a).

let db: Db;
let orgId: string;
let queryCount = 0;

beforeAll(async () => {
  const pglite = new PGlite();
  const originalQuery = pglite.query.bind(pglite);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pglite as any).query = async (...args: any[]) => {
    queryCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalQuery(...(args as [any]));
  };
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const org = await createFixtureOrg(db, "reference-cache", "personal");
  orgId = org.id;
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
  clearReferenceCache();
});

describe("reference cache", () => {
  it("is a pass-through outside production (every call queries)", async () => {
    const scope = forOrg(db, orgId);
    const before = queryCount;
    await cachedCapabilityGraph(scope);
    const afterFirst = queryCount;
    await cachedCapabilityGraph(scope);
    expect(afterFirst).toBeGreaterThan(before);
    // Second call issues the same number of fresh queries — nothing cached.
    expect(queryCount - afterFirst).toBe(afterFirst - before);
  });

  it("serves a warm entry without re-querying, as an independent clone", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const scope = forOrg(db, orgId);
    const first = await cachedCapabilityGraph(scope);
    const warmStart = queryCount;
    const second = await cachedCapabilityGraph(scope);
    expect(queryCount).toBe(warmStart); // no queries on the warm read
    expect(second).toEqual(first);
    expect(second).not.toBe(first); // structuredClone — mutation-safe
    second.capabilities.length = 0;
    const third = await cachedCapabilityGraph(scope);
    expect(third.capabilities).toEqual(first.capabilities);
  });

  it("caches the mission catalog once per isolate", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const scope = forOrg(db, orgId);
    const first = await cachedMissionCatalog(scope);
    const warmStart = queryCount;
    const second = await cachedMissionCatalog(scope);
    expect(queryCount).toBe(warmStart);
    expect(second).toEqual(first);
  });

  it("access decision: caches UNBLOCKED only — an upgrade unblocks on the very next call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // An org OVER the free band: one connection, six identity-resolved people
    // with an active day TODAY (tracked_user counts resolved identities with
    // a metric record in the trailing-30d entitlement period).
    const org = await createFixtureOrg(db, "reference-cache-access", "team");
    const scope = forOrg(db, org.id);
    const [conn] = await db
      .insert(schema.connections)
      .values({
        orgId: org.id,
        vendor: "cursor",
        displayName: "Cursor",
        status: "active",
        authKind: "api_key",
      })
      .returning();
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 6; i++) {
      const [person] = await db
        .insert(schema.people)
        .values({ orgId: org.id, pseudonym: `rc-person-${i}` })
        .returning();
      const [subject] = await db
        .insert(schema.subjects)
        .values({
          orgId: org.id,
          connectionId: conn.id,
          kind: "person",
          externalId: `rc-ext-${i}`,
        })
        .returning();
      await db.insert(schema.identities).values({
        orgId: org.id,
        subjectId: subject.id,
        personId: person.id,
        method: "manual",
      });
      await db.insert(schema.metricRecords).values({
        orgId: org.id,
        subjectId: subject.id,
        metricKey: "active_day",
        day: today,
        connectionId: conn.id,
        value: 1,
        attribution: "person",
        sourceConnector: "test@1",
      });
    }

    // 6 tracked > FREE_TRACKED_USER_LIMIT (5), no subscription → BLOCKED —
    // and a blocked decision must NOT be stored (re-derived every call).
    const orgShape = { id: org.id, kind: "team" as const };
    expect((await cachedAccessDecision(db, scope, orgShape)).blocked).toBe(true);
    const afterBlocked = queryCount;
    expect((await cachedAccessDecision(db, scope, orgShape)).blocked).toBe(true);
    expect(queryCount).toBeGreaterThan(afterBlocked); // re-queried, not cached

    // The org upgrades → the VERY NEXT call unblocks (nothing stale pinned).
    await applyPaddleSubscriptionEvent(db, {
      orgId: org.id,
      paddleSubscriptionId: "sub_rc_access",
      occurredAt: new Date(),
      status: "active",
      priceId: "pri_rc",
      quantity: 6,
    });
    expect((await cachedAccessDecision(db, scope, orgShape)).blocked).toBe(false);

    // ...and the unblocked decision IS cached: the repeat call issues no
    // queries and returns the same decision.
    const warmStart = queryCount;
    const warm = await cachedAccessDecision(db, scope, orgShape);
    expect(queryCount).toBe(warmStart);
    expect(warm.blocked).toBe(false);
  });

  it("keys the recommendation catalog by org — org rows never cross tenants", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const orgB = await createFixtureOrg(db, "reference-cache-b", "personal");
    // Give org B a private catalog override row; org A has only globals.
    const ORG_B_TITLE = "Org B private recommendation";
    await db.insert(schema.recommendationCatalog).values({
      orgId: orgB.id,
      slug: "22222222-2222-4222-8222-222222222222",
      version: 1,
      scoreSlug: "adoption",
      componentKey: "active_days",
      signalGroup: "active-days",
      title: ORG_B_TITLE,
      body: "Only org B may ever see this row.",
      requiredSignals: {
        comparators: [{ kind: "measured" }],
      },
      benefit: "high",
      difficulty: "low",
      confidence: "high",
      insightKind: "adoption",
      suggestedActionType: "in-product-setting",
    });
    const scopeA = forOrg(db, orgId);
    const scopeB = forOrg(db, orgB.id);
    const a = await cachedRecommendationCatalog(scopeA);
    const b = await cachedRecommendationCatalog(scopeB);
    expect(b.some((r) => r.title === ORG_B_TITLE)).toBe(true);
    expect(a.some((r) => r.title === ORG_B_TITLE)).toBe(false);
    // Warm re-reads keep the separation (each org hits its own key).
    const a2 = await cachedRecommendationCatalog(scopeA);
    expect(a2.some((r) => r.title === ORG_B_TITLE)).toBe(false);
  });
});
