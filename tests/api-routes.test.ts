import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for /api/share and /api/reconcile (W4-Q). These invoke
// the REAL route handlers (their ownership/role checks, body parsing, error
// mapping, and the org-scoped writes they issue — incl. the ADR-0010 audit
// rows) against a PGlite-backed db. Only the request-context resolver
// (appContext) is mocked — it needs the Workers runtime — so everything the
// handler actually does runs for real.

// A mutable holder the mocked appContext reads, so each test can swap the
// authenticated identity/role or simulate a signed-out caller (null).
const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

// Import the handlers AFTER the mock is registered.
import { GET as shareGET, POST as sharePOST } from "@/app/api/share/route";
import { DELETE as shareDELETE } from "@/app/api/share/[id]/route";
import { POST as reconcilePOST } from "@/app/api/reconcile/route";

let db: Db;
let orgId: string;
let ownerPersonId: string;
let otherPersonId: string;
const USER_ID = "user-owner";
const OTHER_USER_ID = "user-other";
// Valid-format (v4) uuids that never exist in the seed — exercise the
// not-found branches, not the uuid-format 400.
const MISSING_PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_SUBJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING_PERSON_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function ctxFor(opts: { userId: string; role?: "admin" | "member" }) {
  return {
    env: {},
    db,
    session: { user: { id: opts.userId } },
    user: { id: opts.userId },
    org: { id: orgId, kind: "personal" as const },
    role: opts.role ?? "admin",
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "routes-org", "personal")).id;
  // The two auth users the share ownership check reads.
  await db.insert(schema.user).values([
    { id: USER_ID, name: "Owner", email: "owner@fixture.example" },
    { id: OTHER_USER_ID, name: "Other", email: "other@fixture.example" },
  ]);
  // One tracked person per auth user (the people_org_auth_user_uq index caps
  // it at one), reused across the share tests.
  ownerPersonId = (
    await forOrg(db, orgId).people.create({
      displayName: "Owner",
      authUserId: USER_ID,
    })
  ).id;
  otherPersonId = (
    await forOrg(db, orgId).people.create({
      displayName: "Other",
      authUserId: OTHER_USER_ID,
    })
  ).id;
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: USER_ID });
});

describe("POST /api/share", () => {
  it("creates a self-share link and writes an audit row", async () => {
    const res = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", {
        personId: ownerPersonId,
        scoreSlug: "fluency",
        publicLabel: "My score",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; id: string };
    expect(body.token).toBeTruthy();
    expect(body.id).toBeTruthy();

    const links = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.id, body.id));
    expect(links).toHaveLength(1);
    expect(links[0].personId).toBe(ownerPersonId);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "share.create"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("403s when sharing someone else's person", async () => {
    const res = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", {
        personId: otherPersonId,
        scoreSlug: "fluency",
        publicLabel: "x",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("400s when the person is not in this org", async () => {
    const res = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", {
        personId: MISSING_PERSON,
        scoreSlug: "fluency",
        publicLabel: "x",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s on a malformed body", async () => {
    const res = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", { personId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", {
        personId: MISSING_PERSON,
        scoreSlug: "fluency",
        publicLabel: "x",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET + DELETE /api/share", () => {
  it("lists the owner's links, then revokes one", async () => {
    const created = await sharePOST(
      jsonReq("http://localhost/api/share", "POST", {
        personId: ownerPersonId,
        scoreSlug: "velocity",
        publicLabel: "L",
      }),
    );
    const { id } = (await created.json()) as { id: string };

    const listed = await shareGET(
      jsonReq(
        `http://localhost/api/share?personId=${ownerPersonId}`,
        "GET",
      ),
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { links: Array<{ id: string }> };
    expect(listBody.links.some((l) => l.id === id)).toBe(true);

    const deleted = await shareDELETE(jsonReq(`http://localhost/api/share/${id}`, "DELETE"), {
      params: Promise.resolve({ id }),
    });
    expect(deleted.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.id, id));
    expect(row.revokedAt).not.toBeNull();
  });

  it("404s revoking a non-uuid id", async () => {
    const res = await shareDELETE(
      jsonReq("http://localhost/api/share/nope", "DELETE"),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/reconcile", () => {
  async function seedSubject(externalId: string) {
    const conn = await forOrg(db, orgId).connections.create({
      vendor: "cursor",
      displayName: "Cursor",
      authKind: "admin_key",
    });
    const [subject] = await forOrg(db, orgId).subjects.upsertMany(conn.id, [
      { kind: "person", externalId, email: `${externalId}@fixture.example` },
    ]);
    return subject;
  }

  it("create_and_link makes a person, links the subject, and audits it", async () => {
    const subject = await seedSubject("recon-1");
    const res = await reconcilePOST(
      jsonReq("http://localhost/api/reconcile", "POST", {
        action: "create_and_link",
        subjectId: subject.id,
        displayName: "Reconciled Person",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; personId: string };
    expect(body.personId).toBeTruthy();

    const identity = await db
      .select()
      .from(schema.identities)
      .where(
        and(
          eq(schema.identities.subjectId, subject.id),
          eq(schema.identities.personId, body.personId),
        ),
      );
    expect(identity).toHaveLength(1);
    expect(identity[0].method).toBe("manual");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "identity.create_and_link"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("404s linking a subject not in the org", async () => {
    const person = await forOrg(db, orgId).people.create({ displayName: "P" });
    const res = await reconcilePOST(
      jsonReq("http://localhost/api/reconcile", "POST", {
        action: "link",
        subjectId: MISSING_SUBJECT,
        personId: person.id,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("403s for a non-admin caller", async () => {
    h.ctx = ctxFor({ userId: USER_ID, role: "member" });
    const res = await reconcilePOST(
      jsonReq("http://localhost/api/reconcile", "POST", {
        action: "link",
        subjectId: MISSING_SUBJECT,
        personId: MISSING_PERSON_2,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("400s on an unknown action", async () => {
    const res = await reconcilePOST(
      jsonReq("http://localhost/api/reconcile", "POST", { action: "bogus" }),
    );
    expect(res.status).toBe(400);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await reconcilePOST(
      jsonReq("http://localhost/api/reconcile", "POST", {
        action: "link",
        subjectId: MISSING_SUBJECT,
        personId: MISSING_PERSON_2,
      }),
    );
    expect(res.status).toBe(401);
  });
});
