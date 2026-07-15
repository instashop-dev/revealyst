// T1.7 — OQ-001 exit-gate query (digest-return rate): the trailing-N-week
// digest→companion return ratio, read straight from the Workers Analytics
// Engine SQL API. This turns OQ-001's metric into a committed, reviewable
// computation instead of an ad hoc dashboard glance.
//
// `digest_return` / `companion_revisit` are written at the src/worker.ts edge
// seam (src/lib/launch-events.ts, `writeLaunchEvent`) into the
// `revealyst_launch_events` dataset (binding `LAUNCH_EVENTS`, see
// wrangler.jsonc). Verified column layout (writeLaunchEvent's writeDataPoint
// call): blob1 = event name, blob2 = dim, blob3 = host, index1 = event name,
// double1 = 1. `digest_return`'s blob2 is the digest's send week (`wk`, e.g.
// "2026-W28"); `companion_revisit` is written with NO dim at all (blob2 is
// always ""). So this script does NOT group by blob2 — it derives the week
// bucket for BOTH event types from each row's own Analytics Engine
// `timestamp` column instead (`toStartOfWeek(timestamp, 1)` — mode 1 =
// Monday-start, matching isoWeekString's ISO-8601 weeks; the ClickHouse
// default mode 0 is Sunday-start and would mislabel most of each ISO week
// into the previous bucket), which is the only
// column both event types actually carry. See src/lib/digest-return-rate.ts's
// doc comment for the full explanation and the ratio's honest semantics
// (a coarse aggregate index, not a per-user funnel — the two streams carry
// no identity and cannot be joined).
//
// Manually run, not a merge gate — same trust tier as scripts/launch-metrics.ts
// (which reads the row-derivable half of §14/§15; this script reads the
// view-side half that only exists in Analytics Engine). Never wired into CI.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
//     npx tsx scripts/digest-return-rate.ts [--weeks 6]
//
// The API token needs the "Account Analytics: Read" permission (Analytics
// Engine SQL API scope) for CLOUDFLARE_ACCOUNT_ID.
//
// IMPORTANT — no threshold is baked in here, and none should be added without
// a founder sign-off: OQ-001's pass/fail bar for this ratio is an unsigned
// founder decision (Closure Execution Plan §6, decision D1 — default "6
// weeks, founder-org dogfood" if unconfirmed).
// This script reports the ratio only; it is the founder's job to read it
// against whatever bar they sign off on, not this script's.

import { isoWeekString } from "../src/lib/digest-content";
import {
  computeDigestReturnRate,
  type DigestReturnRateRow,
} from "../src/lib/digest-return-rate";

const DATASET = "revealyst_launch_events"; // wrangler.jsonc analytics_engine_datasets binding LAUNCH_EVENTS
const DEFAULT_WEEKS = 6;
const MAX_WEEKS = 52; // sanity cap — this is interpolated into the SQL INTERVAL below

interface AeSqlResponse {
  success: boolean;
  errors: { message: string }[];
  result?: {
    data: { event: string; week_start: string; count: number | string }[];
    rows: number;
  };
}

function parseWeeksArg(argv: string[]): number {
  const eq = argv.find((a) => a.startsWith("--weeks="));
  if (eq) {
    return Number(eq.slice("--weeks=".length));
  }
  const idx = argv.indexOf("--weeks");
  if (idx !== -1 && argv[idx + 1] !== undefined) {
    return Number(argv[idx + 1]);
  }
  return DEFAULT_WEEKS;
}

/** Analytics Engine SQL API returns datetimes as "YYYY-MM-DD HH:MM:SS" (UTC,
 * no offset marker). Normalize to a parseable ISO string. */
function parseAeDatetime(value: string): Date {
  const withT = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /Z|[+-]\d\d:?\d\d$/.test(withT) ? withT : `${withT}Z`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`digest-return-rate: unparseable Analytics Engine timestamp "${value}"`);
  }
  return date;
}

function fmtRatio(r: number | null): string {
  return r === null ? "— (no digest_return events)" : `${(r * 100).toFixed(0)}%`;
}

async function queryAnalyticsEngine(
  accountId: string,
  apiToken: string,
  weeks: number,
): Promise<DigestReturnRateRow[]> {
  const sql = `
    SELECT
      blob1 AS event,
      toStartOfWeek(timestamp, 1) AS week_start,
      SUM(_sample_interval) AS count
    FROM ${DATASET}
    WHERE blob1 IN ('digest_return', 'companion_revisit')
      AND timestamp > NOW() - INTERVAL '${weeks}' WEEK
    GROUP BY event, week_start
    ORDER BY week_start
  `.trim();

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: sql,
    },
  );

  const body = (await res.json()) as AeSqlResponse;
  if (!res.ok || !body.success || !body.result) {
    const messages = body.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Analytics Engine SQL API error: ${messages}`);
  }

  return body.result.data.map((r) => ({
    event: r.event,
    wk: isoWeekString(parseAeDatetime(r.week_start)),
    count: Number(r.count),
  }));
}

async function main() {
  const weeksArg = parseWeeksArg(process.argv.slice(2));
  if (!Number.isInteger(weeksArg) || weeksArg < 1 || weeksArg > MAX_WEEKS) {
    console.error(
      `--weeks must be an integer between 1 and ${MAX_WEEKS} (got ${process.argv})`,
    );
    process.exit(1);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    console.error(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read scope) to run this script.",
    );
    process.exit(1);
  }

  const rows = await queryAnalyticsEngine(accountId, apiToken, weeksArg);
  const result = computeDigestReturnRate(rows, { weeks: weeksArg, now: new Date() });

  console.log(
    `OQ-001 exit-gate metric — trailing ${weeksArg}-week digest→companion return ratio`,
  );
  console.log(
    "(companion_revisit ÷ digest_return per week; coarse aggregate index, not a per-user funnel — see src/lib/digest-return-rate.ts)",
  );
  console.log(
    "NOTE: this script reports the ratio only. No pass/fail threshold is baked in — the",
  );
  console.log(
    "bar for OQ-001 is an unsigned founder decision (Closure Execution Plan §6, D1).",
  );
  console.log("");
  for (const w of result.weeks) {
    console.log(
      `  ${w.wk}  digest_return=${w.digestReturns}  companion_revisit=${w.companionRevisits}  ratio=${fmtRatio(w.ratio)}`,
    );
  }
  console.log("");
  console.log(
    `  overall  digest_return=${result.overall.digestReturns}  companion_revisit=${result.overall.companionRevisits}  ratio=${fmtRatio(result.overall.ratio)}`,
  );

  await new Promise((resolve) => process.stdout.write("", () => resolve(null)));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
