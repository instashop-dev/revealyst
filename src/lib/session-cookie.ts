/**
 * The raw session token from Better Auth's session cookie, or null. Better
 * Auth stores `<token>.<hmac>` under `<prefix>.session_token` (default prefix
 * "better-auth"; `__Secure-`-prefixed when secure cookies are on — the prod
 * https origin); the DB `session.token` column holds the first segment. The
 * match is on the `.session_token` SUFFIX so a future
 * `advanced.cookiePrefix` in src/lib/auth.ts can't silently disable the
 * prefetch. Used ONLY to key `appContext`'s speculative org-context prefetch
 * — never to authenticate (Better Auth's getSession stays the sole
 * authority; a wrong-token match just fails the userId cross-check and falls
 * back to the sequential path; see src/lib/api-context.ts).
 */
export function sessionTokenFromCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name.endsWith(".session_token")) {
      try {
        const token = decodeURIComponent(part.slice(eq + 1).trim()).split(".")[0];
        return token.length > 0 ? token : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
