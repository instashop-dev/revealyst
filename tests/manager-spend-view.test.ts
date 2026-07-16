import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { TEAM_COST_VISIBILITY_SETTINGS_COPY, MANAGER_SPEND_COPY } from "../src/lib/manager-capability-copy";
import { loadManagerSpendDrillIn } from "../src/lib/manager-spend-view";

// P3-B (ADR 0045, spend half) — the manager per-person SPEND drill-in
// authorization matrix + honesty derivation. Extends the capability-half matrix
// with the toggle: toggle-OFF hides spend (while capability still renders),
// toggle-ON reveals it, an admin without a grant is forbidden even with the
// toggle on, and the multi-team edge follows the RESTRICTIVE reading (access must
// derive through a toggle-ON managed team). Honesty: reported/estimated never
// summed, shared-account spend excluded + disclosed as counts, per-model is token
// volume only.

const TODAY = "2026-07-15"; // MTD = 2026-07-01..15, prior = 2026-06-01..30

let db: Db;
let orgId: string;
let otherOrgId: string;
let teamAId: string; // manages: MANAGER_A ; toggle ON
let teamDId: string; // manages: MANAGER_A ; toggle OFF
let teamBId: string; // manages: MANAGER_B ; toggle OFF
let personAId: string; // team A only; exclusive + shared subjects with spend
let personDId: string; // team D only (toggle off)
let personMId: string; // team A (toggle on) AND team D (toggle off) — multi-team
let personBId: string; // team B only
let personBSharedId: string; // shares an account with person A

const MANAGER_A = "sp-mgr-a";
const MANAGER_B = "sp-mgr-b";
const MEMBER = "sp-member";
const ADMIN = "sp-admin";
const MANAGER_OTHER = "sp-mgr-other";

function row(
  subjectId: string,
  connectionId: string,
  metricKey: string,
  day: string,
  value: number,
  dim = "",
) {
  return {
    subjectId,
    metricKey,
    day,
    dim,
    connectionId,
    value,
    attribution: "account" as const,
    sourceConnector: "test@1",
  };
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;

  await db.insert(schema.user).values([
    { id: MANAGER_A, name: "Manager A", email: "spa@fixture.example" },
    { id: MANAGER_B, name: "Manager B", email: "spb@fixture.example" },
    { id: MEMBER, name: "Member", email: "spm@fixture.example" },
    { id: ADMIN, name: "Admin", email: "spadm@fixture.example" },
    { id: MANAGER_OTHER, name: "Other", email: "spoth@fixture.example" },
  ]);

  orgId = (await createFixtureOrg(db, "sp-org", "team")).id;
  otherOrgId = (await createFixtureOrg(db, "sp-org-2", "team")).id;
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
  teamDId = (await scope.teams.create("Team D")).id;
  teamBId = (await scope.teams.create("Team B")).id;

  personAId = (await scope.people.create({ displayName: "Ada", email: "ada@f.example" })).id;
  personDId = (await scope.people.create({ displayName: "Dee", email: "dee@f.example" })).id;
  personMId = (await scope.people.create({ displayName: "Mo", email: "mo@f.example" })).id;
  personBId = (await scope.people.create({ displayName: "Bo", email: "bo@f.example" })).id;
  personBSharedId = (await scope.people.create({ displayName: "Cy", email: "cy@f.example" })).id;

  await scope.teams.addMember(teamAId, personAId);
  await scope.teams.addMember(teamDId, personDId);
  await scope.teams.addMember(teamAId, personMId);
  await scope.teams.addMember(teamDId, personMId);
  await scope.teams.addMember(teamBId, personBId);

  await scope.teamManagers.assign(teamAId, MANAGER_A);
  await scope.teamManagers.assign(teamDId, MANAGER_A);
  await scope.teamManagers.assign(teamBId, MANAGER_B);

  // Toggle ON for team A; team D + team B stay default (OFF).
  await scope.teamSettings.set(teamAId, { managersSeeIndividualCost: true });

  // Spend facts. One connection; subjects linked to people via identities.
  const conn = await scope.connections.create({
    vendor: "cursor",
    displayName: "Cursor",
    authKind: "admin_key",
  });
  const [exclusiveA] = await scope.subjects.upsertMany(conn.id, [
    { kind: "person", externalId: "a-exclusive" },
  ]);
  const [sharedAcct] = await scope.subjects.upsertMany(conn.id, [
    { kind: "account", externalId: "shared-acct" },
  ]);
  // Ada owns the exclusive subject; the shared account is linked to BOTH Ada and
  // Cy (so it is NOT exclusive to Ada — its spend must never be her number).
  await scope.identities.link(exclusiveA.id, personAId, "manual");
  await scope.identities.link(sharedAcct.id, personAId, "manual");
  await scope.identities.link(sharedAcct.id, personBSharedId, "manual");

  await scope.metrics.upsertRecords([
    // Exclusive subject — attributable to Ada.
    row(exclusiveA.id, conn.id, "spend_cents", "2026-07-05", 6_000), // MTD reported
    row(exclusiveA.id, conn.id, "spend_cents", "2026-06-10", 4_000), // prior reported
    row(exclusiveA.id, conn.id, "spend_cents_estimated", "2026-07-06", 5_500), // MTD estimated
    row(exclusiveA.id, conn.id, "model_tokens", "2026-07-05", 1_000, "model=opus"),
    row(exclusiveA.id, conn.id, "model_tokens", "2026-07-05", 3_000, "model=haiku"),
    row(exclusiveA.id, conn.id, "spend_cents", "2026-05-01", 99_999), // before prior window → excluded
    // Shared account — has spend, but must be DISCLOSED (count), never attributed.
    row(sharedAcct.id, conn.id, "spend_cents", "2026-07-08", 2_000),
  ]);

  const otherScope = forOrg(db, otherOrgId);
  const otherTeam = await otherScope.teams.create("Other Team");
  await otherScope.teamManagers.assign(otherTeam.id, MANAGER_OTHER);
});

const load = (
  scopeOrgId: string,
  callerUserId: string,
  personId: string,
  mode: "private" | "managed" | "full" = "managed",
) =>
  loadManagerSpendDrillIn(forOrg(db, scopeOrgId), {
    callerUserId,
    personId,
    visibilityMode: mode,
    today: TODAY,
  });

describe("loadManagerSpendDrillIn — authorization matrix (ADR 0045 spend half)", () => {
  it("toggle ON: a manager reads a managed member's spend → ok", async () => {
    const r = await load(orgId, MANAGER_A, personAId);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // Reported and estimated kept SEPARATE, per window.
    expect(r.spend.reported.mtdCents).toBe(6_000);
    expect(r.spend.reported.priorCents).toBe(4_000);
    expect(r.spend.estimated.mtdCents).toBe(5_500);
    expect(r.spend.estimated.priorCents).toBe(0);
  });

  it("works the same under FULL visibility", async () => {
    const r = await load(orgId, MANAGER_A, personAId, "full");
    expect(r.status).toBe("ok");
  });

  it("is UNAVAILABLE in private mode, even for the right manager with the toggle on", async () => {
    const r = await load(orgId, MANAGER_A, personAId, "private");
    expect(r.status).toBe("unavailable");
  });

  it("toggle OFF: a managed member's spend is COST-HIDDEN (capability still renders)", async () => {
    // Dee is on team D (managed by A) whose toggle is OFF → cost-hidden, NOT ok.
    const r = await load(orgId, MANAGER_A, personDId);
    expect(r.status).toBe("cost-hidden");
  });

  it("multi-team edge: access derives through a toggle-ON managed team → ok", async () => {
    // Mo is on team A (toggle ON) AND team D (toggle OFF), both managed by A.
    // The RESTRICTIVE reading still authorizes: the toggle-ON grant on A is real.
    const r = await load(orgId, MANAGER_A, personMId);
    expect(r.status).toBe("ok");
  });

  it("a manager of a DIFFERENT team cannot read this person → forbidden", async () => {
    const r = await load(orgId, MANAGER_B, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("a plain member cannot read any peer → forbidden", async () => {
    const r = await load(orgId, MEMBER, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("an ADMIN without a grant is forbidden EVEN with the toggle on", async () => {
    const r = await load(orgId, ADMIN, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("cross-org: a manager in another org cannot read this org's person → forbidden", async () => {
    const r = await load(otherOrgId, MANAGER_OTHER, personAId);
    expect(r.status).toBe("forbidden");
  });

  it("an unknown person id → forbidden (never confirms existence)", async () => {
    const r = await load(orgId, MANAGER_A, "00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe("forbidden");
  });
});

describe("honesty — allocation confidence + reported/estimated (invariant b)", () => {
  it("sums ONLY exclusive-subject spend; shared-account spend is disclosed as a count, never added", async () => {
    const r = await load(orgId, MANAGER_A, personAId);
    if (r.status !== "ok") throw new Error("expected ok");
    // The shared account had 2_000 in MTD — it is NOT in the reported figure.
    expect(r.spend.reported.mtdCents).toBe(6_000);
    // Coverage disclosed as honest COUNTS.
    expect(r.spend.coverage.attributableSubjectCount).toBe(1);
    expect(r.spend.coverage.sharedSubjectCount).toBe(1);
    expect(r.spend.coverage.sharedSubjectsWithSpendCount).toBe(1);
  });

  it("model mix is TOKEN volume only — no per-model dollar field exists structurally", async () => {
    const r = await load(orgId, MANAGER_A, personAId);
    if (r.status !== "ok") throw new Error("expected ok");
    // haiku 3000 > opus 1000 → 75% / 25%.
    expect(r.spend.modelVolume.map((m) => m.model)).toEqual(["haiku", "opus"]);
    expect(Math.round(r.spend.modelVolume[0].sharePct)).toBe(75);
    // Each model row carries token volume + share ONLY — never a cents/dollar key.
    for (const m of r.spend.modelVolume) {
      expect(Object.keys(m).sort()).toEqual(["model", "sharePct", "tokens"]);
    }
  });

  it("the spend payload has NO blended-cents field (reported + estimated separate by shape)", async () => {
    const r = await load(orgId, MANAGER_A, personAId);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(Object.keys(r.spend).sort()).toEqual([
      "coverage",
      "estimated",
      "modelVolume",
      "reported",
    ]);
    expect(Object.keys(r.spend.reported).sort()).toEqual(["mtdCents", "priorCents"]);
    // No key anywhere names a blended total or a per-model dollar.
    const keys = [
      ...Object.keys(r.spend),
      ...Object.keys(r.spend.reported),
      ...Object.keys(r.spend.estimated),
      ...Object.keys(r.spend.coverage),
      ...r.spend.modelVolume.flatMap((m) => Object.keys(m)),
    ];
    for (const k of keys) {
      expect(k.toLowerCase()).not.toMatch(/blend|total|combined|permodel|modelcost/);
    }
  });
});

describe("Manager spend copy — banned-phrasing sweep (P3-B)", () => {
  const collectStrings = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") {
      // Exercise the dynamic strings so the sweep covers them too.
      try {
        return collectStrings(
          (v as (...a: unknown[]) => unknown)({
            attributableSubjectCount: 2,
            sharedSubjectCount: 1,
            sharedSubjectsWithSpendCount: 1,
          }),
        ).concat(
          collectStrings((v as (...a: unknown[]) => unknown)("Team X")),
        );
      } catch {
        return [];
      }
    }
    if (v && typeof v === "object") {
      return Object.values(v as Record<string, unknown>).flatMap(collectStrings);
    }
    return [];
  };
  const allCopy = collectStrings({
    MANAGER_SPEND_COPY,
    TEAM_COST_VISIBILITY_SETTINGS_COPY,
  })
    .join(" ")
    .toLowerCase();

  it("carries no ranking / leaderboard / verdict / gamification vocabulary", () => {
    for (const banned of [
      "leaderboard",
      "ranking",
      "top performer",
      "underperform",
      "worst",
      "best performer",
      "grade",
      "streak",
      "points",
      "badge",
      "cost per model",
    ]) {
      expect(allCopy.includes(banned), `banned phrase "${banned}"`).toBe(false);
    }
  });

  it("states the cost≠capability framing on the surface", () => {
    expect(MANAGER_SPEND_COPY.contextNote.toLowerCase()).toContain("not a measure");
  });
});
