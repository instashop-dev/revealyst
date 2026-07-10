import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { readDashboardView } from "../src/lib/dashboard-view";
import { collectGaps } from "../src/lib/honesty-gaps";

// W4-W finding A5: the team dashboard must surface the SAME connector honesty
// gaps the personal self-view already does. Previously `readDashboardView`
// never read connector_runs and the team page hardcoded `gaps: []`, so a team
// admin was shown coverage with no honesty caveat. This asserts the gaps now
// thread through the composed team view.

const WINDOW = { from: "2026-01-01", to: "2026-01-31" };

let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("collectGaps", () => {
  it("dedupes on kind+detail and drops malformed entries", () => {
    const gaps = collectGaps([
      { gaps: [{ kind: "shared_key_not_person_level" }] },
      { gaps: [{ kind: "shared_key_not_person_level" }] }, // dup
      { gaps: [{ kind: "service_accounts_unresolved", detail: "3 seen" }] },
      { gaps: [{ kind: "service_accounts_unresolved", detail: "3 seen" }] }, // dup
      { gaps: [{ kind: "service_accounts_unresolved", detail: "5 seen" }] }, // distinct detail
      { gaps: "not-an-array" },
      { gaps: [null, 42, { noKind: true }] }, // all malformed
    ]);
    expect(gaps).toContainEqual({ kind: "shared_key_not_person_level" });
    expect(gaps).toContainEqual({
      kind: "service_accounts_unresolved",
      detail: "3 seen",
    });
    expect(gaps).toContainEqual({
      kind: "service_accounts_unresolved",
      detail: "5 seen",
    });
    // 1 keyless + 2 distinct-detail = 3 total, malformed contributed nothing.
    expect(gaps).toHaveLength(3);
  });
});

describe("readDashboardView threads connector honesty gaps (A5)", () => {
  it("surfaces gaps recorded on connector_runs", async () => {
    const orgId = (await createFixtureOrg(db, "w4w-gaps-team", "team")).id;
    const scope = forOrg(db, orgId);
    const connection = await scope.connections.create({
      vendor: "openai",
      displayName: "OpenAI",
      authKind: "admin_key",
    });
    const run = await scope.connectorRuns.start({
      connectionId: connection.id,
      kind: "poll",
    });
    await scope.connectorRuns.finish(run.id, {
      subjectsSeen: 2,
      recordsUpserted: 5,
      signalsUpserted: 0,
      gaps: [{ kind: "shared_key_not_person_level", detail: "shared key" }],
    });

    const view = await readDashboardView(scope, "private", WINDOW);
    expect(view.gaps).toContainEqual({
      kind: "shared_key_not_person_level",
      detail: "shared key",
    });
  });

  it("an org with no runs has an empty gaps surface (never fabricated)", async () => {
    const orgId = (await createFixtureOrg(db, "w4w-gaps-empty", "team")).id;
    const scope = forOrg(db, orgId);
    const view = await readDashboardView(scope, "private", WINDOW);
    expect(view.gaps).toEqual([]);
  });

  it("gaps are org-scoped — one team's gap never bleeds into another's view", async () => {
    const orgA = (await createFixtureOrg(db, "w4w-gaps-iso-a", "team")).id;
    const orgB = (await createFixtureOrg(db, "w4w-gaps-iso-b", "team")).id;
    const scopeA = forOrg(db, orgA);
    const connA = await scopeA.connections.create({
      vendor: "cursor",
      displayName: "Cursor",
      authKind: "api_key",
    });
    const runA = await scopeA.connectorRuns.start({
      connectionId: connA.id,
      kind: "poll",
    });
    await scopeA.connectorRuns.finish(runA.id, {
      subjectsSeen: 1,
      recordsUpserted: 1,
      signalsUpserted: 0,
      gaps: [{ kind: "service_accounts_unresolved" }],
    });

    const viewB = await readDashboardView(forOrg(db, orgB), "private", WINDOW);
    expect(viewB.gaps).toEqual([]);
  });
});
