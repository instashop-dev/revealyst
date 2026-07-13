import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { recommendationCatalog } from "../schema";
import {
  mapCatalogRow,
  type CatalogRecommendation,
} from "../../lib/recommendation-catalog";

// Recommendation catalog reads (W6-C, ADR 0033). ONE per-org batch read,
// designed to fold into the dashboard + digest existing flat Promise.all
// (G10 / §8.2 perf floor): the returned rows are evaluated per-person IN
// MEMORY by `deriveAttention`, never re-queried per person (each Neon round
// trip is ~500–670ms — a naive per-person lookup is a multi-second page).
//
// `list()` returns global presets (org_id NULL — the documented reference-data
// exception, exactly like scores.definitions) ∪ this org's own rows, mirroring
// the score_definitions live-read pattern (NOT a TS mirror of the content).
export function catalogNamespace(db: Db, orgId: string) {
  return {
    /**
     * The active recommendation catalog visible to this org: global presets
     * (org_id NULL) ∪ this org's own rows, mapped to the evaluator-facing shape
     * with `required_signals` parsed against the closed comparator vocabulary.
     * Ordered global-then-org so an org row shadows a same-key preset in
     * `indexBySlugComponent`. ONE round trip — the whole per-org catalog.
     */
    async list(): Promise<CatalogRecommendation[]> {
      const rows = await db
        .select()
        .from(recommendationCatalog)
        .where(
          and(
            or(
              isNull(recommendationCatalog.orgId),
              eq(recommendationCatalog.orgId, orgId),
            ),
            eq(recommendationCatalog.status, "active"),
          ),
        )
        // Global (NULL org_id) rows FIRST, this org's own rows LAST — so an org
        // override wins the last-write in indexBySlugComponent. Ordered on an
        // explicit `org_id IS NOT NULL` flag (0 for global, 1 for org) rather
        // than relying on Postgres' NULLS-LAST-on-ASC default, which would put
        // global rows last and let a preset shadow an override.
        .orderBy(
          asc(sql`(${recommendationCatalog.orgId} is not null)`),
          asc(recommendationCatalog.slug),
        );
      return rows.map(mapCatalogRow);
    },
  };
}
