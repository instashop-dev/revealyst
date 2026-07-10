import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { assertDeletableAndPurgeOrg } from "../db/account-deletion";
import { createDb, type Db } from "../db/client";
import { ensureOrgOfOne, forOrg } from "../db/org-scope";
import { ensureSystemOrg } from "../db/system";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "../poller/messages";
import {
  type AdminEnv,
  isPlatformAdmin,
  parseAdminUserIds,
} from "./admin-access";
import { APP_ORIGIN, MARKETING_ORIGIN } from "./domains";
import { type EmailEnv, sendEmail } from "./email";

export type AuthEnv = EmailEnv &
  AdminEnv & {
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
  };

// The only admin-plugin endpoints that are ALLOWED (ADR 0016) — everything
// else under /admin/* is 403'd in hooks.before, fail-closed, so a better-auth
// upgrade that adds or renames a mutation endpoint can never ship unguarded
// or unaudited. Deliberately cut (and so absent below):
// - remove-user: deletes via the internal adapter and BYPASSES
//   deleteUser.beforeDelete → would skip assertDeletableAndPurgeOrg and
//   strand org rows (violates ADR 0015's purge invariant). Users self-delete
//   via /account.
// - create-user / update-user / set-user-password: profile writes are cut
//   (view-only admin), and update-user's generic `data` payload could set
//   role/banned — bypassing the set-role/ban guards AND the audit trail.
// - revoke-user-session(s): session-revocation UI is cut; ban (audited)
//   covers the emergency.
const ALLOWED_ADMIN_PATHS = new Set([
  // read-only
  "/admin/list-users",
  "/admin/get-user",
  "/admin/list-user-sessions",
  "/admin/has-permission",
  // audited mutations (hooks.after below)
  "/admin/set-role",
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
]);

// Mutations whose TARGET must not be a platform admin (blocks the
// "impersonate/ban/demote admin B, act as B" escalations), and whose target
// must not be the caller for set-role/ban (lockout protection).
const TARGET_GUARDED_ADMIN_PATHS = new Set([
  "/admin/impersonate-user",
  "/admin/ban-user",
  "/admin/set-role",
]);
const SELF_GUARDED_ADMIN_PATHS = new Set(["/admin/ban-user", "/admin/set-role"]);

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
    // The app + auth origin is app.revealyst.com; sign-in always happens there
    // (marketing links/redirects steer users onto it). Trust both custom hosts
    // explicitly so a stray cross-origin request never 403s "Invalid origin"
    // during or after the domain cutover — see src/lib/domains.ts.
    trustedOrigins: [APP_ORIGIN, MARKETING_ORIGIN],
    // Where OAuth-callback/redirect failures land (e.g. state_mismatch,
    // access_denied when the user cancels at GitHub). Without this, Better
    // Auth's production /error page 302s to `/?error=<code>` — the marketing
    // root, which silently swallows the query param, so the 2026-07-09
    // state_not_found incident was invisible to the user. The sign-in page
    // reads `?error=` and shows a friendly message (src/app/sign-in/page.tsx).
    // Relative on purpose: resolves against whichever host served the
    // callback, so localhost dev keeps working.
    onAPIError: { errorURL: "/sign-in" },
    database: drizzleAdapter(db, { provider: "pg" }),
    // Collapses getSession's session-then-user lookup (better-auth
    // internal-adapter findSession -> findOne join:{user:true}) into a
    // single db.query.session.findFirst({ with: { user: true } }) SQL join
    // instead of two sequential round-trips. This is a top-level betterAuth
    // option (NOT a drizzleAdapter config field — the adapter reads
    // `options.experimental?.joins` off the full BetterAuthOptions it's
    // invoked with, per @better-auth/drizzle-adapter/dist/index.mjs). Also
    // requires drizzle relations() for the session/user tables, wired into
    // the schema passed to drizzle() in src/db/client.ts
    // (src/db/auth-relations.ts) — without them the adapter falls back to
    // the old two-query path and logs "Falling back to regular query".
    experimental: { joins: true },
    emailAndPassword: {
      enabled: true,
      // Signup requires a confirmed email: sign-in throws 403
      // EMAIL_NOT_VERIFIED until the address is verified. Existing users are
      // backfilled to verified by migration 0018 so this doesn't lock them out.
      requireEmailVerification: true,
      // A password reset is often an account-recovery action (the user
      // suspects their credential leaked) — revoke any other live sessions so
      // the reset actually locks a compromised session out, matching
      // change-password-form.tsx's revokeOtherSessions: true.
      revokeSessionsOnPasswordReset: true,
      // NOTE: better-auth invokes this via `runInBackgroundOrAwait`, which
      // catches and only logs a thrown error — it never reaches the client,
      // even though sendEmail() throws on a real SES failure. A failed send
      // here is therefore silent: the caller sees success. Known limitation
      // (ADR 0015); mitigate by keeping SES healthy, not by relying on this
      // throw to surface anything.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Revealyst password",
          html: `<p>We received a request to reset your Revealyst password.</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link expires soon. If you didn't request it, you can ignore this email.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Clicking the link verifies the address and signs the user in, landing
      // them on the callbackURL passed from the sign-up form.
      autoSignInAfterVerification: true,
      // Same runInBackgroundOrAwait caveat as sendResetPassword above: a
      // failed send is swallowed, not surfaced to the sign-up caller.
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Confirm your Revealyst email",
          html: `<p>Welcome to Revealyst! Confirm your email to finish signing up.</p>
<p><a href="${url}">Confirm your email</a></p>
<p>If you didn't create an account, you can ignore this email.</p>`,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Gates + tears down the user's personal org-of-one (ADR 0015).
        // Fires on the immediate path (no sendDeleteAccountVerification
        // configured): with a password for credential accounts, or — for
        // OAuth-only accounts with no password — on a fresh session (Better
        // Auth's default session.freshAge, 24h) per delete-account-dialog.tsx.
        // Throwing aborts the delete.
        beforeDelete: async (user) => {
          await assertDeletableAndPurgeOrg(db, user.id);
        },
      },
    },
    socialProviders: github,
    // Platform-admin console (ADR 0016). Mounts /api/auth/admin/* (list-users,
    // set-role, ban/unban-user, impersonate-user, stop-impersonating, ...).
    // Bootstrap staff via the ADMIN_USER_IDS Worker secret; day-2 admins are
    // promoted with the audited set-role endpoint. defaultRole "user" — a
    // NULL role column also reads as "user" (src/lib/admin-access.ts).
    //
    // TRIPWIRE: session cookieCache is currently DISABLED, so `user.banned`
    // and `session.impersonatedBy` are read fresh from the database on every
    // request — a ban or stop-impersonation takes effect immediately. If
    // cookieCache is ever enabled, those reads lag by the cache TTL and every
    // admin gate (requireAdminContext, handleAdminApi, the plugin's own
    // banned-user check) must be revisited before shipping.
    plugins: [
      admin({
        adminUserIds: parseAdminUserIds(env),
        defaultRole: "user",
        impersonationSessionDuration: 60 * 60, // 1h — support sessions, not shifts
      }),
    ],
    // Guard + audit at the auth-handler level (ADR 0016): the plugin mounts
    // its endpoints regardless, so wrapper routes would be bypassable. These
    // hooks run on every Better Auth endpoint — non-/admin/* paths return
    // immediately.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/admin/")) return;
        if (!ALLOWED_ADMIN_PATHS.has(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            message: "This admin endpoint is disabled (ADR 0016).",
          });
        }
        if (!TARGET_GUARDED_ADMIN_PATHS.has(ctx.path)) return;
        // The guards below only matter for callers the endpoint would let
        // through. Running them first would leak an oracle: an
        // unauthenticated or non-admin caller probing userIds could tell
        // platform admins apart by the distinctive 403 — so anyone else
        // falls through to the endpoint's own 401/403 instead.
        const session = await getSessionFromCtx(ctx);
        if (!session || !isPlatformAdmin(session.user, env)) return;
        // Keep the role model binary ("user" | "admin"): a compound role like
        // "admin,user" would read as admin to the plugin's split(",") checks
        // but not to isPlatformAdmin's exact match — a hidden-admin hole.
        if (ctx.path === "/admin/set-role") {
          const role: unknown = ctx.body?.role;
          if (role !== "user" && role !== "admin") {
            throw new APIError("BAD_REQUEST", {
              message: 'Platform roles are binary: "user" or "admin".',
            });
          }
        }
        // Mirror the endpoint schemas' z.coerce.string() so a coercible
        // non-string target can't slip past the guard while the endpoint
        // still acts on the coerced id.
        const rawTargetId: unknown = ctx.body?.userId;
        const targetId = rawTargetId == null ? "" : String(rawTargetId);
        if (targetId.length === 0) {
          return; // the endpoint's own body schema 400s it
        }
        // Self set-role/ban is a lockout footgun (demote/ban yourself, lose
        // the only admin). The plugin only 400s self-ban; block both here.
        if (
          SELF_GUARDED_ADMIN_PATHS.has(ctx.path) &&
          session.user.id === targetId
        ) {
          throw new APIError("FORBIDDEN", {
            message: "You cannot change your own platform role or ban yourself.",
          });
        }
        // Admin-on-admin actions are blocked outright: impersonating, banning,
        // or demoting another platform admin is a privilege-escalation /
        // staff-abuse surface. Covers both role="admin" AND ADMIN_USER_IDS.
        const target = (await ctx.context.internalAdapter.findUserById(
          targetId,
        )) as { id: string; role?: string | null } | null;
        if (target && isPlatformAdmin(target, env)) {
          throw new APIError("FORBIDDEN", {
            message: "This action cannot target a platform admin.",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/admin/")) return;
        // Failed calls land here too, with the APIError as the returned
        // value — only record mutations that actually happened.
        const returned = ctx.context.returned;
        if (!returned || returned instanceof Error) return;
        let entry: {
          action: string;
          actorUserId: string | null;
          targetId: string | null;
          metadata?: Record<string, unknown>;
        } | null = null;
        switch (ctx.path) {
          case "/admin/impersonate-user": {
            const r = returned as {
              session: { impersonatedBy?: string | null };
              user: { id: string };
            };
            entry = {
              action: "admin.impersonate.start",
              actorUserId: r.session.impersonatedBy ?? null,
              targetId: r.user.id,
            };
            break;
          }
          case "/admin/stop-impersonating": {
            // The request's session is the impersonated one — the handler
            // cached it on ctx.context before deleting the row. Its user is
            // the impersonation TARGET; its impersonatedBy is the admin.
            const impersonated = ctx.context.session;
            entry = {
              action: "admin.impersonate.stop",
              actorUserId:
                impersonated?.session.impersonatedBy ??
                (returned as { user: { id: string } }).user.id,
              targetId: impersonated?.user.id ?? null,
            };
            break;
          }
          case "/admin/set-role":
          case "/admin/ban-user":
          case "/admin/unban-user": {
            const actor = await getSessionFromCtx(ctx);
            const action =
              ctx.path === "/admin/set-role"
                ? "admin.role.set"
                : ctx.path === "/admin/ban-user"
                  ? "admin.user.ban"
                  : "admin.user.unban";
            entry = {
              action,
              actorUserId: actor?.user.id ?? null,
              targetId:
                typeof ctx.body?.userId === "string" ? ctx.body.userId : null,
              // ids and short labels only — never secrets (ADR 0010).
              metadata:
                ctx.path === "/admin/set-role"
                  ? { role: ctx.body?.role }
                  : ctx.path === "/admin/ban-user"
                    ? { reason: ctx.body?.banReason ?? null }
                    : undefined,
            };
            break;
          }
          default:
            return;
        }
        // Internal-only accountability: admin actions land in the SYSTEM
        // org's audit log, never in a customer org's (ADR 0016). A failed
        // write throws — loud beats silently-unaudited admin power.
        await ensureSystemOrg(db, SYSTEM_ORG_ID, SYSTEM_ORG_NAME);
        await forOrg(db, SYSTEM_ORG_ID).auditLog.record({
          actorUserId: entry.actorUserId,
          action: entry.action,
          targetKind: "user",
          targetId: entry.targetId,
          metadata: entry.metadata,
        });
      }),
    },
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
