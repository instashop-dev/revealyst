import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, probeDbConnection, type Db } from "@/db/client";
import { orgContextForUser } from "@/db/org-context";
import { ensureOrgOfOne, forOrg } from "@/db/org-scope";
import { isPlatformAdmin } from "@/lib/admin-access";
import { createAuth, type AuthEnv } from "@/lib/auth";
import type { CredentialEnv } from "@/lib/credentials";
import { timeStage } from "@/lib/request-timing";

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
  // Opt-in only (REQUEST_TIMING_DB_PROBE=1) — see probeDbConnection's doc
  // comment. No-ops (and adds no await-visible delay) when unset.
  await probeDbConnection(db, env);
  const auth = createAuth(db, env as AuthEnv);
  const requestHeaders = await headers();
  const session = await timeStage("session", () =>
    auth.api.getSession({ headers: requestHeaders }),
  );
  if (!session) {
    return null;
  }
  // Try the org context first — the common case resolves in one read and
  // skips the self-heal round-trip entirely. Only fall back to
  // ensureOrgOfOne (self-heals a user whose signup-time org bootstrap
  // failed — the auth `after` hook runs post-commit and can't be rolled
  // back into signup) when no org context resolves, then re-check: a miss
  // here is a strict superset of what ensureOrgOfOne's existence check
  // needs, so this preserves self-heal semantics while saving a DB
  // round-trip on every warm request.
  let orgContext = await timeStage("orgContext", async () => {
    let ctx = await orgContextForUser(db, session.user.id);
    if (!ctx) {
      await ensureOrgOfOne(db, session.user);
      ctx = await orgContextForUser(db, session.user.id);
    }
    return ctx;
  });
  if (!orgContext) {
    return null;
  }
  return {
    env,
    db,
    session,
    user: session.user,
    org: orgContext.org,
    // Per-org membership role ("admin" | "member") — NOT the platform role.
    role: orgContext.role,
    // Platform staff (ADR 0016): user.role === "admin" or ADMIN_USER_IDS.
    // Kept as a boolean, never a second `role` field — that name is taken.
    isPlatformAdmin: isPlatformAdmin(session.user, env as AuthEnv),
    scope: forOrg(db, orgContext.org.id),
  };
});

export type AppContext = NonNullable<Awaited<ReturnType<typeof appContext>>>;

/** Page variant: bounce unauthenticated visitors to sign-in, carrying the
 * destination (path + query) as ?next= so deep links round-trip and error
 * params riding the query survive to a page that can show them (e.g. an
 * expired email-verification link's /dashboard?error=TOKEN_EXPIRED — see
 * src/app/sign-in/error-codes.ts). When no explicit nextPath is given, it is
 * derived from the middleware-forwarded x-pathname/x-search headers: the
 * (app) layout and its page call requireAppContext CONCURRENTLY, and pages
 * pass no argument — whichever redirect wins the render race must carry the
 * same ?next=, so the default cannot be a bare /sign-in. */
export async function requireAppContext(nextPath?: string): Promise<AppContext> {
  const ctx = await appContext();
  if (!ctx) {
    let next = nextPath;
    if (!next) {
      const requestHeaders = await headers();
      const pathname = requestHeaders.get("x-pathname");
      next = pathname
        ? `${pathname}${requestHeaders.get("x-search") ?? ""}`
        : undefined;
    }
    redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
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
