import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";
import { subscriptionsForOrg } from "../src/db/subscriptions";
import {
  handlePaddleWebhook,
  type PaddleWebhookEnv,
} from "../src/lib/paddle-webhook";

// W3-M PR2: the CI harness for Paddle webhook ingestion — signature paths and
// every event → entitlement transition, driven by fixtures/paddle. Proves the
// flow "tested, not clicked" (execution plan §W3-M).

const SECRET = "pdl_ntfset_test_secret_key_0123456789";
const SANDBOX_SECRET = "pdl_ntfset_test_sandbox_key_9876543210";
const ENV: PaddleWebhookEnv = { PADDLE_WEBHOOK_SECRET: SECRET };

let db: Db;
let orgId: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "paddle-org", "team")).id;
});

type Over = { orgId?: string | null; subId?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadEvent(name: string, over: Over = {}): any {
  const raw = JSON.parse(readFileSync(`fixtures/paddle/${name}.json`, "utf8"));
  const org = "orgId" in over ? over.orgId : orgId;
  if (raw.data.custom_data) {
    if (org === null) delete raw.data.custom_data.org_id;
    else raw.data.custom_data.org_id = org;
  }
  if (over.subId) raw.data.id = over.subId;
  return raw;
}

async function signHeader(
  secret: string,
  body: string,
  ts = "1799999999",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ts}:${body}`),
  );
  return `ts=${ts};h1=${Buffer.from(sig).toString("hex")}`;
}

async function post(
  name: string,
  opts: { over?: Over; env?: PaddleWebhookEnv; secret?: string } = {},
) {
  const rawBody = JSON.stringify(loadEvent(name, opts.over));
  const signatureHeader = await signHeader(opts.secret ?? SECRET, rawBody);
  return handlePaddleWebhook(db, opts.env ?? ENV, { rawBody, signatureHeader });
}

describe("Paddle webhook — subscription lifecycle (end to end)", () => {
  it("created → updated → canceled, and a late stale event does not resurrect it", async () => {
    let res = await post("subscription-created");
    expect(res.status).toBe(200);
    let ent = await subscriptionsForOrg(db, orgId).current();
    expect(ent.plan).toBe("team");
    expect(ent.quantity).toBe(5);

    res = await post("subscription-updated");
    expect(res.status).toBe(200);
    ent = await subscriptionsForOrg(db, orgId).current();
    expect(ent.quantity).toBe(12);

    res = await post("subscription-canceled");
    expect(res.status).toBe(200);
    expect((await subscriptionsForOrg(db, orgId).current()).plan).toBe(
      "personal",
    );

    // The created event (occurred 07-07) re-delivered AFTER the cancel
    // (occurred 07-09) must not re-grant Team.
    res = await post("subscription-created");
    expect(res.status).toBe(200);
    expect((await subscriptionsForOrg(db, orgId).current()).plan).toBe(
      "personal",
    );
  });
});

describe("Paddle webhook — signature verification", () => {
  it("401 when the signature header is missing", async () => {
    const rawBody = JSON.stringify(loadEvent("subscription-created"));
    const res = await handlePaddleWebhook(db, ENV, {
      rawBody,
      signatureHeader: null,
    });
    expect(res.status).toBe(401);
  });

  it("401 when signed with the wrong secret", async () => {
    const res = await post("subscription-created", { secret: "wrong-secret" });
    expect(res.status).toBe(401);
  });

  it("401 when the body is tampered after signing", async () => {
    const signed = JSON.stringify(loadEvent("subscription-created"));
    const signatureHeader = await signHeader(SECRET, signed);
    const tampered = `${signed} `; // one byte different
    const res = await handlePaddleWebhook(db, ENV, {
      rawBody: tampered,
      signatureHeader,
    });
    expect(res.status).toBe(401);
  });

  it("500 (never falls open) when no secret is configured", async () => {
    const res = await post("subscription-created", { env: {} });
    expect(res.status).toBe(500);
  });

  it("accepts a signature from the SANDBOX secret when only that is set", async () => {
    const org = (await createFixtureOrg(db, "paddle-sbx", "team")).id;
    const res = await post("subscription-created", {
      env: { PADDLE_WEBHOOK_SECRET_SANDBOX: SANDBOX_SECRET },
      secret: SANDBOX_SECRET,
      over: { orgId: org, subId: "sub_sandbox_only" },
    });
    expect(res.status).toBe(200);
    expect((await subscriptionsForOrg(db, org).current()).plan).toBe("team");
  });
});

describe("Paddle webhook — acknowledge-and-ignore paths (no retry storms)", () => {
  it("transaction.completed is acknowledged with no entitlement change", async () => {
    const org = (await createFixtureOrg(db, "paddle-txn", "team")).id;
    const res = await post("transaction-completed", {
      over: { orgId: org, subId: "sub_txn" },
    });
    expect(res.status).toBe(200);
    expect((await subscriptionsForOrg(db, org).current()).plan).toBe(
      "personal",
    );
  });

  it("an unknown status is acknowledged + skipped — never crashes, never overwrites", async () => {
    const org = (await createFixtureOrg(db, "paddle-unk", "team")).id;
    const subId = "sub_unknown_status";
    // Establish a known active row first.
    await post("subscription-created", { over: { orgId: org, subId } });
    // A newer event with an out-of-enum status must not touch it.
    const res = await post("subscription-unknown-status", {
      over: { orgId: org, subId },
    });
    expect(res.status).toBe(200);
    const ent = await subscriptionsForOrg(db, org).current();
    expect(ent.plan).toBe("team");
    expect(ent.status).toBe("active");
  });

  it("a missing org_id passthrough is acknowledged + ignored, writing nothing", async () => {
    const org = (await createFixtureOrg(db, "paddle-noorg", "team")).id;
    const res = await post("subscription-created", {
      over: { orgId: null, subId: "sub_no_org" },
    });
    expect(res.status).toBe(200);
    expect((await subscriptionsForOrg(db, org).current()).plan).toBe(
      "personal",
    );
    expect(await subscriptionsForOrg(db, org).list()).toHaveLength(0);
  });

  it("a non-UUID org_id is acknowledged + ignored (no uuid-cast crash)", async () => {
    const res = await post("subscription-created", {
      over: { orgId: "not-a-uuid", subId: "sub_bad_uuid" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ignored: "no_org" });
  });

  it("a valid-UUID org that does not exist is acknowledged + ignored (no FK crash)", async () => {
    const res = await post("subscription-created", {
      over: {
        orgId: "00000000-0000-4000-8000-000000000000",
        subId: "sub_ghost_org",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ignored: "no_org" });
  });

  it("a malformed occurred_at is acknowledged + ignored (no Invalid-Date crash)", async () => {
    const org = (await createFixtureOrg(db, "paddle-baddate", "team")).id;
    const event = loadEvent("subscription-created", {
      orgId: org,
      subId: "sub_bad_date",
    });
    event.occurred_at = "not-a-date";
    const rawBody = JSON.stringify(event);
    const signatureHeader = await signHeader(SECRET, rawBody);
    const res = await handlePaddleWebhook(db, ENV, { rawBody, signatureHeader });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ignored: "occurred_at" });
    expect(await subscriptionsForOrg(db, org).list()).toHaveLength(0);
  });
});
