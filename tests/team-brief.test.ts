import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import { listManagerRecipients } from "../src/db/system";
import { buildCapabilityCoverage } from "../src/lib/capability-coverage";
import type { CapabilityHistoryRow } from "../src/lib/capability-history";
import { DIGEST_COPY } from "../src/lib/digest-copy";
import { composeTeamBrief } from "../src/lib/team-brief";
import * as schema from "../src/db/schema";

// TCI Phase 2-F (ADR 0050): the weekly manager brief. Aggregate-only; composed
// from the SAME dashboard sources (shared-source parity); sent to manager
// recipients resolved by listManagerRecipients (manager-only, verified-only,
// cross-org isolated).

const CAP_A = "ai-coding-foundations";
const CAP_B = "consistent-daily-use";
const LABELS = new Map([
  [CAP_A, "Make AI part of daily work"],
  [CAP_B, "Build a consistent daily habit"],
]);
const labelFor = (slug: string) => LABELS.get(slug) ?? slug;

function historyRow(
  slug: string,
  periodStart: string,
  mastered: number,
  represented: number,
): CapabilityHistoryRow {
  return {
    teamId: null,
    capabilitySlug: slug,
    periodStart,
    periodEnd: periodStart,
    representedCount: represented,
    totalCount: 10,
    masteredCount: mastered,
    developingCount: represented - mastered,
    masterySumBp: null,
    masterySumSqBp: null,
    confidenceTier: "directional",
  };
}

describe("composeTeamBrief — shared-source parity with the dashboard", () => {
  it("coverage equals buildCapabilityCoverage for the same counts (dashboard parity)", () => {
    const counts = new Map([
      [CAP_A, { mastered: 3, withState: 6 }],
      [CAP_B, { mastered: 2, withState: 5 }],
    ]);
    const dashboardCoverage = buildCapabilityCoverage(counts, LABELS);
    const brief = composeTeamBrief({
      headline: [{ label: "Adoption", value: 62 }],
      coverage: dashboardCoverage,
      history: [],
      insights: [],
      insightSeverities: [],
      labelFor,
      connectedCount: 2,
    });
    expect(brief).not.toBeNull();
    // The brief's coverage is byte-identical (label/mastered/total) to what the
    // dashboard card renders — a snapshot can never disagree with the live view.
    expect(brief!.coverage).toEqual(
      dashboardCoverage.map((c) => ({
        label: c.label,
        mastered: c.mastered,
        total: c.total,
      })),
    );
  });

  it("derives movement from the two latest history periods (count-only)", () => {
    const history = [
      historyRow(CAP_A, "2026-05-01", 1, 6),
      historyRow(CAP_A, "2026-06-01", 3, 6), // up
      historyRow(CAP_B, "2026-06-01", 2, 5), // single period → no movement
    ];
    const brief = composeTeamBrief({
      headline: [],
      coverage: [],
      history,
      insights: [],
      insightSeverities: [],
      labelFor,
      connectedCount: 1,
    });
    expect(brief).not.toBeNull();
    // Only CAP_A has ≥2 periods → one movement row, direction up (1→3).
    expect(brief!.movement).toEqual([
      {
        label: labelFor(CAP_A),
        direction: "up",
        masteredNow: 3,
        masteredBefore: 1,
      },
    ]);
  });

  it("returns null when there is nothing worth a brief", () => {
    expect(
      composeTeamBrief({
        headline: [{ label: "Adoption", value: null }],
        coverage: [],
        history: [],
        insights: [],
        insightSeverities: [],
        labelFor,
        connectedCount: 0,
      }),
    ).toBeNull();
  });

  it("data-confidence line never promises per-person data", () => {
    const brief = composeTeamBrief({
      headline: [],
      coverage: [
        {
          slug: CAP_A,
          label: labelFor(CAP_A),
          mastered: 3,
          total: 6,
          meanMastery: null,
          spread: null,
        },
      ],
      history: [],
      insights: [],
      insightSeverities: [],
      labelFor,
      connectedCount: 2,
    });
    expect(brief!.dataConfidenceLine.toLowerCase()).toContain(
      "never shows any individual",
    );
  });
});

describe("team-brief copy — banned-phrasing sweep", () => {
  it("contains no leaderboard/ranking/gamification/benchmark language", () => {
    const tb = DIGEST_COPY.teamBrief;
    const all = [
      DIGEST_COPY.sections.teamBrief,
      tb.lead,
      tb.maturity,
      tb.coverage,
      tb.movement,
      tb.insights,
      tb.coverageRow("Make AI part of daily work", 3, 6),
      tb.movementRow("Make AI part of daily work", "up", 3, 1),
      tb.movementRow("X", "down", 1, 3),
      tb.movementRow("X", "flat", 2, 2),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of [
      "leaderboard",
      "ranking",
      "xp",
      "streak",
      "league",
      "points",
      "badge",
      "percentile",
      "industry average",
      "surveillance",
    ]) {
      expect(all.includes(word), `banned word "${word}"`).toBe(false);
    }
  });
});

// ---- listManagerRecipients (manager-only, verified-only, cross-org) ----

let db: Db;

async function seedUser(id: string, verified: boolean): Promise<string> {
  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: verified,
    })
    .returning();
  return row.id;
}

beforeEach(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("listManagerRecipients", () => {
  it("returns distinct verified managers of THIS org only", async () => {
    const orgA = (await createFixtureOrg(db, "brief-a", "team")).id;
    const orgB = (await createFixtureOrg(db, "brief-b", "team")).id;
    const scopeA = forOrg(db, orgA);
    const scopeB = forOrg(db, orgB);

    const t1 = await scopeA.teams.create("Team 1");
    const t2 = await scopeA.teams.create("Team 2");
    const verifiedMgr = await seedUser("mgr-verified", true);
    const unverifiedMgr = await seedUser("mgr-unverified", false);
    const bMgr = await seedUser("mgr-b", true);

    // verifiedMgr manages BOTH teams (must appear ONCE), unverifiedMgr excluded.
    await scopeA.teamManagers.assign(t1.id, verifiedMgr);
    await scopeA.teamManagers.assign(t2.id, verifiedMgr);
    await scopeA.teamManagers.assign(t1.id, unverifiedMgr);
    // org B's manager must never leak into org A's recipients.
    const tB = await scopeB.teams.create("B Team");
    await scopeB.teamManagers.assign(tB.id, bMgr);

    const { recipients } = await listManagerRecipients(db, orgA);
    expect(recipients.map((r) => r.userId)).toEqual([verifiedMgr]);
    expect(recipients).toHaveLength(1);

    // org B sees only its own.
    const bRecipients = (await listManagerRecipients(db, orgB)).recipients;
    expect(bRecipients.map((r) => r.userId)).toEqual([bMgr]);
  });

  it("returns none when a team has no managers", async () => {
    const orgId = (await createFixtureOrg(db, "brief-none", "team")).id;
    await forOrg(db, orgId).teams.create("Lonely");
    const { recipients } = await listManagerRecipients(db, orgId);
    expect(recipients).toEqual([]);
  });
});
