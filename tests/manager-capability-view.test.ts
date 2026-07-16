import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  loadManagedRoster,
  loadManagerCapabilityDrillIn,
  managerSurfaceAvailable,
} from "../src/lib/manager-capability-view";
import {
  MANAGER_AUTHORIZED_IDENTITY_MANIFEST,
  managerIdentityManifestGaps,
} from "../src/lib/visibility";

// P3-A (ADR 0045) — the manager per-person capability drill-in authorization
// matrix. This is the point of the build: a manager reads ONLY members of teams
// they manage; a manager of a different team, a plain member, and an admin
// WITHOUT a grant all fail; private mode makes the surface unavailable; the org
// boundary holds; and the output type structurally carries no self-view-only
// (rec/coaching/exposure/mission) field.

let db: Db;
let orgId: string;
let otherOrgId: string;
let teamAId: string;
let teamBId: string;
let personInAId: string; // member of team A, has capability state
let personInBId: string; // member of team B
let personUnteamedId: string; // tracked, on no team

const MANAGER_A = "u-manager-a"; // manages team A
const MANAGER_B = "u-manager-b"; // manages team B
const MEMBER = "u-member"; // plain member, no grant
const ADMIN = "u-admin"; // admin role, no team_managers grant
const MANAGER_OTHER = "u-manager-other"; // manager in the OTHER org

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  await db.insert(schema.user).values([
    { id: MANAGER_A, name: "Manager A", email: "mgra@fixture.example" },
    { id: MANAGER_B, name: "Manager B", email: "mgrb@fixture.example" },
    { id: MEMBER, name: "Member", email: "mem@fixture.example" },
    { id: ADMIN, name: "Admin", email: "adm@fixture.example" },
    { id: MANAGER_OTHER, name: "Other Mgr", email: "oth@fixture.example" },
  ]);

  orgId = (await createFixtureOrg(db, "mgr-org", "team")).id;
  otherOrgId = (await createFixtureOrg(db, "mgr-org-2", "team")).id;
  const scope = forOrg(db, orgId);

  await db.insert(schema.orgMembers).values([
    { orgId, userId: MANAGER_A, role: "member" },
    { orgId, userId: MANAGER_B, role: "member" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: ADMIN, role: "admin" },
  ]);
  await db
    .insert(schema.orgMembers)
    .values([{ orgId: otherOrgId, userId: MANAGER_OTHER, role: "member" }]);

  teamAId = (await scope.teams.create("Team A")).id;
  teamBId = (await scope.teams.create("Team B")).id;

  const pA = await scope.people.create({
    displayName: "Ada Lovelace",
    email: "ada@fixture.example",
  });
  personInAId = pA.id;
  const pB = await scope.people.create({
    displayName: "Bob Member",
    email: "bob@fixture.example",
  });
  personInBId = pB.id;
  const pUn = await scope.people.create({
    displayName: "Unteamed Person",
    email: "un@fixture.example",
  });
  personUnteamedId = pUn.id;

  await scope.teams.addMember(teamAId, personInAId);
  await scope.teams.addMember(teamBId, personInBId);

  await scope.teamManagers.assign(teamAId, MANAGER_A);
  await scope.teamManagers.assign(teamBId, MANAGER_B);

  // Give person A capability state so the drill-in returns rows.
  await scope.mastery.replaceForPerson(personInAId, [
    {
      personId: personInAId,
      capabilitySlug: "ai-coding-foundations",
      mastery: 0.8,
      confidence: 0.4,
      confidenceTier: "directional",
      evidenceCount: 3,
      lastEvidenceAt: "2026-06-15",
      staleness: 0,
      nextCapability: null,
      components: {},
    },
  ]);

  // The OTHER org gets its own manager + team + member, so a cross-org read is
  // a genuine (manager, person) pair — just in the wrong org.
  const otherScope = forOrg(db, otherOrgId);
  const otherTeam = await otherScope.teams.create("Other Team");
  await otherScope.teamManagers.assign(otherTeam.id, MANAGER_OTHER);
});

const drillIn = (
  scopeOrgId: string,
  callerUserId: string,
  personId: string,
  mode: "private" | "managed" | "full" = "managed",
) =>
  loadManagerCapabilityDrillIn(forOrg(db, scopeOrgId), {
    callerUserId,
    personId,
    visibilityMode: mode,
  });

describe("loadManagerCapabilityDrillIn — authorization matrix (ADR 0045)", () => {
  it("a manager reads a member of the team they manage → ok, with name + rows", async () => {
    const r = await drillIn(orgId, MANAGER_A, personInAId, "managed");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.subject.displayName).toBe("Ada Lovelace");
    expect(r.subject.capabilities).toHaveLength(1);
    expect(r.subject.capabilities[0].capabilitySlug).toBe("ai-coding-foundations");
    expect(r.subject.capabilities[0].evidenceCount).toBe(3);
  });

  it("works the same under FULL visibility", async () => {
    const r = await drillIn(orgId, MANAGER_A, personInAId, "full");
    expect(r.status).toBe("ok");
  });

  it("is UNAVAILABLE in private mode, even for the right manager", async () => {
    const r = await drillIn(orgId, MANAGER_A, personInAId, "private");
    expect(r.status).toBe("unavailable");
  });

  it("a manager of a DIFFERENT team cannot read this person → forbidden", async () => {
    const r = await drillIn(orgId, MANAGER_B, personInAId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("a plain member cannot read any peer → forbidden", async () => {
    const r = await drillIn(orgId, MEMBER, personInAId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("an ADMIN without a team_managers grant cannot read per-person mastery → forbidden", async () => {
    const r = await drillIn(orgId, ADMIN, personInAId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("a manager cannot read a tracked person who is on no team → forbidden", async () => {
    const r = await drillIn(orgId, MANAGER_A, personUnteamedId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("a manager cannot read a member of a team they don't manage (person B) → forbidden", async () => {
    const r = await drillIn(orgId, MANAGER_A, personInBId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("cross-org: a manager in another org cannot read this org's person → forbidden", async () => {
    const r = await drillIn(otherOrgId, MANAGER_OTHER, personInAId, "managed");
    expect(r.status).toBe("forbidden");
  });

  it("an unknown person id → forbidden (never confirms existence)", async () => {
    const r = await drillIn(
      orgId,
      MANAGER_A,
      "00000000-0000-0000-0000-000000000000",
      "managed",
    );
    expect(r.status).toBe("forbidden");
  });
});

describe("loadManagedRoster — the manager entry point", () => {
  it("lists the managed team's members by name for its manager", async () => {
    const r = await loadManagedRoster(forOrg(db, orgId), {
      callerUserId: MANAGER_A,
      visibilityMode: "managed",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.teams).toHaveLength(1);
    expect(r.teams[0].teamId).toBe(teamAId);
    expect(r.teams[0].members.map((m) => m.displayName)).toContain("Ada Lovelace");
    // Never leaks a member of a team this manager does NOT manage.
    expect(r.teams[0].members.some((m) => m.personId === personInBId)).toBe(false);
  });

  it("is forbidden for a plain member and for an admin without a grant", async () => {
    for (const caller of [MEMBER, ADMIN]) {
      const r = await loadManagedRoster(forOrg(db, orgId), {
        callerUserId: caller,
        visibilityMode: "managed",
      });
      expect(r.status).toBe("forbidden");
    }
  });

  it("is unavailable in private mode", async () => {
    const r = await loadManagedRoster(forOrg(db, orgId), {
      callerUserId: MANAGER_A,
      visibilityMode: "private",
    });
    expect(r.status).toBe("unavailable");
  });
});

describe("managerSurfaceAvailable", () => {
  it("is true only for managed/full", () => {
    expect(managerSurfaceAvailable("private")).toBe(false);
    expect(managerSurfaceAvailable("managed")).toBe(true);
    expect(managerSurfaceAvailable("full")).toBe(true);
  });
});

describe("drill-in output carries NO self-view-only field (structural)", () => {
  it("subject + row keys are exactly the mastery fields — no rec/coaching/exposure/mission", async () => {
    const r = await drillIn(orgId, MANAGER_A, personInAId, "managed");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    expect(Object.keys(r.subject).sort()).toEqual([
      "capabilities",
      "displayName",
      "personId",
      "pseudonym",
    ]);
    expect(Object.keys(r.subject.capabilities[0]).sort()).toEqual([
      "capabilitySlug",
      "confidenceTier",
      "evidenceCount",
      "label",
      "lastEvidenceAt",
      "mastery",
    ]);

    // Belt-and-suspenders: no key anywhere in the payload names a self-view-only
    // surface (V4 NOT-list — recommendations, coaching, interaction, exposure,
    // missions stay self-view-only forever).
    const allKeys = [
      ...Object.keys(r.subject),
      ...r.subject.capabilities.flatMap((c) => Object.keys(c)),
    ];
    for (const k of allKeys) {
      expect(k).not.toMatch(
        /recommend|coach|exposure|mission|interaction|nudge|snooze|dismiss/i,
      );
    }
  });
});

describe("manager-authorized identity-surface registry completeness (ADR 0045)", () => {
  it("every manifest field has a registered surface and vice versa", () => {
    const gaps = managerIdentityManifestGaps();
    expect(gaps.missing).toEqual([]);
    expect(gaps.extra).toEqual([]);
  });

  it("the manifest names the identity-bearing fields the surface actually renders", () => {
    expect(MANAGER_AUTHORIZED_IDENTITY_MANIFEST).toContain(
      "drillIn.subject.displayName",
    );
    expect(MANAGER_AUTHORIZED_IDENTITY_MANIFEST).toContain(
      "roster.teams[].members[].displayName",
    );
  });
});
