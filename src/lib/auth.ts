import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, type Db } from "../db/client";
import { ensureOrgOfOne } from "../db/org-scope";

export type AuthEnv = {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

/**
 * Builds the Better Auth instance for a given db + env. Exported separately
 * from the request-scoped getter so tests can run it against PGlite.
 */
export function createAuth(db: Db, env: AuthEnv) {
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : undefined;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "pg" }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: github,
    databaseHooks: {
      user: {
        create: {
          // Personal mode = an org of one, identical machinery to Team:
          // every signup gets an org and an admin membership immediately.
          // `after` hooks run post-commit (a failure here can't roll back
          // the user), so bootstrap is idempotent and re-run on demand by
          // any session-bearing page that finds no membership.
          after: async (newUser) => {
            await ensureOrgOfOne(db, newUser);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Request-scoped Better Auth instance for the Worker runtime. Deliberately
 * NOT cached at module scope: the instance holds a DB connection, and
 * Workers cancel any request that touches I/O objects created by an
 * earlier request. Hyperdrive is the pooling layer, not us.
 */
export function getAuth(): Auth {
  const { env } = getCloudflareContext();
  return createAuth(createDb(env), env as AuthEnv);
}
