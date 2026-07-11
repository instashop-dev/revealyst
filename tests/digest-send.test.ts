import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { resolveDigestUnsubscribe } from "../src/db/digest-preferences";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { EmailEnv, EmailMessage } from "../src/lib/email";
import { runWeeklyDigest, type DigestDeps } from "../src/poller/digest";

// Integration tests for the weekly-digest SENDER (F2.2) against a PGlite db:
// recipient selection (admins with verified email only), the two lane defaults
// (personal on / team off), at-least-once CAS idempotency, staleness
// suppression (G5), and the one-click unsubscribe token round-trip.

const NOW = new Date("2026-07-06T14:00:00.000Z"); // Monday, ISO week 28
const DAY = 24 * 60 * 60 * 1000;

let db: Db;
let seq = 0;

function captureDeps(): { deps: DigestDeps; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const deps: DigestDeps = {
    emailEnv: {} as EmailEnv,
    appOrigin: "https://app.example",
    now: () => NOW,
    sendEmail: async (_env, msg) => {
      sent.push(msg);
    },
  };
  return { deps, sent };
}

async function addMember(
  orgId: string,
  role: "admin" | "member",
  opts: { verified: boolean },
): Promise<string> {
  const id = `u-${seq++}`;
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@fixture.example`,
    emailVerified: opts.verified,
  });
  await db.insert(schema.orgMembers).values({ orgId, userId: id, role });
  return id;
}

/** Create an org and give it a usable, freshly-synced connection so the digest
 * is not staleness-suppressed (unless `stale` is set). */
async function orgWithConnection(
  name: string,
  opts: { stale?: boolean } = {},
): Promise<string> {
  const orgId = (await createFixtureOrg(db, name, "personal")).id;
  const conn = await forOrg(db, orgId).connections.create({
    vendor: "openai",
    displayName: "OpenAI",
    authKind: "api_key",
  });
  const lastSuccessAt = new Date(
    NOW.getTime() - (opts.stale ? 30 : 1) * DAY,
  );
  await db
    .update(schema.connections)
    .set({ status: "active", lastSuccessAt })
    .where(eq(schema.connections.id, conn.id));
  return orgId;
}

function tokenFromMessage(msg: EmailMessage): string {
  const header = msg.headers?.find((h) => h.name === "List-Unsubscribe");
  const url = header?.value.replace(/^<|>$/g, "") ?? "";
  return new URL(url).searchParams.get("token") ?? "";
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("recipient selection", () => {
  it("emails a personal org's single verified admin (default on)", async () => {
    const orgId = await orgWithConnection("digest-personal");
    await addMember(orgId, "admin", { verified: true });
    const { deps, sent } = captureDeps();
    const res = await runWeeklyDigest(db, orgId, deps);
    expect(res.lane).toBe("personal");
    expect(res.suppressed).toBe(false);
    expect(res.sent).toBe(1);
    expect(sent).toHaveLength(1);
    // Subject leaks no metric value (inbox privacy).
    expect(sent[0].subject).toBe("Your Revealyst weekly digest");
  });

  it("never emails an unverified address", async () => {
    const orgId = await orgWithConnection("digest-unverified");
    await addMember(orgId, "admin", { verified: false });
    const { deps, sent } = captureDeps();
    const res = await runWeeklyDigest(db, orgId, deps);
    expect(res.recipients).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("never emails a non-admin member", async () => {
    const orgId = await orgWithConnection("digest-member-only");
    await addMember(orgId, "member", { verified: true });
    const { deps, sent } = captureDeps();
    const res = await runWeeklyDigest(db, orgId, deps);
    expect(res.recipients).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("team lane (multi-member) defaults OFF until an admin opts in", async () => {
    const orgId = await orgWithConnection("digest-team");
    await addMember(orgId, "admin", { verified: true });
    const optIn = await addMember(orgId, "admin", { verified: true });

    const first = captureDeps();
    const res1 = await runWeeklyDigest(db, orgId, first.deps);
    expect(res1.lane).toBe("team");
    expect(res1.sent).toBe(0); // both admins default off

    await forOrg(db, orgId).digestPreferences.setEnabled(optIn, true);
    const second = captureDeps();
    const res2 = await runWeeklyDigest(db, orgId, second.deps);
    expect(res2.sent).toBe(1); // only the opted-in admin
  });
});

describe("idempotency (at-least-once CAS)", () => {
  it("does not re-send for the same ISO week on redelivery", async () => {
    const orgId = await orgWithConnection("digest-idempotent");
    await addMember(orgId, "admin", { verified: true });
    const a = captureDeps();
    expect((await runWeeklyDigest(db, orgId, a.deps)).sent).toBe(1);
    const b = captureDeps();
    // Same week, redelivered message → CAS loses → no second send.
    expect((await runWeeklyDigest(db, orgId, b.deps)).sent).toBe(0);
    expect(b.sent).toHaveLength(0);
  });
});

describe("staleness suppression (G5)", () => {
  it("suppresses the whole send when no connection synced within the window", async () => {
    const orgId = await orgWithConnection("digest-stale", { stale: true });
    await addMember(orgId, "admin", { verified: true });
    const { deps, sent } = captureDeps();
    const res = await runWeeklyDigest(db, orgId, deps);
    expect(res.suppressed).toBe(true);
    expect(res.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("one-click unsubscribe token round-trip", () => {
  it("resolves the token, turns the digest off, and is idempotent", async () => {
    const orgId = await orgWithConnection("digest-unsub");
    await addMember(orgId, "admin", { verified: true });
    const first = captureDeps();
    await runWeeklyDigest(db, orgId, first.deps);
    const token = tokenFromMessage(first.sent[0]);
    expect(token.length).toBeGreaterThan(0);

    // The one-click unsubscribe flips the pref off.
    expect(await resolveDigestUnsubscribe(db, token)).toBe(true);
    // A second visit still succeeds (idempotent end state).
    expect(await resolveDigestUnsubscribe(db, token)).toBe(true);
    // An unknown token fails.
    expect(await resolveDigestUnsubscribe(db, "not-a-real-token")).toBe(false);

    // A later week's send now skips the unsubscribed admin.
    const laterDeps: DigestDeps = {
      ...first.deps,
      now: () => new Date(NOW.getTime() + 7 * DAY),
      sendEmail: async () => {},
    };
    const laterSent: EmailMessage[] = [];
    laterDeps.sendEmail = async (_e, m) => {
      laterSent.push(m);
    };
    const res = await runWeeklyDigest(db, orgId, laterDeps);
    expect(res.sent).toBe(0);
    expect(laterSent).toHaveLength(0);
  });
});
