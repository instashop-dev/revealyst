// Pure helpers for the /sign-in error surface — no React, unit-tested in
// tests/sign-in-error-codes.test.ts.

// Failures redirected onto /sign-in arrive two ways:
//   1. OAuth-callback failures as a top-level ?error=<code> (Better Auth's
//      onAPIError.errorURL, src/lib/auth.ts) — lowercase snake codes.
//   2. Email-verification link failures embedded in ?next=: better-auth
//      redirects them to `<callbackURL>?error=<CODE>` (uppercase, e.g.
//      /dashboard?error=TOKEN_EXPIRED for an expired confirmation link), the
//      signed-out (app)-layout bounce then carries that whole URL here as
//      `next` (middleware x-search → requireAppContext).
// Map the codes a user can realistically hit to a sentence; anything else
// shows generically WITH the code, so a report like the 2026-07-09
// state_not_found incident carries its diagnostic on-screen instead of dying
// invisibly on the marketing root.
export function describeAuthRedirectError(code: string): string {
  switch (code) {
    case "access_denied":
      return "GitHub sign-in was cancelled. You can try again.";
    case "state_not_found":
    case "state_mismatch":
      return "GitHub sign-in took too long or was interrupted — please try again.";
    case "email_not_found":
      return "GitHub didn't share an email address for your account. Add a public email on GitHub or sign in with email and password.";
    // Email-verification link failures (better-auth BASE_ERROR_CODES). There
    // is no email address in the redirect, so we can't offer a one-click
    // resend — signing in with an unverified email triggers the
    // EMAIL_NOT_VERIFIED path on this page, which does have the resend button.
    case "TOKEN_EXPIRED":
      return "That confirmation link has expired. Sign in with your email and password to get a fresh one.";
    case "INVALID_TOKEN":
      return "That confirmation link is invalid or was already used. Try signing in — if your email is already confirmed, it will just work.";
    case "USER_NOT_FOUND":
      return "We couldn't find an account for that confirmation link. Create an account to get started.";
    default:
      // ?error= is attacker-influenceable (anyone can craft the link), so
      // only echo it when it looks like a machine code — never free text
      // inside our own trusted error UI.
      return /^[a-z0-9_-]{1,40}$/i.test(code)
        ? `Sign-in failed (${code}). Please try again.`
        : "Sign-in failed. Please try again.";
  }
}

/**
 * Pull an `error` code that rode along inside the `next` destination's own
 * query (case 2 above) out of it, returning the cleaned destination — so the
 * post-sign-in landing doesn't re-carry a stale `?error=` into the app.
 * `next` is already validated as a same-origin absolute path by the caller.
 */
export function splitNextError(next: string): {
  next: string;
  error: string | null;
} {
  let url: URL;
  try {
    // Base host is arbitrary — only used to parse the relative path.
    url = new URL(next, "http://internal");
  } catch {
    return { next, error: null };
  }
  const error = url.searchParams.get("error");
  if (error === null) return { next, error: null };
  url.searchParams.delete("error");
  return { next: `${url.pathname}${url.search}${url.hash}`, error };
}
