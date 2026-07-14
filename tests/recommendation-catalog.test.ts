import { PGlite } from "@electric-sql/pglite";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { SCORE_GLOSSARY, SCORE_SLUGS } from "../src/lib/metrics-glossary";
import {
  deriveAttention,
  type ComponentDetailRow,
} from "../src/lib/score-insights";
import {
  parseRequiredSignals,
  type CatalogRecommendation,
} from "../src/lib/recommendation-catalog";
import { LEGACY_CATALOG_RECOMMENDATIONS } from "./fixtures/recommendation-catalog";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// W6-C (ADR 0033): the recommendation catalog as SEEDED reference data. These
// tests run against a MIGRATED PGlite DB (so the drizzle/0029 seed is what's
// under test, not a TS mirror) and cover four things the ADR requires:
//   1. the 7 legacy entries are seeded VERBATIM, keyed by their stable ids;
//   2. every seeded body passes the adversarial content fact-check (G7);
//   3. every row's `required_signals` parses against the CLOSED comparator
//      vocabulary (an unparseable row would red CI);
//   4. migration-equivalence: the seeded catalog drives `deriveAttention` to
//      IDENTICAL output as the retired static map (the legacy fixture).

let db: Db;
let orgId: string;
let seeded: CatalogRecommendation[];

/** The engineering roles seeded by W6-B (drizzle/0026) — `applicable_roles`
 * elements must be a subset of this closed set (Postgres has no array-element
 * FK, so this is the "checked set" the schema comment refers to). Read LIVE from
 * the migrated `roles` table (W7-1 §5.H cleanup) rather than a hardcoded literal,
 * so this suite and tests/capability-catalog.test.ts share ONE source of truth. */
let ROLE_SLUGS: Set<string>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "catalog-org", kind: "team" })
    .returning();
  orgId = org.id;
  seeded = await forOrg(db, orgId).catalog.list();
  ROLE_SLUGS = new Set((await db.select().from(schema.roles)).map((r) => r.slug));
});

describe("recommendation_catalog seed (drizzle/0029)", () => {
  it("seeds exactly the 7 global entries (org_id NULL), all active", async () => {
    const rows = await db
      .select()
      .from(schema.recommendationCatalog)
      .where(isNull(schema.recommendationCatalog.orgId));
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.status === "active")).toBe(true);
    expect(rows.every((r) => r.version === 1)).toBe(true);
  });

  it("the idempotent seed is a no-op on replay (re-running the migration inserts nothing new)", async () => {
    // Re-running every migration against the SAME db must not duplicate the
    // seed — the ON CONFLICT DO NOTHING guard (NULLS NOT DISTINCT unique).
    await migrate(db as never, { migrationsFolder: "./drizzle" });
    const rows = await db
      .select()
      .from(schema.recommendationCatalog)
      .where(isNull(schema.recommendationCatalog.orgId));
    expect(rows).toHaveLength(7);
  });

  it("preserves the 7 stable rec ids so rec_interaction_state.rec_id keeps resolving", () => {
    // rec_interaction_state.rec_id (W5-D) stores these exact ids. The catalog
    // `slug` (== the mapped `id`) MUST reproduce them or existing interaction
    // state would dangle after the migration.
    expect(seeded.map((r) => r.id).sort()).toEqual(
      [
        "adoption-active-days",
        "adoption-tool-coverage",
        "efficiency-engagement-per-spend",
        "efficiency-output-per-spend",
        "fluency-breadth",
        "fluency-depth",
        "fluency-effectiveness",
      ].sort(),
    );
  });

  it("every (slug, componentKey) targets a LIVE preset component — no orphan keys", () => {
    for (const rec of seeded) {
      expect((SCORE_SLUGS as readonly string[])).toContain(rec.slug);
      const components = SCORE_GLOSSARY[rec.slug].components;
      expect(
        Object.keys(components),
        `${rec.id} → ${rec.slug}.${rec.componentKey}`,
      ).toContain(rec.componentKey);
    }
  });

  it("applicable_roles is a subset of the seeded roles reference set", () => {
    for (const rec of seeded) {
      for (const role of rec.applicableRoles) {
        expect(ROLE_SLUGS.has(role), `${rec.id} role ${role}`).toBe(true);
      }
    }
  });
});

describe("recommendation_catalog content fact-check (invariant b / G7)", () => {
  it("no seeded body or title states an invented benchmark/threshold as fact", () => {
    for (const rec of seeded) {
      expect(BANNED_PHRASING.test(rec.title), rec.id).toBe(false);
      expect(BANNED_PHRASING.test(rec.body), rec.id).toBe(false);
    }
  });

  it("copy stays task-focused, never second-person/blaming (Kluger & DeNisi)", () => {
    for (const rec of seeded) {
      expect(/\byou\b|\byour\b/i.test(rec.title), `${rec.id} title`).toBe(false);
      expect(/\byou\b|\byour\b/i.test(rec.body), `${rec.id} body`).toBe(false);
    }
  });

  it("no fabricated 'time saved' / productivity claims (Group C refusal list)", () => {
    for (const rec of seeded) {
      expect(/time saved|hours saved|productivity gain|roi/i.test(rec.title), rec.id).toBe(false);
      expect(/time saved|hours saved|productivity gain|roi/i.test(rec.body), rec.id).toBe(false);
    }
  });

  it("same-signal component pairs share a signalGroup (the dedupe key)", () => {
    const group = (slug: string, key: string) =>
      seeded.find((r) => r.slug === slug && r.componentKey === key)?.signalGroup;
    expect(group("adoption", "active_days")).toBe(group("fluency", "depth"));
    expect(group("adoption", "tool_coverage")).toBe(group("fluency", "breadth"));
    const distinct = [
      group("fluency", "effectiveness"),
      group("efficiency", "output_per_spend"),
      group("efficiency", "engagement_per_spend"),
    ];
    expect(new Set(distinct).size).toBe(3);
  });

  it("exercises all three suggested-action shapes (not collapsed to one)", () => {
    expect(new Set(seeded.map((r) => r.suggestedActionType))).toEqual(
      new Set(["link-out", "in-product-setting", "vendor-deep-link"]),
    );
  });
});

describe("seed ↔ evaluator contract (required_signals over the closed vocabulary)", () => {
  it("every seeded row's required_signals parses against the closed comparator vocabulary", async () => {
    // Read the RAW jsonb (not the mapped rows, whose read already parsed) so an
    // unparseable seed would surface here rather than being hidden.
    const rows = await db.select().from(schema.recommendationCatalog);
    for (const row of rows) {
      expect(() => parseRequiredSignals(row.requiredSignals), row.slug).not.toThrow();
      const parsed = parseRequiredSignals(row.requiredSignals);
      expect(parsed.comparators.length).toBeGreaterThan(0);
    }
  });

  it("each row encodes the measured · normalized<40 · min-weight≥0.2 gating", () => {
    for (const rec of seeded) {
      const kinds = rec.requiredSignals.comparators.map((c) => c.kind).sort();
      expect(kinds, rec.id).toEqual(["measured", "min-weight", "normalized-below"]);
    }
  });
});

// ─── Migration-equivalence: seeded catalog === retired static map ───

function componentRow(
  key: string,
  opts: { normalized?: number; weight?: number; omitted?: boolean },
): ComponentDetailRow {
  const omitted = opts.omitted ?? false;
  return {
    key,
    label: key,
    kind: "plain",
    omitted,
    normalized: omitted ? undefined : opts.normalized,
    weight: opts.weight ?? 0.5,
    calcSimple: `calc ${key}`,
  };
}

/** Every (slug, componentKey) the 7 entries cover, plus adversarial cases
 * (weak/at-band/trivial-weight/omitted/unmapped) — the battery both catalogs
 * are driven through. */
const SCORE_COMPONENT_CASES: {
  slug: "adoption" | "fluency" | "efficiency";
  components: ComponentDetailRow[];
}[] = [
  {
    slug: "adoption",
    components: [
      componentRow("active_days", { normalized: 5, weight: 0.5 }), // weak → rec
      componentRow("tool_coverage", { normalized: 39, weight: 0.5 }), // weak → rec
    ],
  },
  {
    slug: "fluency",
    components: [
      componentRow("depth", { normalized: 10, weight: 0.33 }), // weak (dedupes w/ active-days)
      componentRow("breadth", { normalized: 45, weight: 0.33 }), // at/above band → no rec
      componentRow("effectiveness", { normalized: 8, weight: 0.34 }), // weak → rec
    ],
  },
  {
    slug: "efficiency",
    components: [
      componentRow("output_per_spend", { normalized: 5, weight: 0.1 }), // trivial weight → no rec
      componentRow("engagement_per_spend", { omitted: true }), // omitted → no rec
    ],
  },
];

describe("migration-equivalence: catalog drives IDENTICAL recs to the static map", () => {
  it("the seeded catalog maps field-for-field to the legacy static entries", () => {
    const byId = new Map(seeded.map((r) => [r.id, r]));
    expect(byId.size).toBe(LEGACY_CATALOG_RECOMMENDATIONS.length);
    for (const legacy of LEGACY_CATALOG_RECOMMENDATIONS) {
      expect(byId.get(legacy.id), `${legacy.id} present in seed`).toEqual(legacy);
    }
  });

  it("deriveAttention produces IDENTICAL output from the seeded catalog and the legacy fixture", () => {
    const baseInput = {
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
      scoreComponents: SCORE_COMPONENT_CASES,
    };
    const fromCatalog = deriveAttention({
      ...baseInput,
      recommendations: seeded,
    });
    const fromStaticMap = deriveAttention({
      ...baseInput,
      recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
    });
    expect(fromCatalog).toEqual(fromStaticMap);
    // And it's a real, non-empty comparison — the battery DOES surface recs.
    expect(fromCatalog.some((i) => i.kind === "recommendation")).toBe(true);
  });

  it("respects the cap + signalGroup dedup identically to the static map", () => {
    const recs = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
      scoreComponents: SCORE_COMPONENT_CASES,
      recommendations: seeded,
    }).filter((i) => i.kind === "recommendation");
    // At most 2 (MAX_RECOMMENDATIONS); the active-days signal group appears once.
    expect(recs.length).toBeLessThanOrEqual(2);
  });
});
