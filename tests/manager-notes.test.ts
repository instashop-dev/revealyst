import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { MANAGER_NOTES_COPY } from "../src/lib/manager-capability-copy";
import { loadManagerNotes } from "../src/lib/manager-notes-view";

// D-TCI-7 (ADR 0053) — the manager-notes authorization matrix, over the
// org-scope namespace AND the loader. The access derivation mirrors the
// capability/spend drill-in halves (person ∈ a caller-managed team, fail-closed,
// unauthorized indistinguishable from missing), with two notes-specific rules on
// top: read visibility is ANY current manager of the subject's team
// (author-attributed, NOT author-only), and delete is AUTHOR-ONLY.

let db: Db;
let orgId: string;
let otherOrgId: string;
let teamAId: string; // managed by MANAGER_A and COMANAGER_A
let teamBId: string; // managed by MANAGER_B
let personAId: string; // team A member — the note subject
let personBId: string; // team B member

const MANAGER_A = "mn-mgr-a";
const COMANAGER_A = "mn-mgr-a2"; // second manager of team A
const MANAGER_B = "mn-mgr-b"; // manages a DIFFERENT team
const MEMBER = "mn-member"; // plain org member, no grants
const ADMIN = "mn-admin"; // org admin WITHOUT a manager grant
const SUBJECT_USER = "mn-subject"; // the tracked person's OWN login
const MANAGER_OTHER = "mn-mgr-other"; // manager in another org

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;

  await db.insert(schema.user).values([
    { id: MANAGER_A, name: "Manager A", email: "mna@fixture.example" },
    { id: COMANAGER_A, name: "Co Manager", email: "mna2@fixture.example" },
    { id: MANAGER_B, name: "Manager B", email: "mnb@fixture.example" },
    { id: MEMBER, name: "Member", email: "mnm@fixture.example" },
    { id: ADMIN, name: "Admin", email: "mnadm@fixture.example" },
    { id: SUBJECT_USER, name: "Subject", email: "ada@fixture.example" },
    { id: MANAGER_OTHER, name: "Other", email: "mnoth@fixture.example" },
  ]);

  orgId = (await createFixtureOrg(db, "mn-org", "team")).id;
  otherOrgId = (await createFixtureOrg(db, "mn-org-2", "team")).id;
  const scope = forOrg(db, orgId);

  await db.insert(schema.orgMembers).values([
    { orgId, userId: MANAGER_A, role: "member" },
    { orgId, userId: COMANAGER_A, role: "member" },
    { orgId, userId: MANAGER_B, role: "member" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: ADMIN, role: "admin" },
    { orgId, userId: SUBJECT_USER, role: "member" },
  ]);
  await db
    .insert(schema.orgMembers)
    .values([{ orgId: otherOrgId, userId: MANAGER_OTHER, role: "member" }]);

  teamAId = (await scope.teams.create("Team A")).id;
  teamBId = (await scope.teams.create("Team B")).id;

  // The note subject is ALSO a dashboard login (people.auth_user_id linked) —
  // the sharpest shape for the "subject never sees notes about them" rule.
  personAId = (
    await scope.people.create({
      displayName: "Ada",
      email: "ada@fixture.example",
      authUserId: SUBJECT_USER,
    })
  ).id;
  personBId = (
    await scope.people.create({ displayName: "Bo", email: "bo@f.example" })
  ).id;

  await scope.teams.addMember(teamAId, personAId);
  await scope.teams.addMember(teamBId, personBId);

  await scope.teamManagers.assign(teamAId, MANAGER_A);
  await scope.teamManagers.assign(teamAId, COMANAGER_A);
  await scope.teamManagers.assign(teamBId, MANAGER_B);

  const otherScope = forOrg(db, otherOrgId);
  const otherTeam = await otherScope.teams.create("Other Team");
  await otherScope.teamManagers.assign(otherTeam.id, MANAGER_OTHER);
});

/** Resolve the caller's managed teams then run the namespace read — the same
 * two steps the loader performs. */
async function listAs(callerUserId: string, personId: string, org = orgId) {
  const scope = forOrg(db, org);
  const managed = await scope.teamManagers.managedTeamIds(callerUserId);
  return scope.managerNotes.listForPerson(personId, managed);
}

const load = (
  callerUserId: string,
  personId: string,
  mode: "private" | "managed" | "full" = "managed",
  org = orgId,
) =>
  loadManagerNotes(forOrg(db, org), {
    callerUserId,
    personId,
    visibilityMode: mode,
  });

describe("managerNotes namespace — write + read round-trip (ADR 0053)", () => {
  it("a manager of the person's team creates a note; it round-trips with the follow-up date", async () => {
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(MANAGER_A);
    const note = await scope.managerNotes.create(
      personAId,
      managed,
      MANAGER_A,
      "Pairing on prompt drafts went well.",
      "2026-08-01",
    );
    expect(note).not.toBeNull();
    expect(note!.authorUserId).toBe(MANAGER_A);
    expect(note!.followUpOn).toBe("2026-08-01");

    const listed = await scope.managerNotes.listForPerson(personAId, managed);
    expect(listed).not.toBeNull();
    expect(listed!.map((n) => n.id)).toContain(note!.id);
  });

  it("lists newest first", async () => {
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(MANAGER_A);
    // A second, later note (created after the first test's note).
    await scope.managerNotes.create(
      personAId,
      managed,
      MANAGER_A,
      "Newer observation.",
      null,
    );
    const listed = await scope.managerNotes.listForPerson(personAId, managed);
    expect(listed!.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < listed!.length; i++) {
      expect(
        listed![i - 1].createdAt.getTime(),
      ).toBeGreaterThanOrEqual(listed![i].createdAt.getTime());
    }
  });

  it("create for a person NOT on a caller-managed team returns null (no row written)", async () => {
    const scope = forOrg(db, orgId);
    const managedB = await scope.teamManagers.managedTeamIds(MANAGER_B);
    const note = await scope.managerNotes.create(
      personAId, // team A — B does not manage it
      managedB,
      MANAGER_B,
      "should never be written",
      null,
    );
    expect(note).toBeNull();
    // And the co-manager read (which sees ALL of person A's notes) never
    // surfaces such a body.
    const all = await listAs(MANAGER_A, personAId);
    expect(all!.some((n) => n.body === "should never be written")).toBe(false);
  });
});

describe("managerNotes — read-visibility matrix", () => {
  it("the author-manager reads their own notes → ok", async () => {
    const r = await load(MANAGER_A, personAId);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.notes.length).toBeGreaterThanOrEqual(2);
  });

  it("a CO-MANAGER of the same team reads ALL notes, author-attributed (the documented choice)", async () => {
    const r = await load(COMANAGER_A, personAId);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // Sees MANAGER_A's notes — read visibility is any current manager of the
    // subject's team, not author-only (ADR 0053).
    expect(r.notes.some((n) => n.authorUserId === MANAGER_A)).toBe(true);
  });

  it("works the same under FULL visibility", async () => {
    const r = await load(MANAGER_A, personAId, "full");
    expect(r.status).toBe("ok");
  });

  it("a manager of a DIFFERENT team cannot read → forbidden (namespace: null)", async () => {
    const r = await load(MANAGER_B, personAId);
    expect(r.status).toBe("forbidden");
    expect(await listAs(MANAGER_B, personAId)).toBeNull();
  });

  it("a plain member cannot read → forbidden", async () => {
    const r = await load(MEMBER, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("THE SUBJECT's own session NEVER sees notes about them → forbidden", async () => {
    // Ada's own login (people.auth_user_id linked) holds no manager grant, so
    // the loader fails closed — there is NO self-view read path for notes at
    // all (the only read surface is the manager loader, ADR 0053).
    const r = await load(SUBJECT_USER, personAId);
    expect(r.status).toBe("forbidden");
    expect(await listAs(SUBJECT_USER, personAId)).toBeNull();
  });

  it("an ADMIN without a manager grant is forbidden (no ambient admin read)", async () => {
    const r = await load(ADMIN, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("cross-org: a manager in another org cannot read this org's person → forbidden", async () => {
    const r = await load(MANAGER_OTHER, personAId, "managed", otherOrgId);
    expect(r.status).toBe("forbidden");
  });

  it("an unknown person id → forbidden (never confirms existence)", async () => {
    const r = await load(
      MANAGER_A,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(r.status).toBe("forbidden");
  });

  it("is UNAVAILABLE in private mode, even for the right manager", async () => {
    const r = await load(MANAGER_A, personAId, "private");
    expect(r.status).toBe("unavailable");
  });

  it("a managed person with no notes is still ok with an empty list (the add form renders)", async () => {
    const r = await load(MANAGER_B, personBId);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.notes).toEqual([]);
  });
});

describe("managerNotes.deleteByAuthor — author-only delete", () => {
  it("a co-manager who can READ a note cannot DELETE it; the author can", async () => {
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(MANAGER_A);
    const note = await scope.managerNotes.create(
      personAId,
      managed,
      MANAGER_A,
      "delete-matrix note",
      null,
    );

    // The co-manager sees it…
    const seen = await listAs(COMANAGER_A, personAId);
    expect(seen!.some((n) => n.id === note!.id)).toBe(true);
    // …but their delete matches no row.
    expect(
      await scope.managerNotes.deleteByAuthor(note!.id, COMANAGER_A),
    ).toBe(false);
    const still = await listAs(MANAGER_A, personAId);
    expect(still!.some((n) => n.id === note!.id)).toBe(true);

    // The author's delete succeeds and the row is gone for everyone.
    expect(await scope.managerNotes.deleteByAuthor(note!.id, MANAGER_A)).toBe(
      true,
    );
    const gone = await listAs(COMANAGER_A, personAId);
    expect(gone!.some((n) => n.id === note!.id)).toBe(false);
  });

  it("a delete through another org's scope matches no row", async () => {
    const scope = forOrg(db, orgId);
    const managed = await scope.teamManagers.managedTeamIds(MANAGER_A);
    const note = await scope.managerNotes.create(
      personAId,
      managed,
      MANAGER_A,
      "cross-org delete probe",
      null,
    );
    expect(
      await forOrg(db, otherOrgId).managerNotes.deleteByAuthor(
        note!.id,
        MANAGER_A,
      ),
    ).toBe(false);
    // Clean up.
    expect(await scope.managerNotes.deleteByAuthor(note!.id, MANAGER_A)).toBe(
      true,
    );
  });
});

describe("manager-notes copy — plain-English sweep (D-TCI-7)", () => {
  const collectStrings = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") {
      try {
        return collectStrings(
          (v as (...a: unknown[]) => unknown)("2026-08-01", "just now"),
        );
      } catch {
        return [];
      }
    }
    if (v && typeof v === "object") {
      return Object.values(v as Record<string, unknown>).flatMap(
        collectStrings,
      );
    }
    return [];
  };
  const allCopy = collectStrings(MANAGER_NOTES_COPY).join(" ").toLowerCase();

  it("carries no ranking / verdict / gamification / scoring vocabulary", () => {
    for (const banned of [
      "leaderboard",
      "ranking",
      "rank ",
      "top performer",
      "underperform",
      "worst",
      "best performer",
      "grade",
      "streak",
      "points",
      "badge",
      "score",
    ]) {
      expect(allCopy.includes(banned), `banned phrase "${banned}"`).toBe(false);
    }
  });

  it("states on the surface that co-managers can see notes and the person never does", () => {
    // The candid-visibility disclosure (ADR 0053 consequences): an author must
    // never be surprised by who reads their note.
    expect(MANAGER_NOTES_COPY.description).toContain(
      "Anyone who manages their team can see these",
    );
    expect(MANAGER_NOTES_COPY.description).toContain(
      "never shown to the person",
    );
  });
});
