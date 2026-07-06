import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { buildReconcileView } from "../src/lib/reconcile";

// View-model assembly over the repo layer (PGlite). The shared-account
// fixture has 3 resolved person-subjects + 5 unresolved shared accounts, five
// of which the heuristics flag — exercising both the resolved/unresolved split
// and flag attachment.

const fixture = JSON.parse(
  readFileSync("fixtures/metric-records/shared-account-patterns.json", "utf8"),
);

let db: Db;
let orgId: string;
let ids: Awaited<ReturnType<typeof loadFixture>>;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2k-reconcile", "team")).id;
  ids = await loadFixture(db, orgId, fixture);
});

describe("buildReconcileView", () => {
  it("splits resolved vs unresolved and attaches shared-account flags", async () => {
    const view = await buildReconcileView(forOrg(db, orgId), {
      from: "2026-05-01",
      to: "2026-07-01",
    });

    const keyFor = (subjectId: string) =>
      Object.entries(ids.subjects).find(([, id]) => id === subjectId)?.[0];

    expect(new Set(view.unresolved.map((s) => keyFor(s.subjectId)))).toEqual(
      new Set([
        "shared-roundclock",
        "shared-concurrent",
        "shared-volume",
        "shared-copilot",
        "shared-power",
      ]),
    );
    expect(new Set(view.resolved.map((s) => keyFor(s.subjectId)))).toEqual(
      new Set(["alice-key", "bob-key", "carol-key"]),
    );

    // Every unresolved subject has no persons (surfaced, never fabricated).
    expect(view.unresolved.every((s) => s.persons.length === 0)).toBe(true);

    // All five shared accounts carry a flag; the resolved people do not.
    expect(view.flaggedCount).toBe(5);
    expect(view.unresolved.every((s) => s.flag !== null)).toBe(true);
    expect(view.resolved.every((s) => s.flag === null)).toBe(true);

    const byKey = new Map(
      [...view.unresolved, ...view.resolved].map((s) => [keyFor(s.subjectId), s]),
    );
    expect(byKey.get("shared-power")?.flag?.confidence).toBe("high");
    expect(byKey.get("shared-copilot")?.flag?.reasons).toEqual([
      "volume_exceeds_team_median",
    ]);
    expect(byKey.get("shared-power")?.vendor).toBe("Anthropic Console");
  });

  it("maps resolved subjects to their person and reflects a manual unlink", async () => {
    const scoped = forOrg(db, orgId);
    const before = await buildReconcileView(scoped, {
      from: "2026-05-01",
      to: "2026-07-01",
    });
    const alice = before.resolved.find(
      (s) => s.subjectId === ids.subjects["alice-key"],
    );
    expect(alice?.persons.map((p) => p.id)).toEqual([ids.people["alice"]]);

    // Unlink → the subject moves to the reconciliation work-list.
    await scoped.identities.unlink(ids.subjects["alice-key"], ids.people["alice"]);
    const after = await buildReconcileView(scoped, {
      from: "2026-05-01",
      to: "2026-07-01",
    });
    expect(
      after.unresolved.some((s) => s.subjectId === ids.subjects["alice-key"]),
    ).toBe(true);
    expect(
      after.resolved.some((s) => s.subjectId === ids.subjects["alice-key"]),
    ).toBe(false);
  });
});
