// W2-I calibration tool: runs the frozen recompute engine against a real
// org's real data and prints computed scores next to raw sanity-check
// numbers, so a human can eyeball whether the seeded v1 definitions and
// segment thresholds (src/scoring/segment.ts) track real usage sensibly.
//
// Manually run, not a merge gate — connects to whatever DATABASE_URL points
// at (dev or prod), never CI:
//
//   DATABASE_URL=<neon-connection-string> npx tsx scripts/calibrate-scores.ts <org-id> [anchor-day]
//
// If this surfaces a real miscalibration, that becomes a new versioned
// score_definitions row (v2) or a segment-threshold tune in a follow-up PR
// with its own oracle coverage — never an edit to the frozen v1 rows.
import { createDb } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import { periodFor, recomputeOrg } from "../src/scoring";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
  const [orgId, anchorDay] = process.argv.slice(2);
  if (!orgId) {
    console.error(
      "usage: DATABASE_URL=<conn> npx tsx scripts/calibrate-scores.ts <org-id> [anchor-day=YYYY-MM-DD]",
    );
    process.exit(1);
  }
  const anchor = anchorDay ?? new Date().toISOString().slice(0, 10);
  const period = periodFor("month", anchor);

  const db = createDb({ DATABASE_URL: DEV_DB_URL });
  const scoped = forOrg(db, orgId);

  console.log(`Recomputing org ${orgId} for ${period.periodStart}..${period.periodEnd}`);
  const summary = await recomputeOrg(db, orgId, { period });
  console.log(
    `  ${summary.definitionsEvaluated} definitions evaluated, ${summary.resultsWritten} results written`,
  );

  const [rawSpend, rawActiveDays] = await Promise.all([
    scoped.metrics.records({
      metricKey: "spend_cents",
      from: period.periodStart,
      to: period.periodEnd,
    }),
    scoped.metrics.records({
      metricKey: "active_day",
      from: period.periodStart,
      to: period.periodEnd,
    }),
  ]);
  const totalSpendCents = rawSpend.reduce((sum, r) => sum + r.value, 0);
  const activeDayRows = rawActiveDays.length;
  console.log(
    `  raw sanity check: total spend_cents=${totalSpendCents}, active_day rows=${activeDayRows}`,
  );

  const definitions = await scoped.scores.definitions();
  for (const def of definitions) {
    if (def.status !== "active" || def.subjectLevel !== "team") continue;
    const results = await scoped.scores.results({
      definitionId: def.id,
      subjectLevel: "team",
      from: period.periodStart,
      to: period.periodEnd,
    });
    for (const r of results) {
      const flag =
        r.value === 0 || r.value === 100
          ? "  <-- clamped at an extreme, worth a look"
          : "";
      console.log(
        `  ${def.slug}@v${def.version} team=${r.teamId} value=${r.value} attribution=${r.attribution}${flag}`,
      );
    }
    if (results.length === 0) {
      console.log(`  ${def.slug}@v${def.version}: no results (null — absence, not a fabricated 0)`);
    }
  }

  // W5-A (ADR 0027): the team-segment breakdown that used to print here relied
  // on `segmentTeams` (src/scoring/segment.ts), which was removed as app-dead
  // (this was its only live consumer). It was not ported onto the person-level
  // src/lib/segments.ts vocabulary because that classifies a single signal
  // (adoption bands), whereas the retired path calibrated the team two-signal
  // (adoption × fluency) SEGMENT_THRESHOLDS_V1 — porting would have changed
  // what is being calibrated. The score-value dump above remains the
  // calibration signal; re-introduce a team-segment print alongside any future
  // team-level segmentation job.
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
