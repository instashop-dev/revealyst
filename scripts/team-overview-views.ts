// TCI §15 (P2-B) — team_overview_view weekly counts, read straight from the
// Workers Analytics Engine SQL API. This is the read-side gauge for the
// manager-engagement event emitted from the TeamOverview render
// (src/app/(app)/dashboard/team-overview.tsx via trackLaunchEvent).
//
// `team_overview_view` is written via `writeLaunchEvent`
// (src/lib/launch-events.ts) into the `revealyst_launch_events` dataset
// (binding LAUNCH_EVENTS, see wrangler.jsonc). Verified column layout
// (writeLaunchEvent's writeDataPoint call): blob1 = event name, blob2 = dim,
// blob3 = host, index1 = event name, double1 = 1. team_overview_view is
// written with NO dim (blob2 is always "") and carries no identity — not even
// the org id (privacy rule, launch-events.ts) — so this script groups only by
// the week bucket derived from each row's own Analytics Engine `timestamp`
// column (`toStartOfWeek(timestamp, 1)` — mode 1 = Monday-start, matching
// isoWeekString's ISO-8601 weeks; the ClickHouse default mode 0 is Sunday-start
// and would mislabel most of each ISO week into the previous bucket).
//
// Honesty (review invariant b): this prints the weeks Analytics Engine actually
// returns rows for, plus a total. It does NOT zero-fill weeks with no rows: an
// absent week could mean "zero team-overview views" OR "no data collected yet"
// (e.g. before the event shipped, or on a preview version), and the two are
// indistinguishable from the counts alone — a fabricated 0 would assert the
// former. An empty result prints an explicit not-evaluable line, never a table
// of zeros. There is NO baked pass/fail threshold: TCI §15's engagement targets
// are unsigned, so this stays a manually-run founder gauge, never a CI gate —
// same trust tier as scripts/digest-return-rate.ts.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
//     npx tsx scripts/team-overview-views.ts [--weeks 6]
//
// The API token needs the "Account Analytics: Read" permission (Analytics
// Engine SQL API scope) for CLOUDFLARE_ACCOUNT_ID.

import { isoWeekString } from "../src/lib/digest-content";

const DATASET = "revealyst_launch_events"; // wrangler.jsonc analytics_engine_datasets binding LAUNCH_EVENTS
const EVENT = "team_overview_view";
const DEFAULT_WEEKS = 6; // unsigned window — a plain trailing view, no gate bar
const MAX_WEEKS = 52; // sanity cap — interpolated into the SQL INTERVAL below

interface AeSqlResponse {
  success: boolean;
  errors: { message: string }[];
  result?: {
    data: { week_start: string; count: number | string }[];
    rows: number;
  };
}

interface WeeklyCount {
  wk: string;
  count: number;
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
    throw new Error(
      `team-overview-views: unparseable Analytics Engine timestamp "${value}"`,
    );
  }
  return date;
}

async function queryAnalyticsEngine(
  accountId: string,
  apiToken: string,
  weeks: number,
): Promise<WeeklyCount[]> {
  const sql = `
    SELECT
      toStartOfWeek(timestamp, 1) AS week_start,
      SUM(_sample_interval) AS count
    FROM ${DATASET}
    WHERE blob1 = '${EVENT}'
      AND timestamp > NOW() - INTERVAL '${weeks}' WEEK
    GROUP BY week_start
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
    const messages =
      body.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Analytics Engine SQL API error: ${messages}`);
  }

  return body.result.data.map((r) => ({
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

  console.log(
    `TCI §15 metric — team_overview_view counts, trailing ${weeksArg} weeks (per ISO week)`,
  );
  console.log(
    "(a team-dashboard view; content-free, no identity — see src/lib/launch-events.ts)",
  );
  console.log("");

  if (rows.length === 0) {
    // Honesty rule (invariant b): no rows is "not evaluable" — could be zero
    // views OR no data collected yet — never a fabricated table of zeros.
    console.log(
      "  NOT EVALUABLE — zero team_overview_view rows in the window (the event may",
    );
    console.log(
      "  not have been collected yet, or no team dashboard was viewed).",
    );
  } else {
    let total = 0;
    for (const w of rows) {
      total += w.count;
      console.log(`  ${w.wk}  team_overview_view=${w.count}`);
    }
    console.log("");
    console.log(`  total  team_overview_view=${total}`);
  }

  await new Promise((resolve) => process.stdout.write("", () => resolve(null)));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
