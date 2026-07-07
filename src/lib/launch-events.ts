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
