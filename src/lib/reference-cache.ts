import type { Db } from "../db/client";
import { listBenchmarks } from "../db/benchmarks";
import type { forOrg } from "../db/org-scope";
import { computeAccess } from "./access";

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
//
// Staleness bound, stated honestly: these tables change only via
// migration/seed at DEPLOY time, and a deploy replaces the Worker's isolates
// (fresh, empty caches) — so the real stale window is the minutes between
// the deploy workflow's migration step and the new version taking traffic,
// bounded by the TTL. Within that window a warm isolate's dashboard can
// briefly disagree with a live-reading surface (the digest cron, the
// rec-interaction route's catalog check). Accepted deliberately; if catalog
// rows ever gain a runtime write surface (the deferred frozen-catalog-column
// ADR), the writer must bust or bypass this cache.

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

async function cachedReference<T>(
  key: string,
  load: () => Promise<T>,
  opts?: {
    ttlMs?: number;
    /** Return false to serve this result WITHOUT storing it — for decisions
     * whose negative case must always be re-derived fresh (see
     * cachedAccessDecision). Defaults to storing everything. */
    shouldStore?: (value: T) => boolean;
  },
): Promise<T> {
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
  if (opts?.shouldStore === undefined || opts.shouldStore(value)) {
    store.set(key, {
      value: structuredClone(value),
      expiresAt: now + (opts?.ttlMs ?? REFERENCE_CACHE_TTL_MS),
    });
  }
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
 * another (invariant a). The key derives from `scope.orgId` — the exact org
 * the query runs as — never from separate caller input that could disagree
 * with the scope. Rows are seed/migration-authored today (no runtime write
 * surface), so the TTL only bounds post-deploy staleness. */
export function cachedRecommendationCatalog(
  scope: OrgScope,
): ReturnType<OrgScope["catalog"]["list"]> {
  return cachedReference(`recommendation-catalog:${scope.orgId}`, () =>
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

/** The free-band paywall decision's own short TTL — see cachedAccessDecision. */
export const ACCESS_CACHE_TTL_MS = 60 * 1000;

/**
 * The free-band access decision (computeAccess), cached per-ORG for 60s.
 * computeAccess runs on EVERY authenticated page render (the app shell) and
 * every handleApi call — 3 Neon round trips each time — yet its inputs
 * (subscription row, tracked-user count) change on billing events, not per
 * request.
 *
 * The asymmetry is the safety property: ONLY `blocked: false` results are
 * stored. A BLOCKED decision is re-derived fresh on every request, so the
 * moment an org upgrades (Paddle webhook lands), the very next request
 * unblocks — the cache can never pin a paying customer behind the paywall.
 * The inverse staleness is a 60s grace window: an org that crosses the free
 * band keeps a cached `blocked: false` for up to a minute before the gate
 * drops, which under-enforces briefly (safe direction) and never over-blocks.
 * Keyed by org id (org-scoped decision — invariant a).
 */
export function cachedAccessDecision(
  db: Db,
  scope: OrgScope,
  org: { id: string; kind: "personal" | "team" | "system" },
): ReturnType<typeof computeAccess> {
  // The key derives from scope.orgId (the org the queries actually run as),
  // never from the separate org shape — same hard rule as the rec-catalog
  // helper. computeAccess blends both inputs, so a caller holding a
  // mismatched pair would cache a blended decision; fail loudly instead.
  if (scope.orgId !== org.id) {
    throw new Error("cachedAccessDecision: scope and org disagree");
  }
  return cachedReference(
    `access:${scope.orgId}`,
    () => computeAccess(db, scope, org),
    {
      ttlMs: ACCESS_CACHE_TTL_MS,
      shouldStore: (access) => !access.blocked,
    },
  );
}
