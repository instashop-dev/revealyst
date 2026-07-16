import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { purgeExpiredRawPayloads } from "../src/db/system";
import { processPollMessage } from "../src/poller/process";

// W0-C facts layer: catalog seed, the frozen metric_records upsert key,
// sub-daily signal shape (incl. the Copilot NULL-histogram honesty case),
// and raw-landing-zone aging. Real migrations against PGlite (rule 2).

const CANONICAL_KEYS = [
  "active_day",
  "sessions",
  "prompts",
  "tokens_input",
  "tokens_output",
  "tokens_cache_read",
  "tokens_cache_write",
  "spend_cents",
  "spend_cents_estimated",
  "model_requests",
  "model_tokens",
  "suggestions_offered",
  "suggestions_accepted",
  "edit_actions_accepted",
  "edit_actions_rejected",
  "retries",
  "feature_used",
  "commits",
  "pull_requests",
  "lines_added",
  "lines_removed",
  "lines_suggested",
  // V1.5 agentic + credits additions (ADR 0022 / migration 0022).
  "agent_sessions",
  "agent_requests",
  "agent_active",
  "ai_credits",
  // W7-8 (ADR 0039): OTel proficiency markers — additive, receiver-only keys.
  "otel_active_time",
  "otel_edit_accepted",
  "otel_edit_rejected",
  // TEL-012 (ADR 0042): context-window usage — tokens carried in the model's
  // context per request. Additive; no emitter yet (Anthropic context_window
  // harvest is fixture-gated), so no rows are written today.
  "context_tokens",
];

let db: Db;
let orgA: string;
let orgB: string;
let connA: string;
let subjA: string;
let subjB: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db
    .insert(schema.orgs)
    .values({ name: "facts-org-a", kind: "team" })
    .returning();
  const [b] = await db
    .insert(schema.orgs)
    .values({ name: "facts-org-b", kind: "team" })
    .returning();
  orgA = a.id;
  orgB = b.id;

  connA = (
    await forOrg(db, orgA).connections.create({
      vendor: "anthropic_console",
      displayName: "Anthropic",
      authKind: "admin_key",
    })
  ).id;
  const connB = (
    await forOrg(db, orgB).connections.create({
      vendor: "cursor",
      displayName: "Cursor",
      authKind: "api_key",
    })
  ).id;
  subjA = (
    await forOrg(db, orgA).subjects.upsertMany(connA, [
      { kind: "person", externalId: "alice@a.example" },
    ])
  )[0].id;
  subjB = (
    await forOrg(db, orgB).subjects.upsertMany(connB, [
      { kind: "person", externalId: "bob@b.example" },
    ])
  )[0].id;
});

describe("metric catalog seed", () => {
  it("contains exactly the canonical V1 keys", async () => {
    const rows = await db.select().from(schema.metricCatalog);
    expect(rows.map((r) => r.key).sort()).toEqual([...CANONICAL_KEYS].sort());
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it("seed is idempotent (ON CONFLICT DO NOTHING replays cleanly)", async () => {
    await db.execute(
      sql`INSERT INTO metric_catalog ("key", "family", "name", "description", "unit") VALUES ('active_day', 'active_users', 'dup', 'dup', 'flag') ON CONFLICT ("key") DO NOTHING`,
    );
    const [row] = await db
      .select()
      .from(schema.metricCatalog)
      .where(eq(schema.metricCatalog.key, "active_day"));
    expect(row.name).toBe("Active day"); // original row untouched
  });

  it("dimensioned metrics declare their dim kind", async () => {
    const [model] = await db
      .select()
      .from(schema.metricCatalog)
      .where(eq(schema.metricCatalog.key, "model_requests"));
    expect(model.dimKind).toBe("model");
    const [feature] = await db
      .select()
      .from(schema.metricCatalog)
      .where(eq(schema.metricCatalog.key, "feature_used"));
    expect(feature.dimKind).toBe("feature");
  });
});

describe("metric_records (the frozen upsert key)", () => {
  it("restatement: same natural key twice is one row with the new value", async () => {
    const scoped = forOrg(db, orgA);
    const base = {
      subjectId: subjA,
      metricKey: "tokens_input",
      day: "2026-07-01",
      connectionId: connA,
      attribution: "person" as const,
      sourceConnector: "anthropic-console@1",
    };
    await scoped.metrics.upsertRecords([{ ...base, value: 1000 }]);
    await scoped.metrics.upsertRecords([{ ...base, value: 1250 }]); // vendor restated

    const rows = await scoped.metrics.records({
      metricKey: "tokens_input",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(1250);
    expect(rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(
      rows[0].insertedAt.getTime(),
    );
  });

  it("dim separates model-mix rows under one metric key", async () => {
    const scoped = forOrg(db, orgA);
    const base = {
      subjectId: subjA,
      metricKey: "model_requests",
      day: "2026-07-01",
      connectionId: connA,
      attribution: "person" as const,
      sourceConnector: "anthropic-console@1",
    };
    await scoped.metrics.upsertRecords([
      { ...base, dim: "model=claude-opus-4", value: 40 },
      { ...base, dim: "model=claude-haiku-4-5", value: 250 },
    ]);
    const rows = await scoped.metrics.records({
      metricKey: "model_requests",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    expect(rows).toHaveLength(2);
  });

  it("rejects metric keys missing from the catalog (FK)", async () => {
    await expect(
      forOrg(db, orgA).metrics.upsertRecords([
        {
          subjectId: subjA,
          metricKey: "made_up_metric",
          day: "2026-07-01",
          connectionId: connA,
          value: 1,
          attribution: "person",
          sourceConnector: "test@1",
        },
      ]),
    ).rejects.toThrow();
  });

  it("rejects cross-org subject/connection combinations (composite FKs)", async () => {
    // Org A's scope naming org B's subject: no (org_a, subj_b) anchor.
    await expect(
      forOrg(db, orgA).metrics.upsertRecords([
        {
          subjectId: subjB,
          metricKey: "active_day",
          day: "2026-07-01",
          connectionId: connA,
          value: 1,
          attribution: "person",
          sourceConnector: "test@1",
        },
      ]),
    ).rejects.toThrow();
  });
});

describe("subject_day_signals (sub-daily contract)", () => {
  const HOURS_24 = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 17 ? 5 : 0));

  it("stores a 24-slot histogram and upserts idempotently", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.metrics.upsertSignals([
      {
        subjectId: subjA,
        day: "2026-07-01",
        hours: HOURS_24,
        peakConcurrency: 2,
        sourceGranularity: "1h",
      },
    ]);
    await scoped.metrics.upsertSignals([
      {
        subjectId: subjA,
        day: "2026-07-01",
        hours: HOURS_24,
        peakConcurrency: 3, // restated
        sourceGranularity: "1h",
      },
    ]);
    const rows = await scoped.metrics.signals({
      subjectId: subjA,
      from: "2026-07-01",
      to: "2026-07-01",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].peakConcurrency).toBe(3);
    expect(rows[0].hours).toHaveLength(24);
  });

  it("rejects histograms that are not exactly 24 slots (CHECK)", async () => {
    await expect(
      forOrg(db, orgA).metrics.upsertSignals([
        {
          subjectId: subjA,
          day: "2026-07-02",
          hours: HOURS_24.slice(0, 23),
          sourceGranularity: "1h",
        },
      ]),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgA).metrics.upsertSignals([
        {
          subjectId: subjA,
          day: "2026-07-02",
          hours: [...HOURS_24, 0],
          sourceGranularity: "1h",
        },
      ]),
    ).rejects.toThrow();
  });

  it("represents Copilot honestly: NULL histogram + granularity 'none'", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.metrics.upsertSignals([
      {
        subjectId: subjA,
        day: "2026-07-03",
        hours: null,
        sourceGranularity: "none",
      },
    ]);
    const rows = await scoped.metrics.signals({
      subjectId: subjA,
      from: "2026-07-03",
      to: "2026-07-03",
    });
    expect(rows[0].hours).toBeNull();
    expect(rows[0].peakConcurrency).toBeNull();
    expect(rows[0].sourceGranularity).toBe("none");
  });
});

describe("raw landing zone", () => {
  it("defaults expiry to ~90 days out", async () => {
    const row = await forOrg(db, orgA).raw.insert({
      connectionId: connA,
      vendor: "anthropic_console",
      kind: "usage_report.1h",
      payload: { buckets: [] },
    });
    const days =
      (row.expiresAt.getTime() - row.fetchedAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it("purge ages out expired rows and nulls metric_records references", async () => {
    const scoped = forOrg(db, orgA);
    const raw = await scoped.raw.insert({
      connectionId: connA,
      vendor: "anthropic_console",
      kind: "usage_report.1d",
      payload: { buckets: [1] },
    });
    await scoped.metrics.upsertRecords([
      {
        subjectId: subjA,
        metricKey: "spend_cents",
        day: "2026-06-30",
        connectionId: connA,
        value: 12345,
        attribution: "person",
        sourceConnector: "anthropic-console@1",
        rawPayloadId: raw.id,
      },
    ]);

    // Force-expire, then purge via the queue-message path.
    await db
      .update(schema.rawPayloads)
      .set({ expiresAt: new Date("2020-01-01") })
      .where(eq(schema.rawPayloads.id, raw.id));
    await processPollMessage(db, { kind: "purge-raw" });

    expect(await scoped.raw.get(raw.id)).toBeUndefined();
    const [record] = await scoped.metrics.records({
      metricKey: "spend_cents",
      from: "2026-06-30",
      to: "2026-06-30",
    });
    expect(record.value).toBe(12345); // fact survives aging
    expect(record.rawPayloadId).toBeNull(); // replay reference gone
  });

  it("purge is bounded and returns the deleted count", async () => {
    const scoped = forOrg(db, orgA);
    for (let i = 0; i < 3; i++) {
      const row = await scoped.raw.insert({
        connectionId: connA,
        vendor: "anthropic_console",
        kind: `expired.${i}`,
        payload: {},
      });
      await db
        .update(schema.rawPayloads)
        .set({ expiresAt: new Date("2020-01-01") })
        .where(eq(schema.rawPayloads.id, row.id));
    }
    expect(await purgeExpiredRawPayloads(db, { batchSize: 2 })).toBe(3);
    expect(await purgeExpiredRawPayloads(db)).toBe(0);
  });
});
