import { asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import {
  capabilities,
  capabilityDependencies,
  capabilitySignals,
  domains,
} from "../schema";

// AI capability graph reads (W7-1, ADR 0035). All four tables are GLOBAL
// reference data (no org_id, like `roles` / `metric_catalog`) — every org sees
// the same closed capability set — so these are NOT org-scoped reads and are
// not part of the tenant-isolation sweep. The namespace lives on `forOrg` only
// for a uniform call surface. The whole graph is tiny (~1 domain, <20
// capabilities, shallow edges); every method is ONE batched round trip that
// folds into the dashboard/digest flat Promise.all (§8.2 perf floor), and
// traversal ("eligible next") runs IN MEMORY over the returned rows — never a
// per-person query. Nothing writes here (author-via-migration only).

export type CapabilityRow = {
  slug: string;
  domainSlug: string;
  label: string;
  summary: string;
  sort: number;
};

export type CapabilityDependencyRow = {
  capabilitySlug: string;
  requiresSlug: string;
};

export type CapabilitySignalRow = {
  capabilitySlug: string;
  metricKey: string | null;
  componentKey: string | null;
};

export type CapabilityGraph = {
  capabilities: CapabilityRow[];
  dependencies: CapabilityDependencyRow[];
  signals: CapabilitySignalRow[];
};

export function capabilitiesNamespace(db: Db, _orgId: string) {
  return {
    /**
     * The active capability list, ordered by domain then capability sort. The
     * coaching-card label source (a slug → label lookup) and the profile card's
     * row source. Global reference data — not org-filtered.
     */
    async list(): Promise<CapabilityRow[]> {
      return db
        .select({
          slug: capabilities.slug,
          domainSlug: capabilities.domainSlug,
          label: capabilities.label,
          summary: capabilities.summary,
          sort: capabilities.sort,
        })
        .from(capabilities)
        .innerJoin(domains, eq(capabilities.domainSlug, domains.slug))
        .where(eq(capabilities.isActive, true))
        .orderBy(asc(domains.sort), asc(capabilities.sort), asc(capabilities.slug));
    },

    /** A slug → display-label map for the active capabilities (the coaching
     * card's label lookup, built once and passed into `deriveAttention`). */
    async labels(): Promise<Map<string, string>> {
      const rows = await this.list();
      return new Map(rows.map((r) => [r.slug, r.label]));
    },

    /**
     * The whole capability graph in one shot: active capabilities + all
     * prerequisite edges + all signal bindings. The mastery engine (W7-2) and
     * the ranker's prerequisite gate (W7-3) traverse this IN MEMORY. Three
     * batched reads, folded into the caller's existing Promise.all.
     */
    async graph(): Promise<CapabilityGraph> {
      const [caps, deps, sigs] = await Promise.all([
        this.list(),
        db
          .select({
            capabilitySlug: capabilityDependencies.capabilitySlug,
            requiresSlug: capabilityDependencies.requiresSlug,
          })
          .from(capabilityDependencies),
        db
          .select({
            capabilitySlug: capabilitySignals.capabilitySlug,
            metricKey: capabilitySignals.metricKey,
            componentKey: capabilitySignals.componentKey,
          })
          .from(capabilitySignals),
      ]);
      return { capabilities: caps, dependencies: deps, signals: sigs };
    },
  };
}
