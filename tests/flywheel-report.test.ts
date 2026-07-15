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
  runFlywheelReport,
  type FlywheelReportDeps,
} from "../src/poller/flywheel-report";

// §14 flywheel report sender (W5-I): resolves platform-admin recipients
// (role='admin' OR ADMIN_USER_IDS, verified only) and emails the aggregate
// funnel; guards SES and empty recipients without sending.

const NOW = new Date("2026-07-13T15:00:00.000Z"); // Monday

let db: Db;
let seq = 0;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

function captureDeps(adminUserIds: string[]): {
  deps: FlywheelReportDeps;
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  return {
    sent,
    deps: {
      emailEnv: {} as EmailEnv,
      adminUserIds,
      now: () => NOW,
      sendEmail: async (_e, m) => {
        sent.push(m);
      },
    },
  };
}

async function addUser(opts: {
  role?: string;
  verified?: boolean;
}): Promise<string> {
  const id = `pa-${seq++}`;
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@fixture.example`,
    emailVerified: opts.verified ?? true,
    role: opts.role ?? null,
  });
  return id;
}

describe("runFlywheelReport", () => {
  it("emails verified platform admins (role='admin' and ADMIN_USER_IDS), skipping others", async () => {
    // A little real funnel data so the report has non-zero stages.
    const orgId = (await createFixtureOrg(db, "flywheel-org", "personal")).id;
    const conn = await forOrg(db, orgId).connections.create({
      vendor: "openai",
      displayName: "OpenAI",
      authKind: "api_key",
    });
    expect(conn.id).toBeTruthy();

    const roleAdmin = await addUser({ role: "admin", verified: true });
    const bootstrapAdmin = await addUser({ verified: true }); // via ADMIN_USER_IDS
    await addUser({ role: "admin", verified: false }); // unverified → excluded
    await addUser({ verified: true }); // plain user → excluded

    const { deps, sent } = captureDeps([bootstrapAdmin]);
    const res = await runFlywheelReport(db, deps);

    expect(res.recipients).toBe(2);
    expect(res.sent).toBe(2);
    const to = sent.map((m) => m.to).sort();
    expect(to).toEqual(
      [`${roleAdmin}@fixture.example`, `${bootstrapAdmin}@fixture.example`].sort(),
    );
    expect(sent[0].subject).toContain("flywheel");
  });

  it("SES unconfigured → skips (no recipients resolved, nothing sent)", async () => {
    const res = await runFlywheelReport(db, {
      emailEnv: {} as EmailEnv,
      adminUserIds: [],
      now: () => NOW,
    });
    expect(res.skipped).toBe("email-unconfigured");
    expect(res.sent).toBe(0);
  });

  it("no platform-admin recipients → skips (fresh db, no admins)", async () => {
    const freshPglite = drizzle(new PGlite(), { schema });
    await migrate(freshPglite, { migrationsFolder: "./drizzle" });
    const freshDb = freshPglite as unknown as Db;
    const { deps, sent } = captureDeps([]);
    const res = await runFlywheelReport(freshDb, deps);
    expect(res.skipped).toBe("no-recipients");
    expect(res.sent).toBe(0);
    expect(sent).toHaveLength(0);
    // In-test migration runs under testTimeout (5s), not hookTimeout — slow under
    // full-suite parallel load on Windows.
  }, 30_000);
});
