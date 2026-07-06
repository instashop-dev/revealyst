// Seeds the fixture graphs into the local dev DB so W1-G/W2-H dashboards
// render data with zero credentials:  npm run dev:db  (terminal 1)  →
// npm run dev:seed  (terminal 2). Loads through the org-scoped repository
// layer — the same path production code uses — then runs recomputeOrg so
// score_results exist for the self-view/overview to read (the production
// read path, not a static fixture).
import { readFileSync } from "node:fs";
import { createDb } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  loadScoreDefinitions,
} from "../src/db/fixtures";
import { recomputeOrg } from "../src/scoring/recompute";
import { periodFor } from "../src/scoring/periods";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const db = createDb({ DATABASE_URL: DEV_DB_URL });

// Both fixture graphs are June-2026 data; recompute the containing month.
const PERIOD = periodFor("month", "2026-06-15");

async function seedOrg(
  name: string,
  kind: "personal" | "team",
  file: string,
  scoreDefsFile?: string,
) {
  const org = await createFixtureOrg(db, name, kind);
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  await loadFixture(db, org.id, fixture);
  // Team orgs score against the global team presets (drizzle/0009); a
  // personal org has no teams, so it needs the placeholder person-level defs.
  if (scoreDefsFile) {
    const defs = JSON.parse(readFileSync(scoreDefsFile, "utf8"));
    await loadScoreDefinitions(db, org.id, defs);
  }
  const summary = await recomputeOrg(db, org.id, { period: PERIOD });
  console.log(
    `seeded ${file} into org "${name}" (${org.id}) — ${summary.resultsWritten} score_results`,
  );
}

async function main() {
  await seedOrg("Fixture Team", "team", "fixtures/metric-records/team-30d.json");
  await seedOrg(
    "Fixture Personal",
    "personal",
    "fixtures/metric-records/personal-30d.json",
    "fixtures/score-definitions/personal-presets.json",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
