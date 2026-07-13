import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { EmailEnv, EmailMessage } from "../src/lib/email";
import {
  runMonthlyExecReport,
  type ExecReportDeps,
} from "../src/poller/exec-report";

// Integration tests for the monthly executive-memo SENDER (W6-F) against a
// PGlite db: the ORG-LEVEL month CAS idempotency under at-least-once redelivery
// (emails EXACTLY once per month), the workspace opt-out gate, the month
// rollover, and the SES-guard-before-claim (an unconfigured run makes no claim
// so the month can still send later).

// 1st of the month, 16:00 UTC — the cron fire time. The reported month is the
// one that just ended (June 2026 → "2026-06").
const NOW = new Date("2026-07-01T16:00:00.000Z");

let db: Db;
let seq = 0;

function captureDeps(): { deps: ExecReportDeps; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const deps: ExecReportDeps = {
    emailEnv: {} as EmailEnv,
    appOrigin: "https://app.example",
    now: () => NOW,
    sendEmail: async (_env, msg) => {
      sent.push(msg);
    },
  };
  return { deps, sent };
}

async function addAdmin(orgId: string, opts: { verified: boolean }): Promise<string> {
  const id = `u-${seq++}`;
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@fixture.example`,
    emailVerified: opts.verified,
  });
  await db.insert(schema.orgMembers).values({ orgId, userId: id, role: "admin" });
  return id;
}

async function orgWithAdmin(name: string): Promise<string> {
  const orgId = (await createFixtureOrg(db, name, "team")).id;
  await addAdmin(orgId, { verified: true });
  return orgId;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("month CAS idempotency", () => {
  it("emails once, then a redelivery for the same month is a no-op", async () => {
    const orgId = await orgWithAdmin("exec-idem");
    const { deps, sent } = captureDeps();

    const first = await runMonthlyExecReport(db, orgId, deps);
    expect(first.sent).toBe(1);
    expect(first.monthKey).toBe("2026-06");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("June 2026");

    // At-least-once redelivery for the same month.
    const second = await runMonthlyExecReport(db, orgId, deps);
    expect(second.sent).toBe(0);
    expect(second.claimLost).toBe(true);
    expect(sent).toHaveLength(1); // still one — never re-sent
  });

  it("sends again the next month (a fresh month is a fresh claim)", async () => {
    const orgId = await orgWithAdmin("exec-rollover");
    const { deps, sent } = captureDeps();

    await runMonthlyExecReport(db, orgId, deps); // claims 2026-06
    expect(sent).toHaveLength(1);

    // Next month's cron fires on 2026-08-01 → reports July 2026.
    const nextMonth: ExecReportDeps = {
      ...deps,
      now: () => new Date("2026-08-01T16:00:00.000Z"),
    };
    const run = await runMonthlyExecReport(db, orgId, nextMonth);
    expect(run.monthKey).toBe("2026-07");
    expect(run.sent).toBe(1);
    expect(sent).toHaveLength(2);
  });
});

describe("workspace opt-out gate", () => {
  it("never claims or sends for an opted-out workspace", async () => {
    const orgId = await orgWithAdmin("exec-optout");
    await forOrg(db, orgId).execReportState.setEnabled(false);
    const { deps, sent } = captureDeps();

    const run = await runMonthlyExecReport(db, orgId, deps);
    expect(run.sent).toBe(0);
    expect(run.claimLost).toBe(true);
    expect(sent).toHaveLength(0);

    // Opting back in lets the (never-claimed) month send.
    await forOrg(db, orgId).execReportState.setEnabled(true);
    const run2 = await runMonthlyExecReport(db, orgId, deps);
    expect(run2.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe("recipient selection", () => {
  it("skips (no claim) when there are no verified admins", async () => {
    const orgId = (await createFixtureOrg(db, "exec-no-recip", "team")).id;
    await addAdmin(orgId, { verified: false }); // unverified → not a recipient
    const { deps, sent } = captureDeps();

    const run = await runMonthlyExecReport(db, orgId, deps);
    expect(run.skipped).toBe("no-recipients");
    expect(sent).toHaveLength(0);
    // The month was NOT claimed — a later run with a verified admin still sends.
    await addAdmin(orgId, { verified: true });
    const run2 = await runMonthlyExecReport(db, orgId, deps);
    expect(run2.sent).toBe(1);
  });

  it("claims ONCE for the org and emails every verified admin", async () => {
    const orgId = (await createFixtureOrg(db, "exec-multi", "team")).id;
    await addAdmin(orgId, { verified: true });
    await addAdmin(orgId, { verified: true });
    await addAdmin(orgId, { verified: true });
    const { deps, sent } = captureDeps();

    const run = await runMonthlyExecReport(db, orgId, deps);
    expect(run.sent).toBe(3);
    expect(sent).toHaveLength(3);

    // Redelivery: the single org-level claim is already taken → no re-send.
    const again = await runMonthlyExecReport(db, orgId, deps);
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(3);
  });
});

describe("SES guard before claim", () => {
  it("bails WITHOUT claiming when SES is unconfigured (real sender path)", async () => {
    const orgId = await orgWithAdmin("exec-ses");
    // No sendEmail seam + empty emailEnv → isEmailConfigured false → skip.
    const run = await runMonthlyExecReport(db, orgId, {
      emailEnv: {} as EmailEnv,
      appOrigin: "https://app.example",
      now: () => NOW,
    });
    expect(run.skipped).toBe("email-unconfigured");
    expect(run.sent).toBe(0);

    // The month was never claimed — a configured send still delivers it.
    const { deps, sent } = captureDeps();
    const run2 = await runMonthlyExecReport(db, orgId, deps);
    expect(run2.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
