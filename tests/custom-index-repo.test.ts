import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  CustomIndexCapError,
  CustomIndexNotFoundError,
  MAX_ACTIVE_CUSTOM_DEFINITIONS,
} from "../src/lib/custom-index";

// Repository-layer guardrails (§8.5): immutable versioning, archive/unarchive
// via status flip (never delete), the active-definition cap (guardrail 4), and
// strict org-scoping.

const COMPONENTS = [
  {
    key: "depth",
    metric: "active_day",
    aggregation: "active_days",
    weight: 1,
    normalization: { min: 0, max: 20 },
  },
];

let db: Db;
let orgA: string;
let orgB: string;

beforeEach(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgA = (await createFixtureOrg(db, "ci-org-a", "team")).id;
  orgB = (await createFixtureOrg(db, "ci-org-b", "team")).id;
});

function publish(orgId: string, slug: string, name = slug) {
  return forOrg(db, orgId).scores.publishCustomDefinition({
    slug,
    name,
    subjectLevel: "org",
    components: COMPONENTS,
  });
}

describe("versioned publish", () => {
  it("mints version 1 active for a new slug", async () => {
    const row = await publish(orgA, "custom-velocity", "Velocity");
    expect(row.version).toBe(1);
    expect(row.status).toBe("active");
    expect(row.orgId).toBe(orgA);
  });

  it("supersedes the prior active version and keeps history", async () => {
    await publish(orgA, "custom-velocity");
    const v2 = await publish(orgA, "custom-velocity");
    expect(v2.version).toBe(2);
    const all = await forOrg(db, orgA).scores.customDefinitions();
    const velocity = all.filter((d) => d.slug === "custom-velocity");
    expect(velocity).toHaveLength(2); // v1 retained, not deleted
    expect(velocity.find((d) => d.version === 1)?.status).toBe("retired");
    expect(velocity.find((d) => d.version === 2)?.status).toBe("active");
  });

  it("refuses to publish a non-custom slug (preset-shadow guard)", async () => {
    await expect(publish(orgA, "adoption")).rejects.toThrow();
  });

  it("refuses a person-level publish at the repo layer (guardrail 1, runtime)", async () => {
    // A non-zod caller bypassing the API schema must still be rejected — the
    // TS type alone is erased at runtime, and a person-level custom row would
    // otherwise join the nightly recompute as a people-scoring surface.
    await expect(
      forOrg(db, orgA).scores.publishCustomDefinition({
        slug: "custom-sneaky-person",
        name: "Sneaky",
        subjectLevel: "person" as unknown as "team",
        components: COMPONENTS,
      }),
    ).rejects.toThrow(/team\/org only/i);
    // Nothing was written.
    expect(await forOrg(db, orgA).scores.customDefinitions()).toHaveLength(0);
  });
});

describe("archive / unarchive (never delete)", () => {
  it("archive retires the active version; rows persist", async () => {
    await publish(orgA, "custom-velocity");
    const archived = await forOrg(db, orgA).scores.archiveCustomDefinition(
      "custom-velocity",
    );
    expect(archived).toBe(true);
    const all = await forOrg(db, orgA).scores.customDefinitions();
    expect(all).toHaveLength(1); // still there
    expect(all[0].status).toBe("retired");
  });

  it("archive is an idempotent no-op when already archived", async () => {
    await publish(orgA, "custom-velocity");
    await forOrg(db, orgA).scores.archiveCustomDefinition("custom-velocity");
    const again = await forOrg(db, orgA).scores.archiveCustomDefinition(
      "custom-velocity",
    );
    expect(again).toBe(false);
  });

  it("unarchive reactivates the head version", async () => {
    await publish(orgA, "custom-velocity"); // v1
    await publish(orgA, "custom-velocity"); // v2 active, v1 retired
    await forOrg(db, orgA).scores.archiveCustomDefinition("custom-velocity");
    await forOrg(db, orgA).scores.unarchiveCustomDefinition("custom-velocity");
    const all = await forOrg(db, orgA).scores.customDefinitions();
    const active = all.filter((d) => d.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2); // the head, not v1
  });

  it("unarchive throws for an unknown slug", async () => {
    await expect(
      forOrg(db, orgA).scores.unarchiveCustomDefinition("custom-nope"),
    ).rejects.toBeInstanceOf(CustomIndexNotFoundError);
  });
});

describe("active-definition cap (guardrail 4)", () => {
  it(`allows ${MAX_ACTIVE_CUSTOM_DEFINITIONS} active slugs and rejects the next`, async () => {
    for (let i = 0; i < MAX_ACTIVE_CUSTOM_DEFINITIONS; i += 1) {
      await publish(orgA, `custom-idx-${i}`);
    }
    await expect(publish(orgA, "custom-one-too-many")).rejects.toBeInstanceOf(
      CustomIndexCapError,
    );
  });

  it("a new version of an existing active slug does not count against the cap", async () => {
    for (let i = 0; i < MAX_ACTIVE_CUSTOM_DEFINITIONS; i += 1) {
      await publish(orgA, `custom-idx-${i}`);
    }
    // At cap, but re-publishing an already-active slug is net-zero.
    const v2 = await publish(orgA, "custom-idx-0");
    expect(v2.version).toBe(2);
  });

  it("archiving frees a slot; unarchiving re-checks the cap", async () => {
    for (let i = 0; i < MAX_ACTIVE_CUSTOM_DEFINITIONS; i += 1) {
      await publish(orgA, `custom-idx-${i}`);
    }
    await forOrg(db, orgA).scores.archiveCustomDefinition("custom-idx-0");
    // Slot freed → a brand-new slug now fits.
    await expect(publish(orgA, "custom-new")).resolves.toBeDefined();
    // Now at cap again → unarchiving the old one must be rejected.
    await expect(
      forOrg(db, orgA).scores.unarchiveCustomDefinition("custom-idx-0"),
    ).rejects.toBeInstanceOf(CustomIndexCapError);
  });
});

describe("org scoping", () => {
  it("one org's customs are invisible to another", async () => {
    await publish(orgA, "custom-velocity");
    expect(await forOrg(db, orgB).scores.customDefinitions()).toHaveLength(0);
    // And org B's cap/list is independent.
    await publish(orgB, "custom-velocity");
    expect(await forOrg(db, orgB).scores.customDefinitions()).toHaveLength(1);
    expect(await forOrg(db, orgA).scores.customDefinitions()).toHaveLength(1);
  });
});
