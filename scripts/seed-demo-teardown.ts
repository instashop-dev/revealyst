// Deletes the demo-seed dataset (orgs, side-effect personal orgs, auth
// users) from the target DB — see scripts/seed/teardown.ts for the exact
// matching rules. Used to refresh a decayed prod demo (teardown → re-seed)
// or to clean a long-lived dev DB.
//   DATABASE_URL='<url>' npx tsx scripts/seed-demo-teardown.ts
// Defaults to the local dev db. Idempotent: matching nothing deletes nothing.
// By default only "[Demo] "-prefixed orgs (+ demo users' orgs) are removed —
// a local db seeded WITHOUT prod-safe mode needs the unprefixed base names
// too: SEED_TEARDOWN_UNPREFIXED=1 (never set this against production; real
// orgs can collide with the base names).
import { createDb } from "../src/db/client";
import { buildDemoSeedPlan } from "./seed/activity";
import { teardownDemoData } from "./seed/teardown";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
  const db = createDb({ DATABASE_URL: DEV_DB_URL });
  // Org names and user emails are static literals in the plan — any anchor
  // derives the same match keys.
  const plan = buildDemoSeedPlan("2026-01-01");
  const includeUnprefixed = process.env.SEED_TEARDOWN_UNPREFIXED === "1";
  if (includeUnprefixed) {
    console.log(
      "including UNPREFIXED base org names (local-db mode — never use against prod)",
    );
  }
  const summary = await teardownDemoData(db, plan, { includeUnprefixed });
  for (const org of summary.orgsDeleted) {
    console.log(`deleted org "${org.name}" (${org.id})`);
  }
  console.log(
    `deleted ${summary.orgsDeleted.length} orgs, ${summary.usersDeleted.length} users (${summary.usersDeleted.join(", ") || "none"})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
