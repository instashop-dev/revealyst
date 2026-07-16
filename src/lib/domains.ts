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

// The legacy production hostname (live from W0-B until the custom-domain
// cutover). Old links and share cards may still point here, so GET/HEAD
// requests for app/marketing pages 308 to their canonical host. Neutral
// paths (API, metadata images, robots) are still SERVED here — same scraper
// rationale as isNeutralPath, plus old API GETs (health monitors, the
// Server-Timing gauge) must keep resolving, and a cross-host redirect makes
// fetch/curl strip Authorization headers. EXACT match only: CI preview
// versions (`<version>-revealyst.thapi.workers.dev`) keep serving in place,
// and non-safe methods (old webhook/CLI POSTs) are served rather than
// replayed cross-host. Requires `workers_dev: true` in wrangler.jsonc —
// adding custom-domain routes made wrangler disable the subdomain entirely
// (Cloudflare edge answered 404 "error code: 1042" without invoking the
// Worker), which is what actually broke old links after the cutover.
export const WORKERS_DEV_HOST = "revealyst.thapi.workers.dev";

export type Surface = "app" | "marketing" | "neutral";

// Path prefixes owned by the authenticated app surface: the (app) route group
// plus the flat authed routes (sign-in, onboarding, invite). Matched only at a
// path boundary so "/peoplesearch" is not treated as "/people".
export const APP_PATH_PREFIXES = [
  "/admin",
  "/dashboard",
  // /teams, /people, /members, /billing, /account are consolidated under
  // /settings (U3) and now 308 to their new homes — kept here so those redirect
  // pages still resolve on the app host.
  "/team",
  "/teams",
  "/people",
  "/connections",
  "/members",
  "/reconcile",
  "/billing",
  "/compliance",
  "/playbook",
  "/account",
  "/settings",
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
    pathname === "/health" ||
    // The OTel receiver (/v1/metrics, /v1/logs): never redirect. These paths
    // were already neutral via classifyPath's fall-through (and the exporter
    // only POSTs, which resolveRedirect never redirects) — this entry makes
    // the classification EXPLICIT and test-pinned, because the stakes of a
    // future classification change are high: the Claude Code OTLP exporter
    // doesn't follow 308s, and a cross-host redirect strips the
    // Authorization (device-token) header.
    pathname.startsWith("/v1/")
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
 * serve it as-is. Only acts on safe methods (GET/HEAD) — a POST / server
 * action is never replayed cross-host — and only on known hosts: the two
 * custom domains swap surfaces between each other, and the legacy
 * WORKERS_DEV_HOST moves app/marketing pages to their canonical host
 * (docs/infra.md §6 — the migration end-state deferred at the cutover).
 * Neutral paths never redirect on ANY host, and unknown hosts (localhost
 * dev, CI preview versions, the OpenNext self-reference subrequest) pass
 * straight through.
 */
export function resolveRedirect(
  host: string,
  method: string,
  pathname: string,
  search: string,
): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const surface = classifyPath(pathname);
  if (surface === "neutral") return null;
  const canonicalOrigin =
    surface === "marketing" ? MARKETING_ORIGIN : APP_ORIGIN;
  if (host === WORKERS_DEV_HOST) {
    return `${canonicalOrigin}${pathname}${search}`;
  }
  if (host !== APP_HOST && host !== MARKETING_HOST) return null;
  if (host === CANONICAL_HOST[surface]) return null;
  return `${canonicalOrigin}${pathname}${search}`;
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
