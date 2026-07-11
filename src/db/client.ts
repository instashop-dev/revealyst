import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { timeStage } from "../lib/request-timing";
import * as authRelations from "./auth-relations";
import * as schema from "./schema";

// Relations are spread in alongside the (frozen) table schema so
// `db.query.session`/`db.query.user` exist — see src/db/auth-relations.ts
// for why: it lets Better Auth's drizzleAdapter (src/lib/auth.ts,
// `experimental.joins: true`) collapse getSession's two sequential
// round-trips (session by token, then user by id) into one SQL join.
// Exported so tests that build their own PGlite drizzle instance (and call
// createAuth against it) use the exact same schema+relations wiring — a
// hand-copied spread that drifts would silently re-open the join-fallback
// path in tests while prod behaves differently.
export const fullSchema = { ...schema, ...authRelations };

export type Db = PostgresJsDatabase<typeof fullSchema>;

type DbEnv = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
};

/**
 * Database client for the Worker runtime. Prefers the Hyperdrive binding
 * (pooled, region-pinned); falls back to a direct Neon connection string
 * (`DATABASE_URL` secret / `.dev.vars`) until Hyperdrive is provisioned.
 *
 * Workers-specific settings: one connection per invocation, no prepared
 * statements (connections don't outlive the request), short timeouts.
 */
export function createDb(env: DbEnv): Db {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "No database configured: set the HYPERDRIVE binding or the DATABASE_URL secret",
    );
  }
  // workerd's TLS doesn't implement rejectUnauthorized, which postgres.js
  // sets for string ssl modes (sslmode=require → ERR_OPTION_NOT_IMPLEMENTED).
  // An ssl *object* is passed through untouched, so default cert
  // verification applies. Only for direct TLS URLs — Hyperdrive and the
  // local dev db connect without client TLS.
  const wantsTls =
    !env.HYPERDRIVE && /[?&]sslmode=(require|prefer|allow)/.test(connectionString);
  // The local dev socket (`npm run dev:db` — a PGlite net server on
  // 127.0.0.1:5432, reached in dev because the HYPERDRIVE binding's
  // localConnectionString points there) is the ONLY place that needs the
  // historical postgres.js workarounds, and applying them to real Postgres is
  // actively harmful for latency:
  //  - `prepare`: the PGlite socket 08P01's on named prepared statements, so
  //    dev needs `prepare: false`. But against real Postgres via Hyperdrive,
  //    Cloudflare's docs are explicit — keep `prepare: true` (the default) so
  //    Hyperdrive CACHES prepared statements; with `prepare: false` it cannot,
  //    and pays an extra parse round-trip on EVERY query. That per-query cost
  //    is invisible on a 1-query endpoint but compounds across an authenticated
  //    page's multi-query batch (the ~15-query dashboard read) into seconds of
  //    added TTFB — the post-sign-in slow-load.
  //  - `max`: the PGlite net server resets overflow connections, so dev needs
  //    `max: 1`. Cloudflare recommends `max: 5` for Hyperdrive so a request's
  //    concurrent queries (our depth-1 `Promise.all` batches) can fan out
  //    across the pool instead of serializing on a single connection.
  // Detect the local socket by host; everything else (prod Hyperdrive, or a
  // direct Neon DATABASE_URL) gets the recommended production pool config.
  const isLocalSocket = /@(?:127\.0\.0\.1|localhost)[:/]/.test(connectionString);
  const client = postgres(connectionString, {
    max: isLocalSocket ? 1 : 5,
    prepare: !isLocalSocket,
    connect_timeout: 10,
    idle_timeout: 20,
    // postgres.js defaults fetch_types:true, which issues a pg_catalog
    // type-introspection query on first use of every new connection — and
    // Workers open a new connection per request (no cross-request reuse), so
    // every request was paying that extra round trip on top of its real
    // queries. Cloudflare's Hyperdrive docs recommend disabling it. Safe here:
    // fetch_types only affects parsing of CUSTOM/extension (composite/domain)
    // Postgres types, which this schema has none of — pgEnum columns
    // (src/db/schema.ts) serialize as plain text either way, and the one array
    // column (subjectDaySignals.hours, smallint[]) uses a built-in array type
    // postgres.js already knows how to parse without introspection.
    fetch_types: false,
    ...(wantsTls ? { ssl: {} } : {}),
  });
  return drizzle(client, { schema: fullSchema });
}

/**
 * Request-lifecycle instrumentation (opt-in, off by default): times a
 * trivial `select 1` on a just-created connection to isolate connect+TLS+
 * Neon-wake latency from the cost of the first real query. Unconditionally
 * running an extra round trip on every request would itself violate the
 * near-zero-overhead goal of request timing, so this only runs when
 * `REQUEST_TIMING_DB_PROBE=1` is set (env var / Worker secret / .dev.vars).
 * Kept as an explicit call the caller awaits (src/lib/api-context.ts
 * `appContext`) rather than fired-and-forgotten inside `createDb`, so the
 * "dbConnectProbe" stage reliably lands in the response's Server-Timing
 * header instead of racing it — and so `createDb` itself stays synchronous
 * for its other (cron/queue) call sites in src/worker.ts.
 */
export async function probeDbConnection(
  db: Db,
  env: { REQUEST_TIMING_DB_PROBE?: string },
): Promise<void> {
  if (env.REQUEST_TIMING_DB_PROBE !== "1") return;
  await timeStage("dbConnectProbe", async () => {
    await db.execute(sql`select 1`);
  });
}
