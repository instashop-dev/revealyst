// Read-only diagnostic (ADR 0014 follow-up): after seeding person-level
// presets + recomputing, prod wrote 0 new score_results for every org. This
// answers WHY — per non-system org: what connections exist and their poll
// health, what metric_key families have landed (and their day range), and
// whether people/identities/score_results exist at all. No writes.
//
//   DATABASE_URL='<neon-url>' npx tsx scripts/diagnose-scores.ts
import { asc, eq, ne, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import {
  connections,
  identities,
  metricRecords,
  orgs,
  people,
  scoreResults,
} from "../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (point at prod Neon or the dev DB)");
  process.exit(1);
}
const db = createDb({ DATABASE_URL });

async function main() {
  const orgRows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      kind: orgs.kind,
      createdAt: orgs.createdAt,
    })
    .from(orgs)
    .where(ne(orgs.kind, "system"))
    .orderBy(asc(orgs.createdAt));

  for (const org of orgRows) {
    console.log(`\n=== org ${org.id} "${org.name}" (${org.kind}, created ${org.createdAt.toISOString()}) ===`);

    const conns = await db
      .select({
        vendor: connections.vendor,
        status: connections.status,
        lastPolledAt: connections.lastPolledAt,
        lastSuccessAt: connections.lastSuccessAt,
        lastError: connections.lastError,
      })
      .from(connections)
      .where(eq(connections.orgId, org.id));
    console.log(`connections: ${conns.length}`);
    for (const c of conns) {
      console.log(
        `  ${c.vendor} status=${c.status} lastPolled=${c.lastPolledAt?.toISOString() ?? "never"} ` +
          `lastSuccess=${c.lastSuccessAt?.toISOString() ?? "never"} lastError=${c.lastError ?? "-"}`,
      );
    }

    const metrics = await db
      .select({
        metricKey: metricRecords.metricKey,
        count: sql<number>`count(*)::int`,
        sum: sql<number>`sum(${metricRecords.value})::float`,
        minDay: sql<string>`min(${metricRecords.day})`,
        maxDay: sql<string>`max(${metricRecords.day})`,
      })
      .from(metricRecords)
      .where(eq(metricRecords.orgId, org.id))
      .groupBy(metricRecords.metricKey)
      .orderBy(metricRecords.metricKey);
    console.log(`metric_records: ${metrics.length ? "" : "NONE"}`);
    for (const m of metrics) {
      console.log(
        `  ${m.metricKey}: count=${m.count} sum=${m.sum} range=${m.minDay}..${m.maxDay}`,
      );
    }

    const [peopleCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(people)
      .where(eq(people.orgId, org.id));
    const [identitiesCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(identities)
      .where(eq(identities.orgId, org.id));
    const [scoreResultsCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(scoreResults)
      .where(eq(scoreResults.orgId, org.id));
    console.log(
      `people=${peopleCount.n} identities=${identitiesCount.n} score_results=${scoreResultsCount.n}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
