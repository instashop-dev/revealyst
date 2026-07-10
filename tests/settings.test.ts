import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { updateOrgSettings } from "../src/lib/api-impl";
import {
  loosensPrivacy,
  VISIBILITY_MODE_INFO,
  VISIBILITY_MODES,
} from "../src/lib/visibility-playbook";
import type { VisibilityMode } from "../src/lib/visibility";

// W4-W settings surface (ADR 0018): the org-scoped `org.update` writer, the
// audited `updateOrgSettings` mutation (visibility mode is the single most
// privacy-sensitive change), and the playbook-at-the-toggle trigger logic.

let db: Db;
let actorId: string;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  [{ id: actorId }] = await db
    .insert(schema.user)
    .values({ id: "w4w-actor", name: "Admin", email: "admin@example.com" })
    .returning();
});

async function freshOrg(name: string) {
  return (await createFixtureOrg(db, name, "team")).id;
}

async function readOrg(orgId: string) {
  const [row] = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return row;
}

describe("org-scope org.update writer", () => {
  it("defaults to private and writes a new visibility mode", async () => {
    const orgId = await freshOrg("w4w-visibility");
    const scope = forOrg(db, orgId);
    // The schema default — V1 never wrote it.
    expect((await readOrg(orgId)).visibilityMode).toBe("private");

    const row = await scope.org.update({ visibilityMode: "managed" });
    expect(row?.visibilityMode).toBe("managed");
    expect((await readOrg(orgId)).visibilityMode).toBe("managed");
  });

  it("renames and returns id/name/kind/visibilityMode", async () => {
    const orgId = await freshOrg("w4w-rename");
    const scope = forOrg(db, orgId);
    const row = await scope.org.update({ name: "Renamed Co" });
    expect(row).toMatchObject({
      id: orgId,
      name: "Renamed Co",
      kind: "team",
      visibilityMode: "private",
    });
  });

  it("only touches its own org — never a sibling", async () => {
    const a = await freshOrg("w4w-iso-a");
    const b = await freshOrg("w4w-iso-b");
    await forOrg(db, a).org.update({ visibilityMode: "full", name: "A New" });
    // B is untouched by A's scoped writer.
    const bRow = await readOrg(b);
    expect(bRow.visibilityMode).toBe("private");
    expect(bRow.name).toBe("w4w-iso-b");
  });
});

describe("updateOrgSettings — audited mutation", () => {
  it("writes an org.visibility_set audit entry with from→to", async () => {
    const orgId = await freshOrg("w4w-audit-vis");
    const scope = forOrg(db, orgId);
    const res = await updateOrgSettings(scope, {
      actorUserId: actorId,
      current: { id: orgId, name: "w4w-audit-vis", visibilityMode: "private" },
      patch: { visibilityMode: "full" },
    });
    // Response parses through the frozen settingsUpdate schema.
    expect(res.org).toMatchObject({ id: orgId, visibilityMode: "full" });

    const [entry] = await scope.auditLog.list({ limit: 1 });
    expect(entry.action).toBe("org.visibility_set");
    expect(entry.actorUserId).toBe(actorId);
    expect(entry.targetKind).toBe("org");
    expect(entry.targetId).toBe(orgId);
    expect(entry.metadata).toEqual({ from: "private", to: "full" });
  });

  it("writes an org.rename audit entry", async () => {
    const orgId = await freshOrg("w4w-audit-name");
    const scope = forOrg(db, orgId);
    await updateOrgSettings(scope, {
      actorUserId: actorId,
      current: { id: orgId, name: "w4w-audit-name", visibilityMode: "private" },
      patch: { name: "Acme" },
    });
    const [entry] = await scope.auditLog.list({ limit: 1 });
    expect(entry.action).toBe("org.rename");
    expect(entry.metadata).toEqual({ from: "w4w-audit-name", to: "Acme" });
  });

  it("changing both fields writes two audit entries", async () => {
    const orgId = await freshOrg("w4w-audit-both");
    const scope = forOrg(db, orgId);
    await updateOrgSettings(scope, {
      actorUserId: actorId,
      current: { id: orgId, name: "w4w-audit-both", visibilityMode: "private" },
      patch: { name: "Both Co", visibilityMode: "managed" },
    });
    const actions = (await scope.auditLog.list({ limit: 10 })).map(
      (e) => e.action,
    );
    expect(actions).toContain("org.rename");
    expect(actions).toContain("org.visibility_set");
  });

  it("a no-op (value unchanged) writes NO audit entry — never fabricates a trail", async () => {
    const orgId = await freshOrg("w4w-noop");
    const scope = forOrg(db, orgId);
    const before = (await scope.auditLog.list({ limit: 200 })).length;
    // Patch re-sets the CURRENT values: a legal non-empty patch, but nothing
    // actually changes.
    await updateOrgSettings(scope, {
      actorUserId: actorId,
      current: { id: orgId, name: "w4w-noop", visibilityMode: "private" },
      patch: { name: "w4w-noop", visibilityMode: "private" },
    });
    expect((await scope.auditLog.list({ limit: 200 })).length).toBe(before);
  });
});

describe("settingsUpdate request contract", () => {
  it("rejects an empty patch (a no-op would fabricate audit entries)", () => {
    expect(apiRoutes.settingsUpdate.request.safeParse({}).success).toBe(false);
  });

  it("trims the name and rejects whitespace-only names", () => {
    // Whitespace-only would otherwise blank the workspace name everywhere.
    expect(
      apiRoutes.settingsUpdate.request.safeParse({ name: "   " }).success,
    ).toBe(false);
    const parsed = apiRoutes.settingsUpdate.request.parse({ name: "  Acme  " });
    expect(parsed.name).toBe("Acme");
  });

  it("rejects an unknown visibility mode", () => {
    expect(
      apiRoutes.settingsUpdate.request.safeParse({ visibilityMode: "public" })
        .success,
    ).toBe(false);
  });
});

describe("visibility-readiness playbook trigger (loosensPrivacy)", () => {
  it("switching AWAY from team-only needs the readiness confirmation", () => {
    expect(loosensPrivacy("private", "managed")).toBe(true);
    expect(loosensPrivacy("private", "full")).toBe(true);
  });

  it("tightening back to private never asks", () => {
    expect(loosensPrivacy("managed", "private")).toBe(false);
    expect(loosensPrivacy("full", "private")).toBe(false);
  });

  it("moving between two name-revealing modes does not re-trigger", () => {
    expect(loosensPrivacy("managed", "full")).toBe(false);
    expect(loosensPrivacy("full", "managed")).toBe(false);
  });

  it("only private is EU-safe / hides names; managed and full reveal them", () => {
    expect(VISIBILITY_MODE_INFO.private.euSafe).toBe(true);
    expect(VISIBILITY_MODE_INFO.private.revealsNames).toBe(false);
    for (const mode of VISIBILITY_MODES) {
      if (mode === "private") continue;
      expect(VISIBILITY_MODE_INFO[mode as VisibilityMode].revealsNames).toBe(
        true,
      );
    }
  });
});
