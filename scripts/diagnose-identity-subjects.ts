// Read-only, one-off (debugging the empty-recompute-after-reconcile follow-up):
// for one org, lists subjects, their identity links, and which subjectIds
// actually appear in metric_records — to see whether reconciled identities
// point at the subjects that own the ingested data. No writes.
//
//   DATABASE_URL='<neon-url>' npx tsx scripts/diagnose-identity-subjects.ts <ORG_ID>
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { connections, identities, metricRecords, people, subjects } from "../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
const orgId = process.argv[2];
if (!DATABASE_URL || !orgId) {
  console.error("usage: DATABASE_URL=... npx tsx scripts/diagnose-identity-subjects.ts <ORG_ID>");
  process.exit(1);
}
const db = createDb({ DATABASE_URL });

async function main() {
  const subjRows = await db
    .select({
      id: subjects.id,
      kind: subjects.kind,
      externalId: subjects.externalId,
      email: subjects.email,
      displayName: subjects.displayName,
      connectionId: subjects.connectionId,
    })
    .from(subjects)
    .where(eq(subjects.orgId, orgId));
  console.log(`subjects: ${subjRows.length}`);
  for (const s of subjRows) {
    console.log(
      `  subject ${s.id} kind=${s.kind} externalId=${s.externalId} email=${s.email ?? "-"} name=${s.displayName ?? "-"} conn=${s.connectionId}`,
    );
  }

  const connRows = await db
    .select({ id: connections.id, vendor: connections.vendor })
    .from(connections)
    .where(eq(connections.orgId, orgId));
  console.log(`connections: ${connRows.length}`);
  for (const c of connRows) console.log(`  connection ${c.id} vendor=${c.vendor}`);

  const peopleRows = await db
    .select({ id: people.id, displayName: people.displayName, pseudonym: people.pseudonym })
    .from(people)
    .where(eq(people.orgId, orgId));
  console.log(`people: ${peopleRows.length}`);
  for (const p of peopleRows) console.log(`  person ${p.id} name=${p.displayName ?? "-"} pseudonym=${p.pseudonym}`);

  const identRows = await db
    .select({ subjectId: identities.subjectId, personId: identities.personId, method: identities.method })
    .from(identities)
    .where(eq(identities.orgId, orgId));
  console.log(`identities: ${identRows.length}`);
  for (const i of identRows) console.log(`  identity subject=${i.subjectId} -> person=${i.personId} method=${i.method}`);

  const distinctMetricSubjects = await db
    .selectDistinct({ subjectId: metricRecords.subjectId })
    .from(metricRecords)
    .where(eq(metricRecords.orgId, orgId));
  console.log(`distinct subjectIds in metric_records: ${distinctMetricSubjects.length}`);
  for (const r of distinctMetricSubjects) console.log(`  metric-subject ${r.subjectId}`);

  const linkedSubjectIds = new Set(identRows.map((i) => i.subjectId));
  const metricSubjectIds = new Set(distinctMetricSubjects.map((r) => r.subjectId));
  const overlap = [...linkedSubjectIds].filter((id) => metricSubjectIds.has(id));
  console.log(`overlap between linked subjects and metric-bearing subjects: ${overlap.length}`);
  console.log(`  linked but NO metric rows: ${[...linkedSubjectIds].filter((id) => !metricSubjectIds.has(id)).join(", ") || "none"}`);
  console.log(`  metric rows but NOT linked: ${[...metricSubjectIds].filter((id) => !linkedSubjectIds.has(id)).join(", ") || "none"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
