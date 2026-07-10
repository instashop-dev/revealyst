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
  | "share_card_og_view";

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
