// Host split (see docs/infra.md §6). The single `revealyst` Worker serves two
// custom domains. `app.revealyst.com` is the app + Better Auth origin — every
// authenticated surface lives here. `revealyst.com` is the public marketing
// site (landing today; docs/blog later) and the canonical home of public share
// cards. `src/worker.ts` calls resolveRedirect() to keep each host to its own
// surface; Better Auth (`src/lib/auth.ts` trustedOrigins) and share-link
// minting (`src/components/share-score-button.tsx`) import the origins from
// here, so the split has a single source of truth.
//
// Pure constants + pure functions only — no Next/DB imports. Safe to import
// from both the Worker entrypoint and client components, and unit-testable via
// a relative import (the vitest `@/` alias doesn't resolve at test runtime).

export const APP_HOST = "app.revealyst.com";
export const MARKETING_HOST = "revealyst.com";
export const APP_ORIGIN = `https://${APP_HOST}`;
export const MARKETING_ORIGIN = `https://${MARKETING_HOST}`;

export type Surface = "app" | "marketing" | "neutral";

// Path prefixes owned by the authenticated app surface: the (app) route group
// plus the flat authed routes (sign-in, onboarding, invite). Matched only at a
// path boundary so "/peoplesearch" is not treated as "/people".
export const APP_PATH_PREFIXES = [
  "/dashboard",
  "/teams",
  "/people",
  "/connections",
  "/members",
  "/reconcile",
  "/billing",
  "/compliance",
  "/playbook",
  "/account",
  "/sign-in",
  "/reset-password",
  "/onboarding",
  "/invite",
] as const;

// Served identically on any host — never redirect. Checked FIRST so metadata
// routes under a marketing path (e.g. /s/<token>/opengraph-image, unfurled by
// social scrapers that may not follow a 308) resolve on whatever host asked.
function isNeutralPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.endsWith("/opengraph-image") ||
    pathname.endsWith("/icon") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/health"
  );
}

function matchesAppPrefix(pathname: string): boolean {
  return APP_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Which host surface a path belongs to. Neutral = serve anywhere. */
export function classifyPath(pathname: string): Surface {
  if (isNeutralPath(pathname)) return "neutral";
  if (matchesAppPrefix(pathname)) return "app";
  if (
    pathname === "/" ||
    pathname === "/legal" ||
    pathname.startsWith("/legal/") ||
    pathname.startsWith("/s/")
  ) {
    return "marketing";
  }
  return "neutral";
}

const CANONICAL_HOST: Record<Exclude<Surface, "neutral">, string> = {
  app: APP_HOST,
  marketing: MARKETING_HOST,
};

/**
 * Absolute URL to move a request to its surface's canonical host, or null to
 * serve it as-is. Only acts on safe methods (GET/HEAD) and only when the
 * incoming host is one of our two custom domains — so workers.dev, the OpenNext
 * self-reference subrequest, and localhost dev all pass straight through, and a
 * POST / server action is never replayed cross-host.
 */
export function resolveRedirect(
  host: string,
  method: string,
  pathname: string,
  search: string,
): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (host !== APP_HOST && host !== MARKETING_HOST) return null;
  const surface = classifyPath(pathname);
  if (surface === "neutral") return null;
  const target = CANONICAL_HOST[surface];
  if (host === target) return null;
  return `https://${target}${pathname}${search}`;
}

/**
 * Rewrite an app-host origin to the marketing origin — for minting public share
 * URLs from inside the app. Any other origin (localhost in dev, or already the
 * marketing host) is returned unchanged so dev links keep working.
 */
export function toMarketingOrigin(origin: string): string {
  try {
    return new URL(origin).hostname === APP_HOST ? MARKETING_ORIGIN : origin;
  } catch {
    return origin;
  }
}
