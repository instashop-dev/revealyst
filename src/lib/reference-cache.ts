import type { Db } from "../db/client";
import { listBenchmarks } from "../db/benchmarks";
import type { forOrg } from "../db/org-scope";

type OrgScope = ReturnType<typeof forOrg>;

// Isolate-scope TTL cache for REFERENCE reads on the authenticated hot path
// (dashboard /growth). On Workers→Hyperdrive→Neon every query is a real
// network round trip (~300–650ms measured), and these tables are seeded
// reference data that changes only at deploy/seed time — refetching the
// capability graph or the mission catalog on every page load buys nothing and
// costs round-trip waves. Cached VALUES live on `globalThis` and survive
// across requests within a Worker isolate; a fresh isolate (or the TTL)
// re-reads from Postgres.
//
// Hard rules, enforced by shape:
//  - Only the typed helpers below are exported — there is deliberately NO
//    generic "cache any query" surface, because caching an org-scoped read
//    under a non-org key would serve one tenant's rows to another (invariant
//    a). A new helper must state why its rows are safe to share and key by
//    org when they are not (see the recommendation-catalog helper).
//  - Only resolved VALUES are cached, never in-flight promises: a promise is
//    tied to the creating request's DB connection, and Workers cancel
//    cross-request I/O — a second request awaiting the first request's
//    promise would observe a cancelled query.
//  - Values are structuredClone'd on both write and read so one request
//    mutating (e.g. sorting) its result can never corrupt another request's
//    view of the cache.
//
// The cache is ACTIVE only when NODE_ENV === "production" (the deployed
// Worker, incl. PR preview versions). In dev and tests every call falls
// through to the loader, so `npm run dev` never serves 5-minute-stale seed
// data and PGlite-per-test suites can't bleed rows across tests through
// `globalThis`.

export const REFERENCE_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { value: unknown; expiresAt: number };

const GLOBAL_KEY = "__revealystReferenceCache";

/** OpenNext bundles src twice (worker entry vs Next server) — anchoring on
 * `globalThis` (not module scope) keeps ONE cache across both copies, the
 * same rule as request-timing's collector. */
function cacheStore(): Map<string, CacheEntry> {
  const g = globalThis as unknown as Record<
    string,
    Map<string, CacheEntry> | undefined
  >;
  return (g[GLOBAL_KEY] ??= new Map());
}

function cacheEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Test seam: drop every cached entry (exported for unit tests only). */
export function clearReferenceCache(): void {
  cacheStore().clear();
}

async function cachedReference<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cacheEnabled()) {
    return load();
  }
  const store = cacheStore();
  const now = Date.now();
  const hit = store.get(key);
  if (hit !== undefined && hit.expiresAt > now) {
    return structuredClone(hit.value) as T;
  }
  const value = await load();
  store.set(key, {
    value: structuredClone(value),
    expiresAt: now + REFERENCE_CACHE_TTL_MS,
  });
  return value;
}

/** The capability graph — four GLOBAL reference tables (ADR 0035: no org_id;
 * author-via-migration only), identical for every org. */
export function cachedCapabilityGraph(
  scope: OrgScope,
): ReturnType<OrgScope["capabilities"]["graph"]> {
  return cachedReference("capability-graph", () => scope.capabilities.graph());
}

/** The mission catalog + steps — GLOBAL reference tables (ADR 0037: no
 * org_id, seeded), identical for every org. */
export function cachedMissionCatalog(
  scope: OrgScope,
): ReturnType<OrgScope["missions"]["catalog"]> {
  return cachedReference("mission-catalog", () => scope.missions.catalog());
}

/** The recommendation catalog. NOT purely global — `catalog.list()` returns
 * global presets (org_id NULL) ∪ THIS ORG'S OWN rows (ADR 0033), so the cache
 * key MUST carry the orgId: a shared key would serve one org's custom rows to
 * another (invariant a). Rows are seed/migration-authored today (no runtime
 * write surface), so the TTL only bounds post-deploy staleness. */
export function cachedRecommendationCatalog(
  scope: OrgScope,
  orgId: string,
): ReturnType<OrgScope["catalog"]["list"]> {
  return cachedReference(`recommendation-catalog:${orgId}`, () =>
    scope.catalog.list(),
  );
}

/** Verified overall-segment benchmarks — a GLOBAL table (no org_id). Runtime
 * writes exist (admin verification), so the TTL means a newly verified
 * benchmark can take up to 5 minutes to appear on dashboards — acceptable for
 * a comparison line, and each isolate converges on its next read. */
export function cachedVerifiedOverallBenchmarks(
  db: Db,
): ReturnType<typeof listBenchmarks> {
  return cachedReference("benchmarks:verified:overall", () =>
    listBenchmarks(db, { status: "verified", segment: "overall" }),
  );
}
