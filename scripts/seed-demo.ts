// Rich demo seed — exercises every dashboard panel, metric, filter, and
// edge case (see scripts/seed/README.md). Data is GENERATED relative to
// yesterday UTC so trailing-window analytics (MTD budgets, 28d movement,
// 84d agentic, 56d model trend) stay populated no matter when it runs;
// npm run dev:seed (the small static June-2026 fixtures) is unchanged.
//   npm run dev:db          (terminal 1)
//   npm run dev:seed:demo   (terminal 2)
// Re-runs skip orgs that already exist by name (loadSeedPlan's guard).
// Override the anchor for reproducible loads: SEED_ANCHOR_DAY=2026-07-10.
// SEED_PROD_SAFE=1 applies scripts/seed/prod-safety.ts (REQUIRED for any
// non-throwaway target: random unlogged passwords, no platform admin,
// unmeterable past_due subscriptions, no global benchmark flip, "[Demo] "
// org-name prefix). Counterpart: scripts/seed-demo-teardown.ts.
import { createDb } from "../src/db/client";
import { buildDemoSeedPlan } from "./seed/activity";
import { loadSeedPlan } from "./seed/load";
import { attachManager } from "./seed/manager-hookup";
import { applyProdSafety, DEMO_ORG_PREFIX } from "./seed/prod-safety";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const db = createDb({ DATABASE_URL: DEV_DB_URL });
  const anchorDay = process.env.SEED_ANCHOR_DAY ?? yesterdayUtc();
  const prodSafe = process.env.SEED_PROD_SAFE === "1";
  const plan = prodSafe
    ? applyProdSafety(buildDemoSeedPlan(anchorDay))
    : buildDemoSeedPlan(anchorDay);
  if (prodSafe) {
    console.log(
      "prod-safe mode: [Demo] org prefix, random unlogged passwords " +
        "(use admin impersonation), past_due subscriptions, no benchmark flip",
    );
  }
  const result = await loadSeedPlan(
    db,
    plan,
    process.env as Record<string, string>,
  );
  for (const org of result.orgs) {
    console.log(
      `seeded "${org.name}" (${org.orgId}) — ${org.people} people, ` +
        `${org.subjects} subjects, ${org.records} records, ` +
        `${org.signals} signals, ${org.scoreResults} score_results`,
    );
  }
  console.log(`anchor day: ${anchorDay} (${result.orgs.length} orgs)`);

  // Optional: attach a real, existing dashboard account to the seeded team
  // demo org as its manager (admin + team manager, active workspace), so that
  // account can sign in and see the manager view against the demo data. Gated
  // behind SEED_MANAGER_EMAIL so the default seed / tests are unaffected.
  const managerEmail = process.env.SEED_MANAGER_EMAIL?.trim();
  if (managerEmail) {
    // The team demo org is "Acme Robotics" (prod-safe prefixes it).
    const orgName = `${prodSafe ? DEMO_ORG_PREFIX : ""}Acme Robotics`;
    const hookup = await attachManager(db, { email: managerEmail, orgName });
    if (hookup.status === "attached") {
      console.log(
        `manager hookup: "${hookup.email}" is now admin + manager of ` +
          `"${hookup.orgName}" (${hookup.orgId}) across ${hookup.teamsManaged} ` +
          `team(s); that workspace is pinned active.`,
      );
    } else if (hookup.status === "user-absent") {
      console.warn(
        `manager hookup SKIPPED: no dashboard account exists for ` +
          `"${hookup.email}". That person must sign up first, then re-run seed.`,
      );
    } else {
      console.warn(
        `manager hookup SKIPPED: org "${hookup.orgName}" was not found ` +
          `(nothing seeded, or it already existed and was skipped).`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
