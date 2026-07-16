import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ApiError } from "../src/lib/api-impl";
import {
  buildReconcileView,
  deriveReconcileImpact,
} from "../src/lib/reconcile";
import { applyReconcileAction } from "../src/lib/reconcile-actions";

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

    // Flags are resolution-independent metadata. In this fixture the flagged
    // subjects all happen to be unresolved, but a resolved shared account
    // could legitimately carry a flag too — so assert the flagged SET, never
    // "resolved ⇒ unflagged" (which would be fixture luck, not an invariant).
    expect(view.flaggedCount).toBe(5);
    expect(view.unresolved.every((s) => s.flag !== null)).toBe(true);
    expect(
      new Set(
        [...view.unresolved, ...view.resolved]
          .filter((s) => s.flag)
          .map((s) => keyFor(s.subjectId)),
      ),
    ).toEqual(
      new Set([
        "shared-roundclock",
        "shared-concurrent",
        "shared-volume",
        "shared-copilot",
        "shared-power",
      ]),
    );

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

describe("buildReconcileView — activity signal", () => {
  it("flags unresolved subjects with active_day rows and surfaces them first", async () => {
    // Mirrors the real Anthropic Console topology that motivated this: a
    // person-kind subject with no data next to an api_key-kind sibling that
    // carries the actual usage. Reconciling only the recognizably-named one
    // must not silently leave the data-bearing subject unresolved.
    const org = await createFixtureOrg(db, "w2k-activity", "team");
    const local = await loadFixture(db, org.id, {
      connections: [
        {
          key: "anthropic",
          vendor: "anthropic_console",
          displayName: "Anthropic",
          authKind: "admin_key",
        },
      ],
      people: [],
      teams: [],
      subjects: [
        {
          key: "empty-stub",
          connection: "anthropic",
          kind: "person",
          externalId: "acct:empty",
          displayName: "Empty Person",
        },
        { key: "real-data", connection: "anthropic", kind: "api_key", externalId: "apikey_1" },
      ],
      identities: [],
      records: [
        {
          subject: "real-data",
          metricKey: "active_day",
          day: "2026-06-01",
          value: 1,
          attribution: "key_project",
          sourceConnector: "fixture@1",
        },
      ],
      signals: [],
    });
    const scoped = forOrg(db, org.id);
    const view = await buildReconcileView(scoped, {
      from: "2026-05-01",
      to: "2026-07-01",
    });

    const emptyEntry = view.unresolved.find(
      (s) => s.subjectId === local.subjects["empty-stub"],
    );
    const dataEntry = view.unresolved.find(
      (s) => s.subjectId === local.subjects["real-data"],
    );
    expect(emptyEntry?.hasActivity).toBe(false);
    expect(dataEntry?.hasActivity).toBe(true);
    expect(view.unresolved[0].subjectId).toBe(local.subjects["real-data"]);
  });
});

describe("deriveReconcileImpact — counts only (invariant b)", () => {
  it("counts unresolved subjects WITH activity, plus tracked people", () => {
    const impact = deriveReconcileImpact({
      unresolved: [
        { hasActivity: true },
        { hasActivity: true },
        { hasActivity: false }, // empty stub — not counted
      ] as never,
      people: [{ id: "a" }, { id: "b" }] as never,
    });
    expect(impact).toEqual({ accountsWithData: 2, trackedPeople: 2 });
  });

  it("is zero accounts when nothing unresolved carries data", () => {
    const impact = deriveReconcileImpact({
      unresolved: [{ hasActivity: false }] as never,
      people: [] as never,
    });
    expect(impact).toEqual({ accountsWithData: 0, trackedPeople: 0 });
  });
});

describe("buildReconcileView — email-match proposals", () => {
  it("proposes a link only for a person-kind subject whose email uniquely matches a person", async () => {
    const org = await createFixtureOrg(db, "w2k-proposals", "team");
    const local = await loadFixture(db, org.id, {
      connections: [
        {
          key: "cursor",
          vendor: "cursor",
          displayName: "Cursor",
          authKind: "admin_key",
        },
      ],
      people: [
        { key: "jordan", pseudonym: "Owl-1", email: "jordan@acme.com" },
      ],
      teams: [],
      subjects: [
        {
          key: "jordan-acct",
          connection: "cursor",
          kind: "person",
          externalId: "u_jordan",
          email: "jordan@acme.com",
        },
        // A service-account subject is never auto-proposed, even with an email.
        {
          key: "svc",
          connection: "cursor",
          kind: "service_account",
          externalId: "svc_1",
          email: "jordan@acme.com",
        },
      ],
      identities: [],
      records: [],
      signals: [],
    });
    const view = await buildReconcileView(forOrg(db, org.id), {
      from: "2026-05-01",
      to: "2026-07-01",
    });

    expect(view.proposedMatches).toEqual([
      {
        subjectId: local.subjects["jordan-acct"],
        personId: local.people["jordan"],
        method: "email_match",
      },
    ]);
  });
});

describe("applyReconcileAction", () => {
  it("links an unresolved subject to an existing person (method manual)", async () => {
    const scope = forOrg(db, orgId);
    const subjectId = ids.subjects["shared-concurrent"];
    const result = await applyReconcileAction(scope, null, {
      action: "link",
      subjectId,
      personId: ids.people["bob"],
    });
    expect(result).toEqual({ ok: true });
    const rows = await scope.identities.forSubject(subjectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe(ids.people["bob"]);
    expect(rows[0].method).toBe("manual");
  });

  it("creates a person and links it (the only sanctioned person-creation path)", async () => {
    const scope = forOrg(db, orgId);
    const subjectId = ids.subjects["shared-volume"];
    const before = (await scope.people.list()).length;
    const result = await applyReconcileAction(scope, null, {
      action: "create_and_link",
      subjectId,
      displayName: "Jordan Rivera",
    });
    expect(result.ok).toBe(true);
    expect(result.personId).toBeDefined();
    expect((await scope.people.list()).length).toBe(before + 1);
    const rows = await scope.identities.forSubject(subjectId);
    expect(rows[0]?.personId).toBe(result.personId);
    expect(rows[0]?.method).toBe("manual");
  });

  it("assigns a person to a team", async () => {
    const scope = forOrg(db, orgId);
    await applyReconcileAction(scope, null, {
      action: "assign_team",
      personId: ids.people["carol"],
      teamId: ids.teams["core"],
    });
    const members = await scope.teams.members(ids.teams["core"]);
    expect(members.some((m) => m.personId === ids.people["carol"])).toBe(true);
  });

  it("unlinks an identity", async () => {
    const scope = forOrg(db, orgId);
    const subjectId = ids.subjects["shared-concurrent"];
    await applyReconcileAction(scope, null, {
      action: "unlink",
      subjectId,
      personId: ids.people["bob"],
    });
    expect(await scope.identities.forSubject(subjectId)).toHaveLength(0);
  });

  it("rejects a subject that isn't in the org with a 404 (never writes)", async () => {
    const scope = forOrg(db, orgId);
    await expect(
      applyReconcileAction(scope, null, {
        action: "link",
        subjectId: "00000000-0000-0000-0000-000000000000",
        personId: ids.people["bob"],
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
