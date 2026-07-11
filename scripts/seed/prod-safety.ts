// Production-safety transform for the demo SeedPlan (README §"Invariants").
// The base plan is built for throwaway local DBs and is UNSAFE to load into
// production as-is, for three verified reasons:
//   1. Its user passwords are committed to this repo (personas/activity), and
//      one user carries platformAdmin — a platform admin with a public
//      password.
//   2. An `active` subscription gets picked up by the DAILY metering
//      dispatcher (src/db/system.ts listSubscriptionsToMeter: active/trialing
//      only) and, once the trailing-30d tracked-user count drifts, PATCHes
//      Paddle with a fake subscription id → recurring 404 noise. `past_due`
//      is the safe status: still ENTITLING (resolveEntitlement,
//      src/db/subscriptions.ts — custom indexes recompute, paywall lifted,
//      admin plan column populated) but never dispatched for metering.
//   3. `verifyBenchmark` flips a GLOBAL benchmarks row that every real
//      user's personal benchmarks card reads — a product-content decision,
//      not demo data.
//   4. Share links mint LIVE PUBLIC /s/<token> pages that present fabricated
//      scores under "measured, not self-reported" copy — an invariant-(b)
//      overclaim on a real public surface. Share cards are exercised by the
//      local seed and tests/seed-demo.test.ts; prod gets none.
// Sign-in for prod demo users is via the admin console's impersonation, so
// the randomized passwords are never printed anywhere.
import { randomUUID } from "node:crypto";
import type { SeedPlan } from "./plan";

export const DEMO_ORG_PREFIX = "[Demo] ";

/** Returns a NEW plan safe to load into the production database. */
export function applyProdSafety(plan: SeedPlan): SeedPlan {
  return {
    anchorDay: plan.anchorDay,
    // Deliberately dropped: never mutate global content from a demo seed.
    verifyBenchmark: undefined,
    orgs: plan.orgs.map((org) => ({
      ...org,
      // Unmistakable-in-prod-admin names; also the teardown match key.
      name: org.name.startsWith(DEMO_ORG_PREFIX)
        ? org.name
        : `${DEMO_ORG_PREFIX}${org.name}`,
      users: org.users?.map((u) => ({
        ...u,
        // Random, unlogged, unrecoverable — impersonation covers demo needs.
        password: `${randomUUID()}.${randomUUID()}`,
        platformAdmin: false,
      })),
      subscription: org.subscription
        ? { ...org.subscription, status: "past_due" as const }
        : undefined,
      // Reason 4 above: no public share pages for fabricated data.
      shareLinks: undefined,
    })),
  };
}
