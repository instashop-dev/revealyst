import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  addInitiativeParticipants,
  readInitiativeRoster,
  removeInitiativeParticipant,
} from "../src/lib/initiative-roster-view";
import {
  MANAGER_AUTHORIZED_IDENTITY_MANIFEST,
  MANAGER_AUTHORIZED_IDENTITY_SURFACES,
  managerIdentityManifestGaps,
} from "../src/lib/visibility";

// TMD P2c (ADR 0062) — the manager-vs-member-vs-admin authz matrix for the
// NAMED initiative roster (the wall-crossing surface). Mirrors
// manager-capability-view.test.ts: only the OWNER, in managed/full mode, reads
// or edits the names; every other caller resolves `forbidden`/`unavailable`.

let db: Db;
let orgId: string;
let otherOrgId: string;
let teamId: string;
let initiativeId: string;
let alice: string;
let bob: string;
let carol: string; // NOT on any team the owner manages
const OWNER = "roster-owner";
const OTHER_MANAGER = "roster-other-mgr";
const MEMBER = "roster-member";
const ADMIN = "roster-admin";

async function makePerson(org: string, pseudonym: string, displayName: string) {
  const [p] = await db
    .insert(schema.people)
    .values({ orgId: org, pseudonym, displayName })
    .returning();
  return p.id;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "roster-org", kind: "team" })
    .returning();
  orgId = org.id;
  const [orgB] = await db
    .insert(schema.orgs)
    .values({ name: "roster-org-b", kind: "team" })
    .returning();
  otherOrgId = orgB.id;

  await db.insert(schema.user).values([
    { id: OWNER, name: "Owner", email: "owner@roster.example" },
    { id: OTHER_MANAGER, name: "Other", email: "other@roster.example" },
    { id: MEMBER, name: "Member", email: "member@roster.example" },
    { id: ADMIN, name: "Admin", email: "admin@roster.example" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId, userId: OWNER, role: "member" },
    { orgId, userId: OTHER_MANAGER, role: "member" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: ADMIN, role: "admin" },
  ]);

  const scope = forOrg(db, orgId);
  teamId = (await scope.teams.create("Platform")).id;
  const otherTeamId = (await scope.teams.create("Other")).id;
  await scope.teamManagers.assign(teamId, OWNER);
  await scope.teamManagers.assign(otherTeamId, OTHER_MANAGER);

  alice = await makePerson(orgId, "P-alice", "Alice");
  bob = await makePerson(orgId, "P-bob", "Bob");
  carol = await makePerson(orgId, "P-carol", "Carol");
  // alice + bob are on the OWNER's team; carol is on nobody's managed team.
  await scope.teams.addMember(teamId, alice);
  await scope.teams.addMember(teamId, bob);

  const initiative = await scope.initiatives.create({
    teamId: null,
    ownerUserId: OWNER,
    title: "Roster initiative",
    templateSlug: "build-one-repeatable-workflow",
    capabilitySlug: "consistent-daily-use",
    scoreSlug: "fluency",
    baseline: null,
    target: 70,
    reviewDate: "2026-09-30",
  });
  initiativeId = initiative.id;
  await scope.initiatives.addParticipants(initiativeId, [alice]);
});

const args = (userId: string, mode: "private" | "managed" | "full" = "managed") => ({
  initiativeId,
  callerUserId: userId,
  visibilityMode: mode,
});

describe("initiative roster — authorization matrix", () => {
  it("the OWNER in managed mode reads the named roster + managed candidates", async () => {
    const r = await readInitiativeRoster(forOrg(db, orgId), args(OWNER));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.participants.map((p) => p.label)).toEqual(["Alice"]);
    expect(new Set(r.candidates.map((c) => c.label))).toEqual(
      new Set(["Alice", "Bob"]),
    );
  });

  it("the OWNER in private mode gets `unavailable` (names never render in private)", async () => {
    expect((await readInitiativeRoster(forOrg(db, orgId), args(OWNER, "private"))).status).toBe(
      "unavailable",
    );
  });

  it("a DIFFERENT manager gets `forbidden` (owner-only, not any manager)", async () => {
    expect((await readInitiativeRoster(forOrg(db, orgId), args(OTHER_MANAGER))).status).toBe(
      "forbidden",
    );
  });

  it("a plain member gets `forbidden`", async () => {
    expect((await readInitiativeRoster(forOrg(db, orgId), args(MEMBER))).status).toBe("forbidden");
  });

  it("an admin WITHOUT ownership gets `forbidden` (no ambient admin read, ADR 0045)", async () => {
    expect((await readInitiativeRoster(forOrg(db, orgId), args(ADMIN))).status).toBe("forbidden");
  });

  it("another org's scope never sees this initiative (cross-org `forbidden`)", async () => {
    expect((await readInitiativeRoster(forOrg(db, otherOrgId), args(OWNER))).status).toBe(
      "forbidden",
    );
  });
});

describe("initiative roster — writes (owner-only, managed-roster-bounded)", () => {
  it("the owner adds a managed person; it appears in the roster", async () => {
    const r = await addInitiativeParticipants(forOrg(db, orgId), {
      ...args(OWNER),
      personIds: [bob],
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(new Set(r.participants.map((p) => p.label))).toEqual(
      new Set(["Alice", "Bob"]),
    );
  });

  it("adding a person NOT on a managed team is `invalid` (can't name the unseen)", async () => {
    const r = await addInitiativeParticipants(forOrg(db, orgId), {
      ...args(OWNER),
      personIds: [carol],
    });
    expect(r.status).toBe("invalid");
    // …and nothing was written.
    const after = await forOrg(db, orgId).initiatives.participantsWithNames(initiativeId);
    expect(after.some((p) => p.personId === carol)).toBe(false);
  });

  it("a non-owner cannot add participants (`forbidden`)", async () => {
    expect(
      (
        await addInitiativeParticipants(forOrg(db, orgId), {
          ...args(OTHER_MANAGER),
          personIds: [alice],
        })
      ).status,
    ).toBe("forbidden");
  });

  it("the owner removes a participant", async () => {
    const r = await removeInitiativeParticipant(forOrg(db, orgId), {
      ...args(OWNER),
      personId: bob,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.participants.some((p) => p.personId === bob)).toBe(false);
  });
});

describe("initiative roster — visibility registry completeness", () => {
  it("the named roster field is registered (manifest ⇄ surfaces parity)", () => {
    expect(MANAGER_AUTHORIZED_IDENTITY_MANIFEST).toContain(
      "initiativeRoster.participants[].displayName",
    );
    expect(
      MANAGER_AUTHORIZED_IDENTITY_SURFACES.some((s) =>
        s.fields.includes("initiativeRoster.participants[].displayName"),
      ),
    ).toBe(true);
    const gaps = managerIdentityManifestGaps();
    expect(gaps.missing).toEqual([]);
    expect(gaps.extra).toEqual([]);
  });
});
