import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * §15 launch-metrics event sink (W3-P) — view-side events only. Everything
 * derivable from DB rows (signup → connect → backfill → first score, share
 * *creation*, Personal→Team signals) is read by scripts/launch-metrics.ts;
 * this sink exists solely for the events rows can't capture: page views of
 * the landing page and public share cards.
 *
 * Privacy rule (non-negotiable): a data point carries the event name, an
 * optional COARSE dimension (e.g. a score slug), and the public request
 * hostname — never tokens, emails, labels, org ids, person ids, IPs, or
 * user agents. The hostname exists to separate production traffic from CI
 * preview versions, which share this binding and dataset (Analytics Engine
 * has no deletes, so preview pollution would be unfilterable without it).
 *
 * Known conflation, accepted: share_card_view counts every HTML fetch,
 * including crawler fetches during link unfurls (which also fire
 * share_card_og_view). Human views ≈ share_card_view − share_card_og_view;
 * a per-request bot classification would need the user agent, which the
 * privacy rule forbids storing.
 */
export type LaunchEventName =
  | "landing_view"
  | "share_card_view"
  | "share_card_og_view"
  // W5-I flywheel instrumentation. Both fire at the src/worker.ts edge seam
  // (no session, no page render), so they are content-free by construction:
  //  - digest_return: a click-through from a weekly-digest CTA back into the
  //    app (the honest return signal — an open pixel is defeated by privacy
  //    mail clients). Dim = the coarse ISO week the digest was sent (`wk`),
  //    never a user/org id.
  //  - companion_revisit: a full-document view of the companion surface
  //    (/dashboard) — the returning-engagement signal for an AUTHENTICATED
  //    surface. No dim, no identity: repeated views by returning users are
  //    exactly what the count measures.
  | "digest_return"
  | "companion_revisit"
  // TCI §15 manager-engagement instrumentation (P2-B). Fired when the TEAM
  // dashboard (the TeamOverview branch) is viewed. Unlike the three edge-seam
  // events above, this one CANNOT fire at the src/worker.ts seam: the team and
  // personal surfaces share the `/dashboard` path, and the seam is path-based
  // by design (no DB read), so it cannot tell a team org from a personal one —
  // `companion_revisit` already counts BOTH. So team_overview_view is emitted
  // from the TeamOverview server-component render, the one place the org kind
  // is known (page.tsx branched on `org.kind !== "personal"`). No dim, no
  // identity (not even the org id — same privacy rule as companion_revisit):
  // the count of these views over time IS the manager-engagement signal.
  | "team_overview_view";

/**
 * True for a landing-page view to count under §15 `landing_view`. The Worker
 * entry (src/worker.ts) fires the event at this edge seam because the landing
 * page is now a build-time prerender (perf/edge-caching), so the old
 * per-request in-render `trackLaunchEvent` call can no longer exist.
 *
 * Series continuity is the whole point: the OLD write lived inside the
 * force-dynamic render, so it fired for EVERY GET/HEAD of `/` that reached the
 * page — regardless of the `Accept` header. That includes a wildcard `Accept`
 * and a missing/empty `Accept`: curl, uptime monitors, and the many crawlers/
 * scrapers that don't send `text/html` (the crawler-inclusive conflation
 * documented above). So this predicate must NOT gate on `text/html` — doing so
 * would silently step-drop the entire non-`text/html` segment at deploy.
 *
 * The ONE deliberate reduction vs. the old series: RSC soft-navigation /
 * prefetch fetches are excluded. Next marks them with an `RSC` request header
 * (with a wildcard `Accept`); the old in-render write did count them (the
 * server component re-renders for the flight response), but a client-side
 * route transition to `/` is not a landing-page view. Everything else the old
 * path counted, this counts. `isRscRequest` is the caller's `headers.has("rsc")`.
 *
 * (Host is not checked here: the Worker fires this only AFTER the host-split
 * 308 in src/worker.ts, so `/` on the app/legacy host has already redirected
 * away — exactly as the old page only ever rendered on the marketing/preview
 * hosts.)
 */
export function isLandingPageView(
  method: string,
  pathname: string,
  isRscRequest: boolean,
): boolean {
  return (
    (method === "GET" || method === "HEAD") &&
    pathname === "/" &&
    !isRscRequest
  );
}

/**
 * Digest return-rate signal (W5-I): the coarse dimension to record for a
 * `digest_return` event, or null when this request is not a digest click-
 * through. A click-through is a document GET/HEAD (RSC soft-navs excluded, like
 * landing_view) carrying `?src=digest` — the tag `appendDigestUtm` puts on the
 * digest's app-return CTA. The dim is the `wk` value (the ISO week the digest
 * was sent, e.g. "2026-W28") — a coarse bucket, never a user/org id; an empty
 * string when the link somehow lacks `wk`. Pathname is NOT checked: the CTA can
 * target any app path, and `src=digest` is the unambiguous marker.
 */
export function digestReturnDim(
  method: string,
  isRscRequest: boolean,
  src: string | null,
  wk: string | null,
): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (isRscRequest) return null;
  if (src !== "digest") return null;
  return wk ?? "";
}

/**
 * Companion revisit signal (W5-I): true when this request is a full-document
 * view of the companion surface (`/dashboard`) to count under
 * `companion_revisit`. Same shape as isLandingPageView — GET/HEAD, exact path,
 * RSC soft-navigations excluded (a client-side route transition is not a fresh
 * visit). No identity is involved: the count of these views over time IS the
 * returning-engagement signal, without any per-user tracking.
 */
export function isCompanionRevisit(
  method: string,
  pathname: string,
  isRscRequest: boolean,
): boolean {
  return (
    (method === "GET" || method === "HEAD") &&
    pathname === "/dashboard" &&
    !isRscRequest
  );
}

/**
 * TCI §15 team_overview_view signal (P2-B): true when this TeamOverview render
 * should count as a team-dashboard view. Unlike the seam predicates above, the
 * method/path are already implied — the caller is the TeamOverview server
 * component, which only renders for a GET document of `/dashboard` in a team
 * org — so the only thing left to filter is the RSC soft-navigation, exactly
 * as `isCompanionRevisit` does at the seam. A client-side route transition to
 * `/dashboard` re-renders the server component (producing the flight payload)
 * but is not a fresh view; counting it would also push team_overview_view above
 * the `companion_revisit` count that conceptually bounds it (companion_revisit
 * counts non-RSC `/dashboard` views across BOTH personal and team orgs). The
 * caller passes `headers().has("rsc")`.
 */
export function isTeamOverviewView(isRscRequest: boolean): boolean {
  return !isRscRequest;
}

/** Pure write: testable, never throws, no-ops without a dataset binding. */
export function writeLaunchEvent(
  dataset: AnalyticsEngineDataset | undefined,
  name: LaunchEventName,
  dim?: string,
  host?: string,
): void {
  try {
    dataset?.writeDataPoint({
      blobs: [name, dim ?? "", host ?? ""],
      doubles: [1],
      indexes: [name],
    });
  } catch {
    // Metrics must never break a page render.
  }
}

/**
 * Request-scoped variant for pages/routes: resolves the LAUNCH_EVENTS
 * binding from the Workers env plus the request hostname, and no-ops
 * everywhere they don't exist (plain `next dev` without the binding, tests,
 * build-time prerender). Callers must be request-rendered
 * (`dynamic = "force-dynamic"`) or the event fires once at build instead of
 * per view.
 */
export async function trackLaunchEvent(
  name: LaunchEventName,
  dim?: string,
): Promise<void> {
  let dataset: AnalyticsEngineDataset | undefined;
  let host = "";
  try {
    const { env } = getCloudflareContext();
    dataset = (env as { LAUNCH_EVENTS?: AnalyticsEngineDataset })
      .LAUNCH_EVENTS;
    host = (await headers()).get("host") ?? "";
  } catch {
    return; // outside the Workers runtime / request scope
  }
  writeLaunchEvent(dataset, name, dim, host);
}
