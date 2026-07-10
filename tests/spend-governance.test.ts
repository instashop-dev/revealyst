import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { MAX_BUDGET_CENTS, setBudget } from "../src/lib/api-impl";
import {
  evaluateBudgetAlert,
  monthToDateWindow,
  readBudgetAlert,
  readBudgetAlertForRole,
  readSpendGovernance,
  summarizeModelVolume,
  summarizeSpendByTool,
} from "../src/lib/spend-governance";

// W4-V Spend Governance: budget CRUD through forOrg, the compute-on-read
// threshold logic (crossings, month boundaries, no-data honesty), and the
// vendor-reported-vs-derived drill-down labeling.

// ─── Pure logic (no DB) ──────────────────────────────────────────────────────

describe("monthToDateWindow", () => {
  it("spans the 1st of the month through today (UTC)", () => {
    expect(monthToDateWindow("2026-07-15")).toEqual({
      from: "2026-07-01",
      to: "2026-07-15",
    });
  });

  it("is a single day on the 1st (month boundary)", () => {
    expect(monthToDateWindow("2026-07-01")).toEqual({
      from: "2026-07-01",
      to: "2026-07-01",
    });
  });

  it("rejects a non-day string", () => {
    expect(() => monthToDateWindow("2026-07")).toThrow();
  });
});

describe("evaluateBudgetAlert", () => {
  const thresholds = [50, 80, 100];

  it("returns null below the lowest threshold", () => {
    expect(
      evaluateBudgetAlert({
        monthlyLimitCents: 10_000,
        alertThresholds: thresholds,
        spentCents: 4_000, // 40%
      }),
    ).toBeNull();
  });

  it("reports the HIGHEST crossed threshold, not the first", () => {
    const alert = evaluateBudgetAlert({
      monthlyLimitCents: 10_000,
      alertThresholds: thresholds,
      spentCents: 8_500, // 85% → crosses 50 and 80
    });
    expect(alert).toEqual({ crossedThreshold: 80, pctUsed: 85, overBudget: false });
  });

  it("crosses at an exact boundary (>=)", () => {
    const alert = evaluateBudgetAlert({
      monthlyLimitCents: 10_000,
      alertThresholds: thresholds,
      spentCents: 5_000, // exactly 50%
    });
    expect(alert?.crossedThreshold).toBe(50);
  });

  it("flags overBudget at/over 100%", () => {
    const alert = evaluateBudgetAlert({
      monthlyLimitCents: 10_000,
      alertThresholds: thresholds,
      spentCents: 12_000, // 120%
    });
    expect(alert).toEqual({ crossedThreshold: 100, pctUsed: 120, overBudget: true });
  });

  it("no spend crosses no threshold — honest silence, not a floored alert", () => {
    expect(
      evaluateBudgetAlert({
        monthlyLimitCents: 10_000,
        alertThresholds: thresholds,
        spentCents: 0,
      }),
    ).toBeNull();
  });

  it("a non-positive limit yields no alert", () => {
    expect(
      evaluateBudgetAlert({
        monthlyLimitCents: 0,
        alertThresholds: thresholds,
        spentCents: 5_000,
      }),
    ).toBeNull();
  });
});

describe("summarizeSpendByTool", () => {
  const connections = [
    { id: "c-cursor", vendor: "cursor", displayName: "Cursor" },
    { id: "c-agent", vendor: "claude_code_local", displayName: "Claude Code" },
  ];

  it("keeps vendor-reported and derived cost in separate fields, never blended", () => {
    const rows = summarizeSpendByTool(
      [{ connectionId: "c-cursor", value: 5_000 }],
      [{ connectionId: "c-agent", value: 3_000 }],
      connections,
    );
    const cursor = rows.find((r) => r.connectionId === "c-cursor")!;
    const agent = rows.find((r) => r.connectionId === "c-agent")!;
    // Cursor: vendor-reported only.
    expect(cursor.reportedCents).toBe(5_000);
    expect(cursor.estimatedCents).toBe(0);
    // Claude Code local: derived-only (a real honesty gap, not $0 vendor cost).
    expect(agent.reportedCents).toBe(0);
    expect(agent.estimatedCents).toBe(3_000);
    expect(agent.vendorLabel).toBe("Claude Code (local agent)");
  });

  it("sums multiple days per tool and sorts by total spend desc", () => {
    const rows = summarizeSpendByTool(
      [
        { connectionId: "c-agent", value: 1_000 },
        { connectionId: "c-cursor", value: 2_000 },
        { connectionId: "c-cursor", value: 4_000 },
      ],
      [],
      connections,
    );
    expect(rows.map((r) => r.connectionId)).toEqual(["c-cursor", "c-agent"]);
    expect(rows[0].reportedCents).toBe(6_000);
  });

  it("surfaces spend from a since-removed connection rather than dropping it", () => {
    const rows = summarizeSpendByTool(
      [{ connectionId: "c-gone", value: 900 }],
      [],
      connections,
    );
    expect(rows[0].displayName).toBe("Removed connection");
    expect(rows[0].reportedCents).toBe(900);
  });
});

describe("summarizeModelVolume", () => {
  it("parses model=<id> dims into a token-volume mix with shares", () => {
    const models = summarizeModelVolume([
      { dim: "model=claude-opus-4", value: 300 },
      { dim: "model=claude-haiku-4-5", value: 100 },
      { dim: "model=claude-opus-4", value: 100 }, // same model, another day
    ]);
    expect(models).toEqual([
      { model: "claude-opus-4", tokens: 400, sharePct: 80 },
      { model: "claude-haiku-4-5", tokens: 100, sharePct: 20 },
    ]);
  });

  it("ignores non-model dims (never fabricates a model bucket)", () => {
    expect(summarizeModelVolume([{ dim: "", value: 500 }])).toEqual([]);
    expect(summarizeModelVolume([{ dim: "feature=chat", value: 5 }])).toEqual([]);
  });
});

// ─── Repository + read layer (PGlite) ────────────────────────────────────────

describe("budgets repo + read layer", () => {
  let db: Db;
  let scope: ReturnType<typeof forOrg>;
  let connectionId: string;
  let subjectId: string;

  beforeAll(async () => {
    const pglite = drizzle(new PGlite(), { schema });
    await migrate(pglite, { migrationsFolder: "./drizzle" });
    db = pglite as unknown as Db;
    const org = await createFixtureOrg(db, "w4v-spend", "team");
    scope = forOrg(db, org.id);
    const conn = await scope.connections.create({
      vendor: "cursor",
      displayName: "Cursor",
      authKind: "admin_key",
    });
    connectionId = conn.id;
    const [subj] = await scope.subjects.upsertMany(connectionId, [
      { kind: "person", externalId: "u1" },
    ]);
    subjectId = subj.id;
    await scope.metrics.upsertRecords([
      // July (in the MTD window for a mid-July "today"). The SAME connection
      // carries both vendor-reported (spend_cents) and derived
      // (spend_cents_estimated) spend — the Anthropic double-count shape: the
      // estimate can overlap the billed figure, so the budget threshold must
      // measure vendor-reported only, never the blend.
      row(subjectId, connectionId, "spend_cents", "2026-07-05", 6_000),
      row(subjectId, connectionId, "spend_cents_estimated", "2026-07-06", 5_500),
      row(subjectId, connectionId, "model_tokens", "2026-07-05", 1_000, "model=claude-opus-4"),
      row(subjectId, connectionId, "model_tokens", "2026-07-05", 3_000, "model=claude-haiku-4-5"),
      // June — a prior month; must NOT count toward July's month-to-date spend.
      row(subjectId, connectionId, "spend_cents", "2026-06-30", 100_000),
    ]);
  });

  it("get/set/clear round-trips the org's single budget", async () => {
    expect(await scope.budgets.get()).toBeUndefined();

    const set = await scope.budgets.set({ monthlyLimitCents: 10_000 });
    expect(set.monthlyLimitCents).toBe(10_000);
    expect(set.alertThresholds).toEqual([50, 80, 100]); // default

    // set() again UPSERTs (one budget per org), doesn't error.
    const updated = await scope.budgets.set({
      monthlyLimitCents: 20_000,
      alertThresholds: [75, 100],
    });
    expect(updated.monthlyLimitCents).toBe(20_000);
    expect(updated.alertThresholds).toEqual([75, 100]);
    expect((await scope.budgets.get())?.monthlyLimitCents).toBe(20_000);

    await scope.budgets.clear();
    expect(await scope.budgets.get()).toBeUndefined();
    await scope.budgets.clear(); // idempotent
  });

  it("rejects a non-positive budget at the DB check", async () => {
    await expect(scope.budgets.set({ monthlyLimitCents: 0 })).rejects.toThrow();
    await scope.budgets.clear();
  });

  it("rejects an over-max budget with a 400 before the DB write (int4 guard)", async () => {
    // The frozen budgetSet schema only bounds monthlyLimitCents as a positive
    // int, but the column is int4 — a value above int4 max would throw
    // "integer out of range" at INSERT (an ungraceful 500). setBudget rejects
    // it as a clean ApiError(400) at the handler layer, contract untouched.
    await expect(
      setBudget(scope, { monthlyLimitCents: 3_000_000_000 }),
    ).rejects.toMatchObject({ status: 400 });
    // The over-max value never reached the DB.
    expect(await scope.budgets.get()).toBeUndefined();
    // A value at the ceiling is accepted.
    const ok = await setBudget(scope, { monthlyLimitCents: MAX_BUDGET_CENTS });
    expect(ok.budget.monthlyLimitCents).toBe(MAX_BUDGET_CENTS);
    await scope.budgets.clear();
  });

  it("readSpendGovernance sums MTD spend excluding prior months, and labels the mix", async () => {
    await scope.budgets.set({ monthlyLimitCents: 10_000 });
    const view = await readSpendGovernance(scope, "2026-07-15");

    // June's 100_000 is excluded; only July counts. Reported and derived stay
    // separate (never a blended field).
    expect(view.reportedCents).toBe(6_000);
    expect(view.estimatedCents).toBe(5_500);
    // The threshold measures VENDOR-REPORTED spend only: 6_000 / 10_000 = 60% →
    // crosses 50, NOT over budget. A blend (11_500 = 115%) would falsely read
    // "over budget" by double-counting the overlapping estimate (invariant b).
    expect(view.alert?.crossedThreshold).toBe(50);
    expect(view.alert?.overBudget).toBe(false);

    // Drill-down: one tool, reported + derived separate.
    expect(view.byTool).toHaveLength(1);
    expect(view.byTool[0].reportedCents).toBe(6_000);
    expect(view.byTool[0].estimatedCents).toBe(5_500);
    expect(view.byTool[0].vendorLabel).toBe("Cursor");

    // Model mix by token volume (haiku 3000 > opus 1000).
    expect(view.byModel.map((m) => m.model)).toEqual([
      "claude-haiku-4-5",
      "claude-opus-4",
    ]);
    await scope.budgets.clear();
  });

  it("readBudgetAlert measures vendor-reported spend only, never the blend", async () => {
    // No budget set.
    expect(await readBudgetAlert(scope, "2026-07-15")).toBeNull();

    // Budget high enough that 6_000 reported is under 50% — and a blend with the
    // 5_500 estimate (11_500 = 115%) must NOT trip it.
    await scope.budgets.set({ monthlyLimitCents: 20_000 });
    expect(await readBudgetAlert(scope, "2026-07-15")).toBeNull();

    // Tight budget → alert fires on the vendor-reported MTD spend (6_000).
    await scope.budgets.set({ monthlyLimitCents: 10_000 });
    const summary = await readBudgetAlert(scope, "2026-07-15");
    expect(summary?.reportedCents).toBe(6_000);
    expect(summary?.alert.crossedThreshold).toBe(50);
    expect(summary?.alert.overBudget).toBe(false);
    await scope.budgets.clear();
  });

  it("readBudgetAlertForRole skips the read for members — personal orgs included", async () => {
    // A budget + spend that WOULD alert for an admin (6_000 / 10_000 = 60%).
    await scope.budgets.set({ monthlyLimitCents: 10_000 });
    expect(
      (await readBudgetAlertForRole(scope, "admin", "2026-07-15"))?.alert
        .crossedThreshold,
    ).toBe(50);
    // A member never sees it: the gate returns null (read skipped) even though
    // an alert exists. A personal-kind org can have an invited member — the
    // org-of-one machinery is identical to Team — so both dashboard views
    // (TeamOverview AND PersonalSelfView) go through this one gate.
    expect(await readBudgetAlertForRole(scope, "member", "2026-07-15")).toBeNull();

    // Same for a personal-kind org explicitly.
    const personal = await createFixtureOrg(db, "w4v-personal", "personal");
    const pScope = forOrg(db, personal.id);
    await pScope.budgets.set({ monthlyLimitCents: 1_000 });
    expect(await readBudgetAlertForRole(pScope, "member", "2026-07-15")).toBeNull();

    await scope.budgets.clear();
  });
});

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
