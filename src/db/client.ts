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
 * Workers-specific settings: a small per-invocation pool (5 connections —
 * postgres.js queues rather than pipelines concurrent queries, so a batch of
 * N queries on one connection serializes at one network round-trip EACH; see
 * the comment on `max` below), prepared statements only via Hyperdrive,
 * short timeouts. Connections never outlive the request.
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
  // The local dev db (`npm run dev:db`, a PGlite socket — reached either via
  // DATABASE_URL or via wrangler's HYPERDRIVE localConnectionString) supports
  // ONE client connection and rejects prepared statements (08P01), so it keeps
  // the old single-connection/unprepared settings. Every REAL database
  // (Hyperdrive in prod, direct Neon fallback) gets the Cloudflare-documented
  // settings instead — and both matter a lot for authenticated TTFB:
  //  - max: 5 — postgres.js does NOT pipeline concurrent queries on one
  //    connection, it queues them, so with max: 1 every "depth-1 Promise.all"
  //    batch actually serialized on the wire at one ~600ms Workers→Hyperdrive→
  //    Neon round-trip PER QUERY (measured in prod: a 3-query access stage
  //    cost 2250ms; the 39-query Today batch streamed for ~20s). Five
  //    connections let a batch of N queries complete in ~ceil(N/5) round-trip
  //    waves. 5 (not more) per Hyperdrive's guidance — Workers allow 6
  //    simultaneous outgoing connections per invocation.
  //  - prepare: true — Hyperdrive does not cache/pool unnamed (prepare:false)
  //    statements and they cost additional round-trips per query (see
  //    developers.cloudflare.com/hyperdrive → postgres.js driver notes).
  //    Gated on the HYPERDRIVE binding, not just non-loopback: the direct
  //    DATABASE_URL fallback and the ops scripts (KEK rotation, calibrate,
  //    launch-metrics) may point at a POOLED (PgBouncer transaction-mode)
  //    Neon URL, where protocol-level prepared statements depend on pooler
  //    version/config — those paths keep the old unprepared behavior.
  const isLoopbackDb = /^[a-z+]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(
    connectionString,
  );
  const client = postgres(connectionString, {
    max: isLoopbackDb ? 1 : 5,
    prepare: !isLoopbackDb && env.HYPERDRIVE !== undefined,
    connect_timeout: 10,
    idle_timeout: 20,
    // postgres.js defaults fetch_types:true, which issues a pg_catalog
    // type-introspection query on first use of every new connection — and
    // Workers open new connections per request (no cross-request reuse),
    // so every request was paying that extra round trip on top of
    // its real queries. Cloudflare's Hyperdrive docs recommend disabling it.
    // Safe here: fetch_types only affects parsing of CUSTOM/extension
    // (composite/domain) Postgres types, which this schema has none of —
    // pgEnum columns (src/db/schema.ts) serialize as plain text either way,
    // and the one array column (subjectDaySignals.hours, smallint[]) uses a
    // built-in array type postgres.js already knows how to parse without
    // introspection.
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
