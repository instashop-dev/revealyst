import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { assertDeletableAndPurgeOrg } from "../db/account-deletion";
import { createDb, type Db } from "../db/client";
import { ensureOrgOfOne } from "../db/org-scope";
import { APP_ORIGIN, MARKETING_ORIGIN } from "./domains";
import { type EmailEnv, sendEmail } from "./email";

export type AuthEnv = EmailEnv & {
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
    // The app + auth origin is app.revealyst.com; sign-in always happens there
    // (marketing links/redirects steer users onto it). Trust both custom hosts
    // explicitly so a stray cross-origin request never 403s "Invalid origin"
    // during or after the domain cutover — see src/lib/domains.ts.
    trustedOrigins: [APP_ORIGIN, MARKETING_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg" }),
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
