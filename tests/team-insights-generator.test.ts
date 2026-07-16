import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import { ApiError, dismissTeamInsight } from "../src/lib/api-impl";
import {
  ALLOWED_PARAM_KEYS,
  CATEGORY_PRIORITY,
  deriveTeamInsights,
  MAX_OPEN_INSIGHTS,
  rankTeamInsights,
  type CapabilityCoverageInput,
  type DeriveTeamInsightsInput,
  type TeamInsightCandidate,
} from "../src/lib/team-insights";
import {
  MANAGER_INSIGHTS_COPY,
  TEAM_INSIGHT_SEVERITY_LABEL,
  renderTeamInsight,
} from "../src/lib/team-insights-glossary";
import { recomputeTeamInsights } from "../src/scoring/recompute-team-insights";
import * as schema from "../src/db/schema";

// TCI Phase 2-F (ADR 0050): the aggregate manager insight generator + reducer +
// lifecycle. The generator is PURE and deterministic (NO LLM); the reducer is
// idempotent and dismissed-sticky; dismissal is manager/admin-only.

const CAP_A = "ai-coding-foundations";
const CAP_B = "consistent-daily-use";
const CAP_C = "feature-breadth";
const MIN = 4; // SEGMENT_MIN_PEOPLE_TO_NAME
const JUNE = "2026-06-15";

function baseInput(
  coverage: CapabilityCoverageInput[],
  over: Partial<DeriveTeamInsightsInput> = {},
): DeriveTeamInsightsInput {
  return {
    coverage,
    prior: new Map(),
    totalPeople: 10,
    peopleWithState: 10,
    connectedCount: 0,
    staleConnectionCount: 0,
    ...over,
  };
}

const LABELS = new Map([
  [CAP_A, "Make AI part of daily work"],
  [CAP_B, "Build a consistent daily habit"],
  [CAP_C, "Use a range of AI features"],
]);

describe("deriveTeamInsights — pure generator", () => {
  it("is deterministic: same aggregates → identical ordered candidates", () => {
    const input = baseInput(
      [
        { capabilitySlug: CAP_A, mastered: 0, withState: 6 },
        { capabilitySlug: CAP_B, mastered: 1, withState: 8 },
      ],
      { staleConnectionCount: 1, connectedCount: 2 },
    );
    const a = deriveTeamInsights(input);
    const b = deriveTeamInsights(input);
    expect(a).toEqual(b);
    // Non-vacuous: it actually produced candidates.
    expect(a.length).toBeGreaterThan(0);
  });

  it("suppresses any insight whose cohort is below MIN_PEOPLE", () => {
    // CAP_A below the floor (3 < 4) — no capability insight; org has < MIN
    // people — no org-wide insight either.
    const below = deriveTeamInsights(
      baseInput([{ capabilitySlug: CAP_A, mastered: 0, withState: 3 }], {
        totalPeople: 3,
        peopleWithState: 0,
        staleConnectionCount: 1,
        connectedCount: 1,
      }),
    );
    expect(below).toEqual([]);

    // At the floor: the capability_gap now appears.
    const at = deriveTeamInsights(
      baseInput([{ capabilitySlug: CAP_A, mastered: 0, withState: MIN }]),
    );
    expect(at.map((c) => c.category)).toContain("capability_gap");
  });

  it("caps to 3 in the documented priority order", () => {
    // Produce candidates across five categories; the ranked top-3 must be the
    // three highest-priority categories present.
    const prior = new Map([
      // CAP_C grew (positive_growth) and CAP_B plateaued.
      [CAP_B, { capabilitySlug: CAP_B, masteredBefore: 2, representedBefore: MIN }],
      [CAP_C, { capabilitySlug: CAP_C, masteredBefore: 1, representedBefore: MIN }],
    ]);
    const ranked = deriveTeamInsights(
      baseInput(
        [
          { capabilitySlug: CAP_A, mastered: 0, withState: 6 }, // capability_gap
          { capabilitySlug: CAP_B, mastered: 1, withState: 6 }, // plateau (1<=2)
          { capabilitySlug: CAP_C, mastered: 3, withState: 6 }, // positive_growth
        ],
        {
          prior,
          totalPeople: 12,
          peopleWithState: 3, // low_adoption (3*2 < 12)
          staleConnectionCount: 1,
          connectedCount: 3, // data_incomplete
        },
      ),
    );
    // All five categories are candidates; the top-3 (before dismissal/cap) are
    // the three highest-priority categories present in CATEGORY_PRIORITY order.
    const top3 = ranked.slice(0, MAX_OPEN_INSIGHTS).map((c) => c.category);
    expect(top3).toEqual(["data_incomplete", "capability_gap", "plateau"]);
    // low_adoption and positive_growth rank below the cap.
    const all = ranked.map((c) => c.category);
    expect(all).toContain("low_adoption");
    expect(all).toContain("positive_growth");
    expect(all.indexOf("low_adoption")).toBeGreaterThanOrEqual(
      MAX_OPEN_INSIGHTS,
    );
  });

  it("assigns each category its fixed severity", () => {
    const ranked = deriveTeamInsights(
      baseInput(
        [
          { capabilitySlug: CAP_A, mastered: 0, withState: 6 },
          { capabilitySlug: CAP_B, mastered: 1, withState: 8 },
        ],
        { staleConnectionCount: 1, connectedCount: 2 },
      ),
    );
    const sev = (cat: string) =>
      ranked.find((c) => c.category === cat)?.severity;
    expect(sev("capability_gap")).toBe("attention");
    expect(sev("concentration")).toBe("opportunity");
    expect(sev("data_incomplete")).toBe("opportunity");
  });

  it("mastered==0 → gap; 1..2 with a developing crowd → concentration (mutually exclusive)", () => {
    const gap = deriveTeamInsights(
      baseInput([{ capabilitySlug: CAP_A, mastered: 0, withState: 6 }]),
    );
    expect(gap.map((c) => c.category)).toEqual(["capability_gap"]);

    const conc = deriveTeamInsights(
      baseInput([{ capabilitySlug: CAP_A, mastered: 2, withState: 8 }]),
    );
    // 2 mastered, 6 developing (>= MIN) → concentration, NOT gap.
    expect(conc.map((c) => c.category)).toEqual(["concentration"]);
  });

  it("rankTeamInsights is a total order (category, then magnitude, then subject)", () => {
    const cands: TeamInsightCandidate[] = [
      { category: "capability_gap", severity: "attention", subject: "z", params: { capabilitySlug: "z", mastered: 0, total: 5 }, magnitude: 5 },
      { category: "capability_gap", severity: "attention", subject: "a", params: { capabilitySlug: "a", mastered: 0, total: 5 }, magnitude: 5 },
      { category: "data_incomplete", severity: "opportunity", subject: "", params: { stale: 1, connected: 2 }, magnitude: 1 },
    ];
    const ranked = rankTeamInsights(cands);
    // data_incomplete first (priority), then the two gaps by subject (a before z).
    expect(ranked.map((c) => `${c.category}:${c.subject}`)).toEqual([
      "data_incomplete:",
      "capability_gap:a",
      "capability_gap:z",
    ]);
    // CATEGORY_PRIORITY leads with data_incomplete.
    expect(CATEGORY_PRIORITY[0]).toBe("data_incomplete");
  });
});

describe("insight params — structural no-person-id guarantee", () => {
  it("every emitted params object uses only the count-only allowlist, no uuid", () => {
    const ranked = deriveTeamInsights(
      baseInput(
        [
          { capabilitySlug: CAP_A, mastered: 0, withState: 6 },
          { capabilitySlug: CAP_B, mastered: 2, withState: 8 },
        ],
        {
          totalPeople: 12,
          peopleWithState: 3,
          staleConnectionCount: 1,
          connectedCount: 3,
          // Review hardening: a prior map so the movement variants
          // (plateau / positive_growth params {masteredNow, masteredBefore})
          // are actually emitted and swept against the allowlist too.
          prior: new Map([
            [CAP_B, { capabilitySlug: CAP_B, masteredBefore: 4, representedBefore: 8 }],
          ]),
        },
      ),
    );
    expect(ranked.length).toBeGreaterThan(0);
    expect(
      ranked.some((c) => c.category === "plateau" || c.category === "positive_growth"),
      "structural sweep must cover the movement params variants",
    ).toBe(true);
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const c of ranked) {
      for (const [key, value] of Object.entries(c.params)) {
        expect(
          (ALLOWED_PARAM_KEYS as readonly string[]).includes(key),
          `param key "${key}" not in the count-only allowlist`,
        ).toBe(true);
        // No value is uuid-shaped (a person id could only arrive as one).
        if (typeof value === "string") {
          expect(uuidRe.test(value), `param "${key}" is uuid-shaped`).toBe(
            false,
          );
        }
      }
    }
  });
});

describe("team-insights glossary copy", () => {
  it("renders plain-English title + body for every category", () => {
    const labelFor = (slug: string) => LABELS.get(slug) ?? slug;
    const samples = [
      { category: "capability_gap" as const, params: { capabilitySlug: CAP_A, mastered: 0, total: 6 } },
      { category: "concentration" as const, params: { capabilitySlug: CAP_A, mastered: 2, total: 8 } },
      { category: "plateau" as const, params: { capabilitySlug: CAP_A, masteredNow: 2, masteredBefore: 2 } },
      { category: "positive_growth" as const, params: { capabilitySlug: CAP_A, masteredNow: 4, masteredBefore: 2 } },
      { category: "low_adoption" as const, params: { active: 3, total: 12 } },
      { category: "data_incomplete" as const, params: { stale: 1, connected: 3 } },
    ];
    for (const s of samples) {
      const copy = renderTeamInsight(s, labelFor);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("plateau copy is honest about direction: a decline never renders as 'held steady'", () => {
    const labelFor = (slug: string) => LABELS.get(slug) ?? slug;
    // Review finding: the plateau category covers stalled AND slipped. The
    // rendered claim must match the stored counts (invariant b on prose).
    const slipped = renderTeamInsight(
      { category: "plateau", params: { capabilitySlug: CAP_A, masteredNow: 3, masteredBefore: 5 } },
      labelFor,
    );
    expect((slipped.title + slipped.body).toLowerCase()).not.toContain("held steady");
    expect((slipped.title + slipped.body).toLowerCase()).not.toContain("hasn't moved");
    expect(slipped.body).toContain("5");
    expect(slipped.body).toContain("3");
    const steady = renderTeamInsight(
      { category: "plateau", params: { capabilitySlug: CAP_A, masteredNow: 5, masteredBefore: 5 } },
      labelFor,
    );
    expect(steady.title.toLowerCase()).toContain("held steady");
  });

  it("contains no leaderboard/ranking/gamification/benchmark language (banned sweep)", () => {
    const labelFor = (slug: string) => LABELS.get(slug) ?? slug;
    const all = [
      MANAGER_INSIGHTS_COPY.title,
      MANAGER_INSIGHTS_COPY.subtitle,
      MANAGER_INSIGHTS_COPY.empty,
      MANAGER_INSIGHTS_COPY.dismiss,
      MANAGER_INSIGHTS_COPY.dismissed,
      ...Object.values(TEAM_INSIGHT_SEVERITY_LABEL),
      ...(
        [
          { category: "capability_gap" as const, params: { capabilitySlug: CAP_A, mastered: 0, total: 6 } },
          { category: "concentration" as const, params: { capabilitySlug: CAP_A, mastered: 2, total: 8 } },
          { category: "plateau" as const, params: { capabilitySlug: CAP_A, masteredNow: 2, masteredBefore: 2 } },
          { category: "plateau" as const, params: { capabilitySlug: CAP_A, masteredNow: 2, masteredBefore: 5 } },
          { category: "positive_growth" as const, params: { capabilitySlug: CAP_A, masteredNow: 4, masteredBefore: 2 } },
          { category: "low_adoption" as const, params: { active: 3, total: 12 } },
          { category: "data_incomplete" as const, params: { stale: 1, connected: 3 } },
        ] as const
      ).flatMap((s) => {
        const c = renderTeamInsight(s, labelFor);
        return [c.title, c.body];
      }),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of [
      "leaderboard",
      "ranking",
      "rank ",
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

// ---- DB-backed: the reducer + lifecycle + authz ----

let db: Db;
let orgId: string;

async function seedPerson(
  cap: string,
  mastery: number,
): Promise<string> {
  const scoped = forOrg(db, orgId);
  const person = await scoped.people.create({
    displayName: `p-${Math.random().toString(36).slice(2)}`,
    email: `p-${Math.random().toString(36).slice(2)}@fixture.example`,
  });
  await scoped.mastery.replaceForPerson(person.id, [
    {
      personId: person.id,
      capabilitySlug: cap,
      mastery,
      confidence: 0.5,
      confidenceTier: "directional",
      evidenceCount: 5,
      lastEvidenceAt: "2026-06-10",
      staleness: 0,
      nextCapability: null,
      components: { active_days: { kind: "component", input: 50, contribution: mastery } },
    },
  ]);
  return person.id;
}

beforeEach(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "team-insights", "team")).id;
});

describe("recomputeTeamInsights — reducer (idempotent, dismissed-sticky)", () => {
  it("two runs → the same open feed, no duplicate rows", async () => {
    // MIN people all developing CAP_A (mastered 0) → a capability_gap.
    for (let i = 0; i < MIN; i++) await seedPerson(CAP_A, 0.3);

    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const first = await forOrg(db, orgId).teamInsights.listOpen();
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const second = await forOrg(db, orgId).teamInsights.listOpen();

    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(MAX_OPEN_INSIGHTS);
    // Same open feed by (category, subject) — the ids are stable too.
    expect(second.map((r) => r.id).sort()).toEqual(
      first.map((r) => r.id).sort(),
    );
    // No physical duplicate rows.
    const raw = await db.select().from(schema.teamInsights);
    expect(raw).toHaveLength(first.length);
  });

  it("never generates more than MAX_OPEN_INSIGHTS", async () => {
    // Many capabilities each with a MIN-sized gap cohort → many candidates.
    for (const cap of [CAP_A, CAP_B, CAP_C, "effective-prompting", "code-review-with-ai"]) {
      for (let i = 0; i < MIN; i++) await seedPerson(cap, 0.3);
    }
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const open = await forOrg(db, orgId).teamInsights.listOpen();
    expect(open.length).toBe(MAX_OPEN_INSIGHTS);
  });

  it("a dismissed insight stays dismissed and never re-opens on the next run", async () => {
    for (let i = 0; i < MIN; i++) await seedPerson(CAP_A, 0.3);
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const scoped = forOrg(db, orgId);
    const open = await scoped.teamInsights.listOpen();
    const target = open[0];

    const dismissed = await scoped.teamInsights.dismiss(target.id);
    expect(dismissed?.status).toBe("dismissed");
    expect(await scoped.teamInsights.listOpen()).toHaveLength(open.length - 1);

    // Re-run: the same condition still holds, but the dismissed subject must NOT
    // reappear (sticky).
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const after = await scoped.teamInsights.listOpen();
    expect(after.some((r) => r.id === target.id)).toBe(false);
    expect(
      after.some(
        (r) => r.category === target.category && r.subject === target.subject,
      ),
    ).toBe(false);
  });

  it("deletes an open insight once its condition resolves", async () => {
    // Start with a gap.
    const ids: string[] = [];
    for (let i = 0; i < MIN; i++) ids.push(await seedPerson(CAP_A, 0.3));
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    expect((await forOrg(db, orgId).teamInsights.listOpen()).length).toBeGreaterThan(0);

    // Everyone masters CAP_A → the gap resolves.
    const scoped = forOrg(db, orgId);
    for (const id of ids) {
      await scoped.mastery.replaceForPerson(id, [
        {
          personId: id,
          capabilitySlug: CAP_A,
          mastery: 0.9,
          confidence: 0.6,
          confidenceTier: "directional",
          evidenceCount: 8,
          lastEvidenceAt: "2026-06-12",
          staleness: 0,
          nextCapability: null,
          components: {},
        },
      ]);
    }
    await recomputeTeamInsights(db, orgId, { asOfDay: JUNE });
    const open = await scoped.teamInsights.listOpen();
    expect(open.some((r) => r.category === "capability_gap")).toBe(false);
  });
});

describe("dismissTeamInsight — lifecycle authz (manager/admin only)", () => {
  async function seedOneInsight(): Promise<string> {
    const scoped = forOrg(db, orgId);
    await scoped.teamInsights.upsertGenerated([
      {
        teamId: null,
        category: "capability_gap",
        severity: "attention",
        subject: CAP_A,
        params: { capabilitySlug: CAP_A, mastered: 0, total: MIN },
        periodStart: "2026-06-01",
      },
    ]);
    const [row] = await scoped.teamInsights.listOpen();
    return row.id;
  }

  it("an org admin may dismiss", async () => {
    const id = await seedOneInsight();
    // The dismiss writes an audit row (actor FK → user), so seed a real user.
    const [admin] = await db
      .insert(schema.user)
      .values({
        id: `admin-${orgId}`,
        name: "Admin",
        email: `admin-${orgId}@example.com`,
      })
      .returning();
    const res = await dismissTeamInsight(
      { scope: forOrg(db, orgId), role: "admin", actorUserId: admin.id },
      id,
    );
    expect(res).toEqual({ ok: true });
  });

  it("a plain member (no manager grant) is 403'd", async () => {
    const id = await seedOneInsight();
    await expect(
      dismissTeamInsight(
        { scope: forOrg(db, orgId), role: "member", actorUserId: "plain-user" },
        id,
      ),
    ).rejects.toMatchObject({ status: 403 });
    // The insight is untouched (still open).
    expect(await forOrg(db, orgId).teamInsights.listOpen()).toHaveLength(1);
  });

  it("a member WHO manages a team may dismiss", async () => {
    const id = await seedOneInsight();
    const scoped = forOrg(db, orgId);
    // A real auth user + a team + a manager grant.
    const [mgr] = await db
      .insert(schema.user)
      .values({
        id: `mgr-${orgId}`,
        name: "Manager",
        email: `mgr-${orgId}@example.com`,
      })
      .returning();
    const team = await scoped.teams.create("Core");
    await scoped.teamManagers.assign(team.id, mgr.id);

    const res = await dismissTeamInsight(
      { scope: forOrg(db, orgId), role: "member", actorUserId: mgr.id },
      id,
    );
    expect(res).toEqual({ ok: true });
  });

  it("a missing/already-dismissed id is a 404", async () => {
    await expect(
      dismissTeamInsight(
        { scope: forOrg(db, orgId), role: "admin", actorUserId: "admin-user" },
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
