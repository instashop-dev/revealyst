import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { EmailEnv, EmailMessage } from "../src/lib/email";
import {
  maybeSendBudgetAlert,
  type BudgetAlertDeps,
} from "../src/poller/budget-alert";

// Budget-threshold EMAIL alerts (W5-I): the CAS in budget_alert_state fires
// each threshold EXACTLY once per (org, month) even under at-least-once poll
// redelivery. Integration tests against PGlite, mirroring digest-send.test.ts.

const NOW = new Date("2026-07-06T14:00:00.000Z"); // Monday; month 2026-07
const MONTH = "2026-07";

let db: Db;
let seq = 0;

function captureDeps(): { deps: BudgetAlertDeps; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const deps: BudgetAlertDeps = {
    emailEnv: {} as EmailEnv,
    appOrigin: "https://app.example",
    now: () => NOW,
    sendEmail: async (_env, msg) => {
      sent.push(msg);
    },
  };
  return { deps, sent };
}

async function addAdmin(orgId: string, verified = true): Promise<string> {
  const id = `u-${seq++}`;
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@fixture.example`,
    emailVerified: verified,
  });
  await db.insert(schema.orgMembers).values({ orgId, userId: id, role: "admin" });
  return id;
}

/** Seed vendor-reported spend for the current month so the budget crosses. */
async function seedSpend(orgId: string, cents: number): Promise<void> {
  const scope = forOrg(db, orgId);
  const conn = await scope.connections.create({
    vendor: "openai",
    displayName: "OpenAI",
    authKind: "api_key",
  });
  const [subject] = await scope.subjects.upsertMany(conn.id, [
    { kind: "person", externalId: `spender-${seq++}` },
  ]);
  await scope.metrics.upsertRecords([
    {
      subjectId: subject.id,
      metricKey: "spend_cents",
      day: "2026-07-02",
      connectionId: conn.id,
      value: cents,
      attribution: "person",
      sourceConnector: "test@1",
    },
  ]);
}

/** Add more spend on another day (raises the month-to-date total). */
async function addSpend(orgId: string, cents: number, day: string): Promise<void> {
  const scope = forOrg(db, orgId);
  const [conn] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.orgId, orgId));
  const [subject] = await db
    .select()
    .from(schema.subjects)
    .where(eq(schema.subjects.orgId, orgId));
  await scope.metrics.upsertRecords([
    {
      subjectId: subject.id,
      metricKey: "spend_cents",
      day,
      connectionId: conn.id,
      value: cents,
      attribution: "person",
      sourceConnector: "test@1",
    },
  ]);
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("maybeSendBudgetAlert", () => {
  it("emails the crossed threshold exactly once, and not again on redelivery", async () => {
    const orgId = (await createFixtureOrg(db, "budget-once", "personal")).id;
    await addAdmin(orgId);
    await forOrg(db, orgId).budgets.set({ monthlyLimitCents: 100_000 }); // $1000
    await seedSpend(orgId, 85_000); // 85% → crosses 50 and 80; highest = 80

    const first = captureDeps();
    const r1 = await maybeSendBudgetAlert(db, orgId, first.deps);
    expect(r1.threshold).toBe(80);
    expect(r1.sent).toBe(1);
    expect(first.sent).toHaveLength(1);
    // Subject carries the threshold but not the dollar figure (inbox privacy).
    expect(first.sent[0].subject).toContain("80%");
    expect(first.sent[0].subject).not.toContain("$");

    // Redelivery of the same poll: spend still at 85%, threshold 80 already
    // claimed this month → CAS loses → no second email.
    const second = captureDeps();
    const r2 = await maybeSendBudgetAlert(db, orgId, second.deps);
    expect(r2.threshold).toBeNull();
    expect(r2.skipped).toBe("already-alerted");
    expect(second.sent).toHaveLength(0);

    // The stored high-water mark advanced to 80.
    const row = await forOrg(db, orgId).budgetAlertState.get(MONTH);
    expect(row?.highestAlertedThreshold).toBe(80);
  });

  it("emails again when a HIGHER threshold is crossed later the same month", async () => {
    const orgId = (await createFixtureOrg(db, "budget-advance", "personal")).id;
    await addAdmin(orgId);
    await forOrg(db, orgId).budgets.set({ monthlyLimitCents: 100_000 });
    await seedSpend(orgId, 60_000); // 60% → crosses 50

    const a = captureDeps();
    expect((await maybeSendBudgetAlert(db, orgId, a.deps)).threshold).toBe(50);

    // Spend climbs over budget → threshold 100 is newly crossed.
    await addSpend(orgId, 45_000, "2026-07-04"); // total 105% → over budget
    const b = captureDeps();
    const r = await maybeSendBudgetAlert(db, orgId, b.deps);
    expect(r.threshold).toBe(100);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0].subject.toLowerCase()).toContain("reached your monthly budget");

    const row = await forOrg(db, orgId).budgetAlertState.get(MONTH);
    expect(row?.highestAlertedThreshold).toBe(100);
  });

  it("no budget set → no send, no crossing-state row", async () => {
    const orgId = (await createFixtureOrg(db, "budget-none", "personal")).id;
    await addAdmin(orgId);
    await seedSpend(orgId, 999_999);
    const { deps, sent } = captureDeps();
    const r = await maybeSendBudgetAlert(db, orgId, deps);
    expect(r.skipped).toBe("no-budget-or-not-crossed");
    expect(sent).toHaveLength(0);
    expect(await forOrg(db, orgId).budgetAlertState.get(MONTH)).toBeUndefined();
  });

  it("spend under every threshold → no send", async () => {
    const orgId = (await createFixtureOrg(db, "budget-under", "personal")).id;
    await addAdmin(orgId);
    await forOrg(db, orgId).budgets.set({ monthlyLimitCents: 100_000 });
    await seedSpend(orgId, 10_000); // 10% → crosses nothing
    const { deps, sent } = captureDeps();
    const r = await maybeSendBudgetAlert(db, orgId, deps);
    expect(r.threshold).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("SES unconfigured → skips WITHOUT claiming, so a later configured run still sends", async () => {
    const orgId = (await createFixtureOrg(db, "budget-ses", "personal")).id;
    await addAdmin(orgId);
    await forOrg(db, orgId).budgets.set({ monthlyLimitCents: 100_000 });
    await seedSpend(orgId, 85_000);

    // No sendEmail seam + empty EmailEnv → real-sender guard fires.
    const r = await maybeSendBudgetAlert(db, orgId, {
      emailEnv: {} as EmailEnv,
      appOrigin: "https://app.example",
      now: () => NOW,
    });
    expect(r.skipped).toBe("email-unconfigured");
    // Nothing claimed — the threshold can still alert once SES is configured.
    expect(await forOrg(db, orgId).budgetAlertState.get(MONTH)).toBeUndefined();

    const { deps, sent } = captureDeps();
    const r2 = await maybeSendBudgetAlert(db, orgId, deps);
    expect(r2.threshold).toBe(80);
    expect(sent).toHaveLength(1);
  });

  it("no verified admin → no send and no claim (alerts once an admin verifies)", async () => {
    const orgId = (await createFixtureOrg(db, "budget-unverified", "personal")).id;
    const userId = await addAdmin(orgId, false); // unverified
    await forOrg(db, orgId).budgets.set({ monthlyLimitCents: 100_000 });
    await seedSpend(orgId, 85_000);

    const { deps, sent } = captureDeps();
    const r = await maybeSendBudgetAlert(db, orgId, deps);
    expect(r.skipped).toBe("no-recipients");
    expect(sent).toHaveLength(0);
    // NOT claimed — verifying the admin later still lets the threshold alert.
    expect(await forOrg(db, orgId).budgetAlertState.get(MONTH)).toBeUndefined();

    await db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, userId));
    const again = captureDeps();
    expect((await maybeSendBudgetAlert(db, orgId, again.deps)).threshold).toBe(80);
    expect(again.sent).toHaveLength(1);
  });
});
