import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for the manager-notes write surface (D-TCI-7, ADR 0053):
// POST /api/team/:personId/notes and DELETE /api/team/:personId/notes/:noteId.
// Invokes the REAL route handlers (session gate, impersonation guard, body
// parse, the manager authz in api-impl) against a PGlite db. Only appContext is
// mocked (it needs the Workers runtime). Pins: impersonated WRITES are 403
// (reads stay allowed per ADR 0045 — there is no read route to gate),
// delete-own-only (a co-manager who can read cannot delete), and the 404
// collapse of every unauthorized outcome.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({ appContext: async () => h.ctx }));

import { POST as notesPOST } from "@/app/api/team/[personId]/notes/route";
import { DELETE as noteDELETE } from "@/app/api/team/[personId]/notes/[noteId]/route";

let db: Db;
let orgId: string;
let teamAId: string;
let personAId: string;
let selfPersonId: string; // tracked person LINKED to MANAGER_A (player-manager)

const MANAGER_A = "mnapi-mgr-a";
const COMANAGER_A = "mnapi-mgr-a2";
const MEMBER = "mnapi-member";

function ctxFor(opts: {
  userId: string;
  impersonating?: boolean;
  visibilityMode?: "private" | "managed" | "full";
}) {
  return {
    env: {},
    db,
    session: {
      session: { impersonatedBy: opts.impersonating ? "some-admin" : null },
      user: { id: opts.userId },
    },
    user: { id: opts.userId },
    org: {
      id: orgId,
      kind: "team" as const,
      visibilityMode: opts.visibilityMode ?? ("managed" as const),
    },
    role: "member" as const,
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const postReq = (body?: unknown) =>
  new Request("http://localhost/api/team/x/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const postParams = (personId: string) => ({
  params: Promise.resolve({ personId }),
});
const deleteParams = (personId: string, noteId: string) => ({
  params: Promise.resolve({ personId, noteId }),
});
const delReq = () =>
  new Request("http://localhost/api/team/x/notes/y", { method: "DELETE" });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;

  await db.insert(schema.user).values([
    { id: MANAGER_A, name: "Manager A", email: "a@mnapi.example" },
    { id: COMANAGER_A, name: "Co Manager", email: "a2@mnapi.example" },
    { id: MEMBER, name: "Member", email: "m@mnapi.example" },
  ]);
  orgId = (await createFixtureOrg(db, "mnapi-org", "team")).id;
  await db.insert(schema.orgMembers).values([
    { orgId, userId: MANAGER_A, role: "member" },
    { orgId, userId: COMANAGER_A, role: "member" },
    { orgId, userId: MEMBER, role: "member" },
  ]);
  const scope = forOrg(db, orgId);
  teamAId = (await scope.teams.create("Team A")).id;
  personAId = (
    await scope.people.create({ displayName: "Ada", email: "ada@mnapi.example" })
  ).id;
  await scope.teams.addMember(teamAId, personAId);
  // MANAGER_A is ALSO tracked (auth-linked) — the player-manager route probe.
  // This second person also keeps the org out of resolveSelfPersonId's
  // org-of-one fallback, so Ada is never mistaken for the caller.
  selfPersonId = (
    await scope.people.create({
      displayName: "Manager A",
      email: "a@mnapi.example",
      authUserId: MANAGER_A,
    })
  ).id;
  await scope.teams.addMember(teamAId, selfPersonId);
  await scope.teamManagers.assign(teamAId, MANAGER_A);
  await scope.teamManagers.assign(teamAId, COMANAGER_A);
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: MANAGER_A });
});

describe("POST /api/team/:personId/notes", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await notesPOST(postReq({ body: "x" }), postParams(personAId));
    expect(res.status).toBe(401);
  });

  it("403s an impersonating session (no note authored in the victim's name)", async () => {
    h.ctx = ctxFor({ userId: MANAGER_A, impersonating: true });
    const res = await notesPOST(postReq({ body: "x" }), postParams(personAId));
    expect(res.status).toBe(403);
  });

  it("400s a blank body and a malformed follow-up date", async () => {
    expect(
      (await notesPOST(postReq({ body: "   " }), postParams(personAId)))
        .status,
    ).toBe(400);
    expect(
      (
        await notesPOST(
          postReq({ body: "ok", followUpOn: "next tuesday" }),
          postParams(personAId),
        )
      ).status,
    ).toBe(400);
  });

  it("400s an impossible calendar date the shape regex admits (2026-13-45)", async () => {
    // Without the round-trip refine this reaches Postgres's `date` column and
    // 500s instead of failing the schema.
    for (const bad of ["2026-13-45", "2026-02-30"]) {
      const res = await notesPOST(
        postReq({ body: "ok", followUpOn: bad }),
        postParams(personAId),
      );
      expect(res.status, `followUpOn ${bad}`).toBe(400);
    }
  });

  it("player-manager (auth-linked): writing a note about THEMSELVES → 404 (ADR 0053 self-exclusion)", async () => {
    const res = await notesPOST(
      postReq({ body: "note to self" }),
      postParams(selfPersonId),
    );
    expect(res.status).toBe(404);
  });

  it("a manager of the person's team creates a note; author is the SESSION user, never the body", async () => {
    const res = await notesPOST(
      postReq({
        body: "Great prompt-review session.",
        followUpOn: "2026-08-01",
        // Mass-assignment probe — must be ignored.
        authorUserId: "someone-else",
      }),
      postParams(personAId),
    );
    expect(res.status).toBe(200);
    const note = (await res.json()) as {
      id: string;
      authorUserId: string;
      followUpOn: string | null;
    };
    expect(note.authorUserId).toBe(MANAGER_A);
    expect(note.followUpOn).toBe("2026-08-01");
  });

  it("404s a plain member (unauthorized indistinguishable from missing)", async () => {
    h.ctx = ctxFor({ userId: MEMBER });
    const res = await notesPOST(postReq({ body: "x" }), postParams(personAId));
    expect(res.status).toBe(404);
  });

  it("404s an unknown person id for a real manager", async () => {
    const res = await notesPOST(
      postReq({ body: "x" }),
      postParams("00000000-0000-4000-8000-000000000000"),
    );
    expect(res.status).toBe(404);
  });

  it("404s in private visibility mode (the whole manager surface is unavailable)", async () => {
    h.ctx = ctxFor({ userId: MANAGER_A, visibilityMode: "private" });
    const res = await notesPOST(postReq({ body: "x" }), postParams(personAId));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/team/:personId/notes/:noteId", () => {
  async function createNote(authorUserId: string): Promise<string> {
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(authorUserId);
    const note = await scope.managerNotes.create(
      personAId,
      managed,
      authorUserId,
      "delete-target",
      null,
    );
    return note!.id;
  }

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await noteDELETE(delReq(), deleteParams(personAId, "x"));
    expect(res.status).toBe(401);
  });

  it("403s an impersonating session", async () => {
    const noteId = await createNote(MANAGER_A);
    h.ctx = ctxFor({ userId: MANAGER_A, impersonating: true });
    const res = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(res.status).toBe(403);
  });

  it("the author deletes their own note → ok; a second delete is 404", async () => {
    const noteId = await createNote(MANAGER_A);
    const res = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const again = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(again.status).toBe(404);
  });

  it("delete-own-only: a CO-MANAGER who can READ the note cannot delete it → 404, row survives", async () => {
    const noteId = await createNote(MANAGER_A);
    h.ctx = ctxFor({ userId: COMANAGER_A });
    const res = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(res.status).toBe(404);
    // The note is still there for its author.
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(MANAGER_A);
    const listed = await scope.managerNotes.listForPerson(personAId, managed);
    expect(listed!.some((n) => n.id === noteId)).toBe(true);
  });

  it("404s a non-manager regardless of note id", async () => {
    const noteId = await createNote(MANAGER_A);
    h.ctx = ctxFor({ userId: MEMBER });
    const res = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(res.status).toBe(404);
  });

  it("404s in private visibility mode even for the author", async () => {
    const noteId = await createNote(MANAGER_A);
    h.ctx = ctxFor({ userId: MANAGER_A, visibilityMode: "private" });
    const res = await noteDELETE(delReq(), deleteParams(personAId, noteId));
    expect(res.status).toBe(404);
  });
});
