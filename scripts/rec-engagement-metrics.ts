// MET-005 rec-engagement rollup: shown/tried/dismissed/snoozed counts per
// (org, rec, period), read straight from src/db/system.ts's recEngagementRollup
// (the one cross-org query — see that function's header for the period-
// derivation and join-approximation notes).
//
// FOUNDER-ONLY AGGREGATE, script-only: the printed rows carry no personId,
// email, or pseudonym — never wire this rollup to a route (no /admin, no
// API). recommendation_exposure is self-view-only by ADR 0038; this script
// is a separate, explicitly cross-org, read-only aggregate for the founder's
// own analysis, exactly like scripts/launch-metrics.ts.
//
// Manually run, not a merge gate — connects to whatever DATABASE_URL points
// at (dev or prod), never CI (same pattern as launch-metrics.ts).
//
//   DATABASE_URL=<neon-connection-string> npx tsx scripts/rec-engagement-metrics.ts
import { createDb } from "../src/db/client";
import { recEngagementRollup, type RecEngagementRollupRow } from "../src/db/system";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

function printRollup(rows: RecEngagementRollupRow[]): void {
  console.log("MET-005 rec-engagement rollup (org, rec, period)");
  if (rows.length === 0) {
    console.log("  (no exposure rows yet)");
    return;
  }
  for (const r of rows) {
    console.log(
      `  org=${r.orgId} rec=${r.recId} period=${r.period}  shown=${r.shown} tried=${r.tried} dismissed=${r.dismissed} snoozed=${r.snoozed}`,
    );
  }
}

async function main() {
  const db = createDb({ DATABASE_URL: DEV_DB_URL });
  const rows = await recEngagementRollup(db);
  printRollup(rows);
  // Flush stdout before exiting: a bare process.exit(0) can truncate piped
  // output (non-TTY stdout is async in node), and the pooled client's
  // 20s idle_timeout would otherwise keep the process alive.
  await new Promise((resolve) => process.stdout.write("", () => resolve(null)));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
