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
import { digestReturnDim } from "../src/lib/launch-events";
import { runWeeklyDigest, type DigestDeps } from "../src/poller/digest";

// End-to-end digest return-rate loop (W5-I): the weekly digest tags its
// app-return CTA with ?src=digest&wk=<isoWeek>; replaying a click on that exact
// URL through the worker's digestReturnDim seam lands a week-keyed
// digest_return event whose dim is the ISO week the digest was sent.

const NOW = new Date("2026-07-06T14:00:00.000Z"); // Monday, ISO week 28
const DAY = 24 * 60 * 60 * 1000;

let db: Db;
let seq = 0;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

async function orgWithVerifiedAdmin(name: string): Promise<string> {
  const orgId = (await createFixtureOrg(db, name, "personal")).id;
  const conn = await forOrg(db, orgId).connections.create({
    vendor: "openai",
    displayName: "OpenAI",
    authKind: "api_key",
  });
  await db
    .update(schema.connections)
    .set({ status: "active", lastSuccessAt: new Date(NOW.getTime() - DAY) })
    .where(eq(schema.connections.id, conn.id));
  const id = `u-${seq++}`;
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@fixture.example`,
    emailVerified: true,
  });
  await db.insert(schema.orgMembers).values({ orgId, userId: id, role: "admin" });
  return orgId;
}

describe("digest → return-event round trip", () => {
  it("a replayed manage-CTA click lands a digest_return event keyed on the sent week", async () => {
    const orgId = await orgWithVerifiedAdmin("digest-return");
    const sent: EmailMessage[] = [];
    const deps: DigestDeps = {
      emailEnv: {} as EmailEnv,
      appOrigin: "https://app.example",
      now: () => NOW,
      sendEmail: async (_e, m) => {
        sent.push(m);
      },
    };
    await runWeeklyDigest(db, orgId, deps);
    expect(sent).toHaveLength(1);

    // Pull the app-return CTA href out of the rendered email (HTML-escaped &).
    const match = sent[0].html.match(
      /href="(https:\/\/app\.example\/settings[^"]*)"/,
    );
    expect(match).not.toBeNull();
    const href = match![1].replace(/&amp;/g, "&");
    const url = new URL(href);
    expect(url.searchParams.get("src")).toBe("digest");
    expect(url.searchParams.get("wk")).toBe("2026-W28");

    // Replay the click through the worker's edge seam: a document GET of that
    // URL fires digest_return with the week as its dim.
    const dim = digestReturnDim(
      "GET",
      false,
      url.searchParams.get("src"),
      url.searchParams.get("wk"),
    );
    expect(dim).toBe("2026-W28");
  });
});
