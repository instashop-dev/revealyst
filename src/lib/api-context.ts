import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, type Db } from "@/db/client";
import { orgContextForUser } from "@/db/org-context";
import { ensureOrgOfOne, forOrg } from "@/db/org-scope";
import { createAuth, type AuthEnv } from "@/lib/auth";
import type { CredentialEnv } from "@/lib/credentials";

/**
 * Request-scoped context for authenticated pages and API routes: one db
 * connection, one Better Auth instance, the session, the user's org
 * context (org + role), and the org-scoped repository (`forOrg`) — the
 * only sanctioned query surface. Allowlisted in check-org-scope.mjs as
 * the shared request entrypoint so individual pages/routes never call
 * createDb themselves.
 *
 * Wrapped in React `cache` so a layout and its page share one lookup per
 * request. Never cached at module scope: Workers cancel cross-request I/O.
 */
export const appContext = cache(async () => {
  const { env } = getCloudflareContext();
  const db = createDb(env);
  const auth = createAuth(db, env as AuthEnv);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  // Self-heals a user whose signup-time org bootstrap failed (the auth
  // `after` hook runs post-commit and can't be rolled back into signup).
  await ensureOrgOfOne(db, session.user);
  const orgContext = await orgContextForUser(db, session.user.id);
  if (!orgContext) {
    return null;
  }
  return {
    env,
    db,
    session,
    user: session.user,
    org: orgContext.org,
    role: orgContext.role,
    scope: forOrg(db, orgContext.org.id),
  };
});

export type AppContext = NonNullable<Awaited<ReturnType<typeof appContext>>>;

/** Page variant: bounce unauthenticated visitors to sign-in. Pass the
 * current path so sign-in can return the visitor here (invite links). */
export async function requireAppContext(nextPath?: string): Promise<AppContext> {
  const ctx = await appContext();
  if (!ctx) {
    redirect(
      nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in",
    );
  }
  return ctx;
}

/**
 * Request-scoped context for API route handlers — the single allowlisted
 * createDb seam for routes (ADR 0002; scripts/check-org-scope.mjs), so
 * individual route files never touch the client factory. Deliberately NOT
 * cached at module scope: Workers cancel cross-request I/O.
 */
export function getApiContext(): { db: Db; env: CredentialEnv } {
  const { env } = getCloudflareContext();
  return { db: createDb(env), env: env as CredentialEnv };
}
