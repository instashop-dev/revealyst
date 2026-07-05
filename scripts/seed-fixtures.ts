// Seeds the fixture graphs into the local dev DB so W1-G dashboards render
// data with zero credentials:  npm run dev:db  (terminal 1)  →
// npm run dev:seed  (terminal 2). Loads through the org-scoped repository
// layer — the same path production code uses.
import { readFileSync } from "node:fs";
import { createDb } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const db = createDb({ DATABASE_URL: DEV_DB_URL });

async function seedOrg(name: string, kind: "personal" | "team", file: string) {
  const org = await createFixtureOrg(db, name, kind);
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  await loadFixture(db, org.id, fixture);
  console.log(`seeded ${file} into org "${name}" (${org.id})`);
}

async function main() {
  await seedOrg("Fixture Team", "team", "fixtures/metric-records/team-30d.json");
  await seedOrg(
    "Fixture Personal",
    "personal",
    "fixtures/metric-records/personal-30d.json",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
