// Seeds the fixture graphs into the local dev DB so W1-G dashboards render
// data with zero credentials:  npm run dev:db  (terminal 1)  →
// npm run dev:seed  (terminal 2). Loads through the org-scoped repository
// layer — the same path production code uses.
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadFixture } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db/client";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const client = postgres(DEV_DB_URL, { max: 1, prepare: false });
const db = drizzle(client, { schema }) as unknown as Db;

async function seedOrg(name: string, kind: "personal" | "team", file: string) {
  const [org] = await db
    .insert(schema.orgs)
    .values({ name, kind })
    .returning();
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  await loadFixture(db, org.id, fixture);
  console.log(`seeded ${file} into org "${name}" (${org.id})`);
}

async function main() {
  try {
    await seedOrg(
      "Fixture Team",
      "team",
      "fixtures/metric-records/team-30d.json",
    );
    await seedOrg(
      "Fixture Personal",
      "personal",
      "fixtures/metric-records/personal-30d.json",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
