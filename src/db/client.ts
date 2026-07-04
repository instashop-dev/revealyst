import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

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
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ...(wantsTls ? { ssl: {} } : {}),
  });
  return drizzle(client, { schema });
}
