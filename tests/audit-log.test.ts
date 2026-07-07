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
import { applyReconcileAction } from "../src/lib/reconcile-actions";

// Basic audit log (ADR 0010): repo semantics + the write-through from the
// reconcile actions (the wiring closest to the repo layer — route wiring is
// HTTP glue over the same scope.auditLog.record call). Org isolation of
// audit_log itself is asserted by the tenant-isolation sweep.

const fixture = JSON.parse(
  readFileSync("fixtures/metric-records/shared-account-patterns.json", "utf8"),
);

let db: Db;
let orgId: string;
let ids: Awaited<ReturnType<typeof loadFixture>>;
let actor: { id: string };

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "w3o-audit", "team")).id;
  ids = await loadFixture(db, orgId, fixture);
  [actor] = await db
    .insert(schema.user)
    .values({ id: "audit-actor", name: "Audit Actor", email: "a@example.com" })
    .returning();
});

describe("auditLog repo", () => {
  it("record + list: newest-first with the recorded fields", async () => {
    const scope = forOrg(db, orgId);
    await scope.auditLog.record({
      actorUserId: actor.id,
      action: "team.create",
      targetKind: "team",
      targetId: "t-1",
      metadata: { name: "Core" },
    });
    await scope.auditLog.record({
      actorUserId: null, // actor account already deleted
      action: "invite.revoke",
      targetKind: "invite",
    });

    const entries = await scope.auditLog.list();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Newest-first: the revoke landed after the create.
    const [newest] = entries;
    expect(newest.action).toBe("invite.revoke");
    expect(newest.actorUserId).toBeNull();
    expect(newest.targetId).toBeNull();
    const create = entries.find((e) => e.action === "team.create");
    expect(create?.actorUserId).toBe(actor.id);
    expect(create?.targetId).toBe("t-1");
    expect(create?.metadata).toEqual({ name: "Core" });
  });

  it("list clamps limit into [1, 200]", async () => {
    const scope = forOrg(db, orgId);
    expect(await scope.auditLog.list({ limit: 1 })).toHaveLength(1);
    // Never a full dump on limit=0.
    expect(await scope.auditLog.list({ limit: 0 })).toHaveLength(1);
  });

  it("compound cursor pages exhaustively without repeats, even on timestamp ties", async () => {
    const scope = forOrg(db, orgId);
    // Batch-style writes: PGlite (like PG in one tx) can stamp identical
    // created_at values — the case where a naive created_at-only cursor
    // either loops (inclusive) or drops rows (exclusive).
    for (let i = 0; i < 5; i++) {
      await scope.auditLog.record({
        actorUserId: actor.id,
        action: "team.set_members",
        targetKind: "team",
        targetId: `page-${i}`,
      });
    }
    const all = await scope.auditLog.list({ limit: 200 });

    // Walk pages of 2 using the previous page's LAST row as the cursor.
    const seen: string[] = [];
    let cursor: { before?: Date; beforeId?: string } = {};
    for (let hops = 0; hops < 20; hops++) {
      const page = await scope.auditLog.list({ limit: 2, ...cursor });
      if (page.length === 0) break;
      seen.push(...page.map((e) => e.id));
      const last = page[page.length - 1];
      cursor = { before: last.createdAt, beforeId: last.id };
    }
    // Exhaustive: every row exactly once — no repeated boundary rows
    // (inclusive-cursor loop) and no skipped ties (naive exclusive cursor).
    expect(seen).toEqual(all.map((e) => e.id));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("reconcile actions write the audit trail", () => {
  it("unlink (a hard delete) leaves a who-did-it row", async () => {
    const scope = forOrg(db, orgId);
    // alice-key is fixture-resolved to a person; unlink then re-link it.
    const [identity] = await scope.identities.forSubject(
      ids.subjects["alice-key"],
    );
    expect(identity).toBeDefined();

    await applyReconcileAction(scope, actor.id, {
      action: "unlink",
      subjectId: ids.subjects["alice-key"],
      personId: identity.personId,
    });

    const [entry] = await scope.auditLog.list({ limit: 1 });
    expect(entry.action).toBe("identity.unlink");
    expect(entry.actorUserId).toBe(actor.id);
    expect(entry.targetId).toBe(ids.subjects["alice-key"]);
    expect(entry.metadata).toEqual({ personId: identity.personId });

    // Restore the mapping (link also audits).
    await applyReconcileAction(scope, actor.id, {
      action: "link",
      subjectId: ids.subjects["alice-key"],
      personId: identity.personId,
    });
    const [relink] = await scope.auditLog.list({ limit: 1 });
    expect(relink.action).toBe("identity.link");
  });

  it("create_and_link records the created person id", async () => {
    const scope = forOrg(db, orgId);
    const result = await applyReconcileAction(scope, actor.id, {
      action: "create_and_link",
      subjectId: ids.subjects["shared-volume"],
      displayName: "New Person",
    });
    const [entry] = await scope.auditLog.list({ limit: 1 });
    expect(entry.action).toBe("identity.create_and_link");
    expect(entry.metadata).toEqual({ personId: result.personId });
  });

  it("a failed action never leaves a phantom audit row", async () => {
    const scope = forOrg(db, orgId);
    const before = (await scope.auditLog.list()).length;
    await expect(
      applyReconcileAction(scope, actor.id, {
        action: "link",
        subjectId: "00000000-0000-0000-0000-000000000000", // not in org
        personId: ids.people.alice,
      }),
    ).rejects.toThrow(ApiError);
    expect((await scope.auditLog.list()).length).toBe(before);
  });
});
