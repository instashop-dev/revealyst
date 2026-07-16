import { PGlite } from "@electric-sql/pglite";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { SCORE_GLOSSARY } from "../src/lib/metrics-glossary";

// W7-1 (ADR 0035): the AI capability graph as SEEDED reference data (drizzle/
// 0030). Like the recommendation-catalog suite, these run against a MIGRATED
// PGlite DB so the migration seed is what's under test, not a TS mirror. Six
// contracts the plan requires: exact counts, stable slugs, idempotent replay,
// every signal binding resolves to a LIVE metric/component, every rec links to
// a live capability + roles subset (from a live `roles` read — no hardcoded
// set), and the dependency graph is a self-edge-free acyclic DAG.

let db: Db;
let capabilitySlugs: Set<string>;
/** Live metric_catalog keys — the FK target for a metric binding. */
let metricKeys: Set<string>;
/** Every score-definition component key across all glossary scores. */
const componentKeys = new Set(
  Object.values(SCORE_GLOSSARY).flatMap((s) => Object.keys(s.components)),
);
/** Live role slugs, read from the seeded `roles` table (NOT a hardcoded set —
 * the single source of truth both this suite and the catalog suite share). */
let roleSlugs: Set<string>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const caps = await db.select().from(schema.capabilities);
  capabilitySlugs = new Set(caps.map((c) => c.slug));
  metricKeys = new Set(
    (await db.select().from(schema.metricCatalog)).map((m) => m.key),
  );
  roleSlugs = new Set(
    (await db.select().from(schema.roles)).map((r) => r.slug),
  );
});

describe("capability graph seed (drizzle/0030)", () => {
  it("seeds the exact v0 Engineering row counts", async () => {
    expect(await db.select().from(schema.domains)).toHaveLength(1);
    expect(await db.select().from(schema.capabilities)).toHaveLength(9);
    expect(await db.select().from(schema.capabilitySignals)).toHaveLength(30); // 23 (0030) + 6 OTel marker bindings (0034) + 1 context_tokens binding (0035)
    expect(await db.select().from(schema.capabilityDependencies)).toHaveLength(8);
  });

  it("preserves the stable capability slugs", async () => {
    const rows = await db.select().from(schema.capabilities);
    expect(rows.map((r) => r.slug).sort()).toEqual(
      [
        "agentic-delivery",
        "ai-coding-foundations",
        "code-review-with-ai",
        "consistent-daily-use",
        "cost-efficient-usage",
        "effective-prompting",
        "feature-breadth",
        "model-selection",
        "ship-with-ai",
      ].sort(),
    );
    // Every capability sits under the one seeded domain.
    expect(rows.every((r) => r.domainSlug === "engineering")).toBe(true);
    // Plain-English, beginner-friendly summaries — never empty.
    expect(rows.every((r) => r.summary.trim().length > 0)).toBe(true);
  });

  it("the idempotent seed is a no-op on replay (ON CONFLICT DO NOTHING)", async () => {
    await migrate(db as never, { migrationsFolder: "./drizzle" });
    expect(await db.select().from(schema.capabilities)).toHaveLength(9);
    expect(await db.select().from(schema.capabilitySignals)).toHaveLength(30); // 23 (0030) + 6 OTel marker bindings (0034) + 1 context_tokens binding (0035)
    expect(await db.select().from(schema.capabilityDependencies)).toHaveLength(8);
  });

  it("every signal binding resolves to a LIVE metric key XOR a live component key", async () => {
    const bindings = await db.select().from(schema.capabilitySignals);
    for (const b of bindings) {
      const isMetric = b.metricKey !== null;
      const isComponent = b.componentKey !== null;
      // The CHECK constraint enforces exactly-one, but assert it here too.
      expect(isMetric !== isComponent, `${b.capabilitySlug} binding`).toBe(true);
      if (isMetric) {
        expect(metricKeys.has(b.metricKey!), `metric ${b.metricKey}`).toBe(true);
      } else {
        expect(
          componentKeys.has(b.componentKey!),
          `component ${b.componentKey}`,
        ).toBe(true);
      }
      expect(capabilitySlugs.has(b.capabilitySlug)).toBe(true);
    }
    // Every capability carries at least one binding (no evidence-less rows).
    const bound = new Set(bindings.map((b) => b.capabilitySlug));
    expect(bound).toEqual(capabilitySlugs);
  });

  it("every rec links to ≥1 live capability; roles/target_capabilities are subsets", async () => {
    const recs = await db
      .select()
      .from(schema.recommendationCatalog)
      .where(isNull(schema.recommendationCatalog.orgId));
    for (const rec of recs) {
      // Acceptance criterion: every seeded rec resolves to ≥1 live capability.
      expect(rec.targetCapabilities.length, `${rec.slug} targets`).toBeGreaterThan(0);
      for (const cap of rec.targetCapabilities) {
        expect(capabilitySlugs.has(cap), `${rec.slug} → ${cap}`).toBe(true);
      }
      for (const role of rec.applicableRoles) {
        expect(roleSlugs.has(role), `${rec.slug} role ${role}`).toBe(true);
      }
    }
  });

  it("the dependency graph is an acyclic, self-edge-free DAG with resolved ends", async () => {
    const edges = await db.select().from(schema.capabilityDependencies);
    // Both ends resolve to a live capability; no self-edge.
    for (const e of edges) {
      expect(capabilitySlugs.has(e.capabilitySlug), e.capabilitySlug).toBe(true);
      expect(capabilitySlugs.has(e.requiresSlug), e.requiresSlug).toBe(true);
      expect(e.capabilitySlug).not.toBe(e.requiresSlug);
    }
    // Cycle detection (DFS with a recursion stack). `capability requires
    // requiresSlug`, so an edge points capability → requiresSlug.
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      (adj.get(e.capabilitySlug) ?? adj.set(e.capabilitySlug, []).get(e.capabilitySlug)!).push(
        e.requiresSlug,
      );
    }
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();
    const hasCycle = (node: string): boolean => {
      color.set(node, GRAY);
      for (const next of adj.get(node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) return true; // back-edge → cycle
        if (c === WHITE && hasCycle(next)) return true;
      }
      color.set(node, BLACK);
      return false;
    };
    for (const slug of capabilitySlugs) {
      if ((color.get(slug) ?? WHITE) === WHITE) {
        expect(hasCycle(slug), `cycle reachable from ${slug}`).toBe(false);
      }
    }
  });

  it("exposes the graph through the org-scope namespace (batched reads)", async () => {
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: "cap-org", kind: "team" })
      .returning();
    const scoped = forOrg(db, org.id);
    const graph = await scoped.capabilities.graph();
    expect(graph.capabilities).toHaveLength(9);
    expect(graph.dependencies).toHaveLength(8);
    expect(graph.signals).toHaveLength(30); // +6 OTel markers (0034) +1 context_tokens (0035)
    const labels = await scoped.capabilities.labels();
    expect(labels.get("ai-coding-foundations")).toBe("Make AI part of daily work");
  });
});
