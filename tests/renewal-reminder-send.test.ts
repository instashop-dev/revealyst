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
  maybeSendRenewalReminders,
  type RenewalReminderDeps,
} from "../src/poller/renewal-reminder";

// Renewal-reminder EMAIL sends (W6-G): the CAS in renewal_reminder_state fires
// each (connection, date, threshold) EXACTLY once even under at-least-once cron
// redelivery, so a connection with a set renewal date emits exactly two
// reminders over its lifecycle (T-30 + T-7). Integration tests against PGlite,
// mirroring budget-alert.test.ts.

// A renewal date used across the suite. T-30 scan day = 2026-07-13,
// T-7 scan day = 2026-08-05.
const RENEWAL_DATE = "2026-08-12";
const T30_DAY = new Date("2026-07-13T13:00:00.000Z"); // exactly 30 days out
const T7_DAY = new Date("2026-08-05T13:00:00.000Z"); // exactly 7 days out
const OFF_DAY = new Date("2026-07-14T13:00:00.000Z"); // 29 days out — no fire

let db: Db;
let seq = 0;

function captureDeps(now: Date): {
  deps: RenewalReminderDeps;
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  const deps: RenewalReminderDeps = {
    emailEnv: {} as EmailEnv,
    appOrigin: "https://app.example",
    now: () => now,
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
  await db
    .insert(schema.orgMembers)
    .values({ orgId, userId: id, role: "admin" });
  return id;
}

/** Create a connection and set a user-entered renewal date on it. */
async function seedConnection(
  orgId: string,
  renewalDate: string | null,
): Promise<string> {
  const scope = forOrg(db, orgId);
  const conn = await scope.connections.create({
    vendor: "openai",
    displayName: "OpenAI",
    authKind: "api_key",
  });
  if (renewalDate) {
    await scope.connections.update(conn.id, { renewalDate });
  }
  return conn.id;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("maybeSendRenewalReminders", () => {
  it("fires exactly twice per entered date (T-30 + T-7), once each under redelivery", async () => {
    const orgId = (await createFixtureOrg(db, "renew-twice", "personal")).id;
    await addAdmin(orgId);
    const connId = await seedConnection(orgId, RENEWAL_DATE);

    // --- T-30 scan: fires threshold 30 once. ---
    const a = captureDeps(T30_DAY);
    const r1 = await maybeSendRenewalReminders(db, orgId, a.deps);
    expect(r1.reminders).toEqual([
      { connectionId: connId, threshold: 30, sent: 1 },
    ]);
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0].subject).toContain("about a month");

    // Redelivery of the same T-30 scan → CAS loses → no second email.
    const aRedeliver = captureDeps(T30_DAY);
    const r1b = await maybeSendRenewalReminders(db, orgId, aRedeliver.deps);
    expect(r1b.reminders).toHaveLength(0);
    expect(aRedeliver.sent).toHaveLength(0);

    // --- A non-threshold day (29 out): nothing due, nothing sent. ---
    const off = captureDeps(OFF_DAY);
    const rOff = await maybeSendRenewalReminders(db, orgId, off.deps);
    expect(rOff.skipped).toBe("none-due");
    expect(off.sent).toHaveLength(0);

    // --- T-7 scan: fires threshold 7 once. ---
    const b = captureDeps(T7_DAY);
    const r2 = await maybeSendRenewalReminders(db, orgId, b.deps);
    expect(r2.reminders).toEqual([
      { connectionId: connId, threshold: 7, sent: 1 },
    ]);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0].subject).toContain("about a week");

    // Redelivery of the T-7 scan → no second email.
    const bRedeliver = captureDeps(T7_DAY);
    const r2b = await maybeSendRenewalReminders(db, orgId, bRedeliver.deps);
    expect(r2b.reminders).toHaveLength(0);
    expect(bRedeliver.sent).toHaveLength(0);

    // Exactly two reminder rows persisted for this date: thresholds 30 and 7.
    const rows = await forOrg(db, orgId).renewalReminderState.list();
    expect(rows.map((r) => r.threshold).sort((x, y) => x - y)).toEqual([7, 30]);
  });

  it("editing the renewal date re-arms both thresholds for the new date", async () => {
    const orgId = (await createFixtureOrg(db, "renew-edit", "personal")).id;
    await addAdmin(orgId);
    const connId = await seedConnection(orgId, RENEWAL_DATE);

    // Fire T-30 for the original date.
    const a = captureDeps(T30_DAY);
    expect(
      (await maybeSendRenewalReminders(db, orgId, a.deps)).reminders,
    ).toHaveLength(1);

    // Move the date one day later → the scan day that was T-30 for the old date
    // is now 31 days out (no fire), but a NEW T-30 day exists for the new date.
    const NEW_DATE = "2026-08-13";
    await forOrg(db, orgId).connections.update(connId, { renewalDate: NEW_DATE });

    // Scanning on 2026-07-14 (30 days before the NEW date) fires again — a fresh
    // reminder cycle, because the CAS key includes the date.
    const b = captureDeps(new Date("2026-07-14T13:00:00.000Z"));
    const r = await maybeSendRenewalReminders(db, orgId, b.deps);
    expect(r.reminders).toEqual([
      { connectionId: connId, threshold: 30, sent: 1 },
    ]);
    expect(b.sent).toHaveLength(1);

    // Two separate threshold-30 rows now exist (old date + new date).
    const rows = await forOrg(db, orgId).renewalReminderState.list();
    const t30 = rows.filter((r) => r.threshold === 30);
    expect(t30).toHaveLength(2);
    expect(t30.map((r) => r.renewalDate).sort()).toEqual([
      RENEWAL_DATE,
      NEW_DATE,
    ]);
  });

  it("no renewal date set → nothing due, no send", async () => {
    const orgId = (await createFixtureOrg(db, "renew-none", "personal")).id;
    await addAdmin(orgId);
    await seedConnection(orgId, null);
    const { deps, sent } = captureDeps(T30_DAY);
    const r = await maybeSendRenewalReminders(db, orgId, deps);
    expect(r.skipped).toBe("none-due");
    expect(sent).toHaveLength(0);
  });

  it("SES unconfigured → skips WITHOUT claiming, so a later configured run still sends", async () => {
    const orgId = (await createFixtureOrg(db, "renew-ses", "personal")).id;
    await addAdmin(orgId);
    await seedConnection(orgId, RENEWAL_DATE);

    // No sendEmail seam + empty EmailEnv → real-sender guard fires.
    const r = await maybeSendRenewalReminders(db, orgId, {
      emailEnv: {} as EmailEnv,
      appOrigin: "https://app.example",
      now: () => T30_DAY,
    });
    expect(r.skipped).toBe("email-unconfigured");
    // Nothing claimed — the reminder can still fire once SES is configured.
    expect(await forOrg(db, orgId).renewalReminderState.list()).toHaveLength(0);

    const { deps, sent } = captureDeps(T30_DAY);
    const r2 = await maybeSendRenewalReminders(db, orgId, deps);
    expect(r2.reminders).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("no verified admin → no send and no claim (fires once an admin verifies)", async () => {
    const orgId = (await createFixtureOrg(db, "renew-unverified", "personal")).id;
    const userId = await addAdmin(orgId, false); // unverified
    await seedConnection(orgId, RENEWAL_DATE);

    const { deps, sent } = captureDeps(T30_DAY);
    const r = await maybeSendRenewalReminders(db, orgId, deps);
    expect(r.skipped).toBe("no-recipients");
    expect(sent).toHaveLength(0);
    // NOT claimed — verifying the admin later still lets the reminder fire.
    expect(await forOrg(db, orgId).renewalReminderState.list()).toHaveLength(0);

    await db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, userId));
    const again = captureDeps(T30_DAY);
    expect(
      (await maybeSendRenewalReminders(db, orgId, again.deps)).reminders,
    ).toHaveLength(1);
    expect(again.sent).toHaveLength(1);
  });
});
