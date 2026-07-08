// One-off: recompute scores now (ADR 0014 companion). After the person-level
// presets are seeded (drizzle/0017 backfill + ensureOrgOfOne), an existing
// personal org still has no score_results until a recompute runs — the
// nightly `0 2 * * *` cron would eventually do it, this makes the dashboard
// show scores immediately. Mirrors the "score-recompute" queue case in
// src/poller/process.ts (month grain + trailing rolling_28d, deduped when
// they coincide). Read-safe to re-run: recompute upserts on the frozen key
// and reconciles stale rows away (ADR 0012).
//
//   DATABASE_URL='<neon-or-dev-url>' npx tsx scripts/recompute-org.ts [ORG_ID] [YYYY-MM-DD]
//
// ORG_ID omitted -> recomputes every org (listOrgIds — the same cross-org
// enumeration the nightly cron's dispatcher uses). Day defaults to today
// (UTC); pass an explicit day to recompute a past period.
import { createDb } from "../src/db/client";
import { listOrgIds } from "../src/db/system";
import { periodFor, recomputeOrg } from "../src/scoring";

const day = process.argv[3] || new Date().toISOString().slice(0, 10);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (point at prod Neon or the dev DB)");
  process.exit(1);
}
const db = createDb({ DATABASE_URL });

async function recomputeOne(orgId: string) {
  const month = periodFor("month", day);
  const rolling = periodFor("rolling_28d", day);

  const m = await recomputeOrg(db, orgId, { period: month });
  console.log(
    `[${orgId}] month ${month.periodStart}..${month.periodEnd}: ` +
      `${m.definitionsEvaluated} defs, ${m.resultsWritten} results written, ` +
      `${m.staleResultsRemoved} stale removed, ${m.definitionsSkipped} skipped`,
  );

  // Skip rolling when it coincides with the month window (Feb non-leap anchor) —
  // same guard as the poller, so the grain label doesn't flip.
  if (
    rolling.periodStart !== month.periodStart ||
    rolling.periodEnd !== month.periodEnd
  ) {
    const r = await recomputeOrg(db, orgId, { period: rolling });
    console.log(
      `[${orgId}] rolling_28d ${rolling.periodStart}..${rolling.periodEnd}: ` +
        `${r.definitionsEvaluated} defs, ${r.resultsWritten} results written, ` +
        `${r.staleResultsRemoved} stale removed`,
    );
  }
}

async function main() {
  const argOrgId = process.argv[2];
  const orgIds = argOrgId ? [argOrgId] : await listOrgIds(db);
  console.log(
    argOrgId
      ? `recomputing 1 org: ${argOrgId}`
      : `recomputing all ${orgIds.length} orgs`,
  );
  for (const orgId of orgIds) {
    await recomputeOne(orgId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
