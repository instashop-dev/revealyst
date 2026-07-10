import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  AUDIT_LOG_RETENTION_DAYS,
  CONNECTOR_RUNS_RETENTION_DAYS,
  POLL_HEARTBEATS_RETENTION_DAYS,
  purgeExpiredRetention,
} from "../src/db/system";

// Retention purge (W4-Q, ADR 0018): the actual delete SQL against a migrated
// DB, so a wrong column/window/kind-filter is caught (the pure batch loop
// can't). `now` is injected so windows are deterministic.

const NOW = new Date("2026-07-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

let db: Db;
let orgId: string;
let connectionId: string;

async function migratedDb(): Promise<Db> {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  return pglite as unknown as Db;
}

beforeEach(async () => {
  db = await migratedDb();
  orgId = (await createFixtureOrg(db, "retention-org", "team")).id;
  const conn = await forOrg(db, orgId).connections.create({
    vendor: "cursor",
    displayName: "Cursor",
    authKind: "admin_key",
  });
  connectionId = conn.id;
});

async function seedAudit(createdAt: Date) {
  await db.insert(schema.auditLog).values({
    orgId,
    action: "identity.link",
    targetKind: "identity",
    createdAt,
  });
}
async function seedHeartbeat(observedAt: Date) {
  await db.insert(schema.pollHeartbeats).values({ orgId, observedAt });
}
async function seedRun(kind: "poll" | "backfill", startedAt: Date) {
  await db
    .insert(schema.connectorRuns)
    .values({ orgId, connectionId, kind, status: "success", startedAt });
}

const countRows = async (table: typeof schema.auditLog | typeof schema.pollHeartbeats) =>
  (await db.select().from(table)).length;

describe("purgeExpiredRetention", () => {
  it("deletes only rows past each table's window; keeps fresh ones", async () => {
    // audit_log: 365d window
    await seedAudit(daysAgo(AUDIT_LOG_RETENTION_DAYS + 5)); // expired
    await seedAudit(daysAgo(10)); // fresh
    // poll_heartbeats: 30d window
    await seedHeartbeat(daysAgo(POLL_HEARTBEATS_RETENTION_DAYS + 5)); // expired
    await seedHeartbeat(daysAgo(5)); // fresh
    // connector_runs: 90d window, poll kind only
    await seedRun("poll", daysAgo(CONNECTOR_RUNS_RETENTION_DAYS + 5)); // expired
    await seedRun("poll", daysAgo(10)); // fresh

    const result = await purgeExpiredRetention(db, { now: NOW });

    expect(result).toEqual({
      auditLog: 1,
      pollHeartbeats: 1,
      connectorRuns: 1,
      capped: false,
    });
    expect(await countRows(schema.auditLog)).toBe(1);
    expect(await countRows(schema.pollHeartbeats)).toBe(1);
    const runs = await db.select().from(schema.connectorRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].startedAt.getTime()).toBe(daysAgo(10).getTime());
  });

  it("never deletes backfill connector_runs, even when older than the window", async () => {
    // A backfill row's mere existence drives dispatch.ts `backfillStarted` —
    // purging it would re-trigger a full backfill on the next cron tick.
    await seedRun("backfill", daysAgo(CONNECTOR_RUNS_RETENTION_DAYS + 100));
    await seedRun("poll", daysAgo(CONNECTOR_RUNS_RETENTION_DAYS + 100));

    const result = await purgeExpiredRetention(db, { now: NOW });

    expect(result.connectorRuns).toBe(1); // only the poll row
    const remaining = await db
      .select()
      .from(schema.connectorRuns)
      .where(eq(schema.connectorRuns.kind, "backfill"));
    expect(remaining).toHaveLength(1);
  });

  it("respects the exact window boundary (a row at the cutoff is kept)", async () => {
    // observed_at strictly < cutoff is deleted; exactly at the cutoff survives.
    await seedHeartbeat(daysAgo(POLL_HEARTBEATS_RETENTION_DAYS)); // == cutoff
    const result = await purgeExpiredRetention(db, { now: NOW });
    expect(result.pollHeartbeats).toBe(0);
    expect(await countRows(schema.pollHeartbeats)).toBe(1);
  });

  it("bounds work per run: batchSize × maxBatches caps deletions", async () => {
    for (let i = 0; i < 10; i++) {
      await seedHeartbeat(daysAgo(POLL_HEARTBEATS_RETENTION_DAYS + 10));
    }
    // 2 per batch × 2 batches = at most 4 deleted this run.
    const result = await purgeExpiredRetention(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 2,
    });
    expect(result.pollHeartbeats).toBe(4);
    expect(await countRows(schema.pollHeartbeats)).toBe(6);
    // Hit the per-run cap → signals the caller to run again.
    expect(result.capped).toBe(true);
  });

  it("is a no-op when nothing is expired", async () => {
    await seedAudit(daysAgo(10));
    await seedHeartbeat(daysAgo(5));
    await seedRun("poll", daysAgo(10));
    const result = await purgeExpiredRetention(db, { now: NOW });
    expect(result).toEqual({
      auditLog: 0,
      pollHeartbeats: 0,
      connectorRuns: 0,
      capped: false,
    });
  });
});
