import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { benchmarks } from "./schema";

// W2-I: published-benchmark reads. Global reference data (no org_id, like
// metric_catalog) — plain functions, no forOrg scoping needed (ADR 0007).

export type BenchmarkFilter = {
  scoreSlug?: string;
  componentKey?: string;
  segment?: string;
  status?: "draft" | "verified" | "retired";
};

/**
 * Lists published benchmark rows matching the given filter. Callers
 * building a user-facing panel should pass `status: "verified"` — seeded
 * rows start as `draft` and must not be presented as authoritative until a
 * founder confirms the primary source.
 */
export async function listBenchmarks(db: Db, filter: BenchmarkFilter = {}) {
  const conditions = [];
  if (filter.scoreSlug !== undefined) {
    conditions.push(eq(benchmarks.scoreSlug, filter.scoreSlug));
  }
  if (filter.componentKey !== undefined) {
    conditions.push(eq(benchmarks.componentKey, filter.componentKey));
  }
  if (filter.segment !== undefined) {
    conditions.push(eq(benchmarks.segment, filter.segment));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(benchmarks.status, filter.status));
  }
  return db
    .select()
    .from(benchmarks)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

export async function getBenchmark(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(benchmarks)
    .where(eq(benchmarks.id, id));
  return row;
}
