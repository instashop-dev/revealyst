// Perf-harness instrumentation only (tests/perf/**) — not shipped code.
//
// Wraps a PGlite instance's `query`/`transaction` methods to count every
// SQL round-trip issued through it and to derive a "sequential depth": the
// number of query round-trips that could NOT have overlapped with another
// in-flight query, i.e. the number of times the connection went from idle
// (0 in-flight) back to busy. On Workers→Hyperdrive→Neon every query is a
// real network round-trip, so this is the best local proxy for production
// TTFB: a batch of N queries fired concurrently (Promise.all) counts as ONE
// step of depth (they'd overlap on the wire), while N queries awaited one
// after another count as N steps.
//
// This does NOT measure PGlite's actual internal execution concurrency
// (PGlite serializes internally regardless) — it measures the CALLING
// CODE's concurrency, i.e. whether the app issued queries without awaiting
// the previous one first. That call-site shape is exactly what would
// translate into overlapping (or serial) round-trips in production.

export type QuerySnapshot = {
  /** Total number of query() round-trips issued (incl. inside transactions). */
  total: number;
  /** Number of "idle → busy" transitions — the round-trip depth proxy. */
  sequentialDepth: number;
  /** Largest number of queries ever in flight at once (informational). */
  maxConcurrency: number;
};

export type QueryCounter = {
  reset(): void;
  snapshot(): QuerySnapshot;
};

// Deliberately loose (`any`) rather than importing PGlite's real type: this
// wrapper only needs `query`/`transaction` to exist and works identically
// against a top-level PGlite instance or a transaction-scoped client, whose
// exact generic signatures differ slightly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgliteLike = {
  query: (...args: any[]) => Promise<any>;
  transaction?: <T>(callback: (tx: PgliteLike) => Promise<T>) => Promise<T>;
  __perfWrapped?: boolean;
};

/**
 * Instruments a PGlite instance BEFORE it is handed to `drizzle(...)`.
 * Drizzle's pglite driver calls `client.query(...)` for every prepared
 * statement (select/insert/update/raw execute alike — see
 * drizzle-orm/pglite/session.js), and `client.transaction(cb)` for
 * `db.transaction(...)`, handing `cb` a fresh transaction-scoped client
 * that also exposes `.query`. Wrapping both choke points covers every
 * query issued through the returned drizzle db, including inside
 * transactions (e.g. `ensureOrgOfOne`).
 */
export function instrumentPglite(pglite: PgliteLike): QueryCounter {
  let total = 0;
  let inFlight = 0;
  let maxConcurrency = 0;
  let sequentialDepth = 0;

  function wrapClient(client: PgliteLike): PgliteLike {
    if (client.__perfWrapped) return client;
    client.__perfWrapped = true;

    const originalQuery = client.query.bind(client);
    client.query = async (...args: any[]) => {
      total++;
      if (inFlight === 0) sequentialDepth++;
      inFlight++;
      if (inFlight > maxConcurrency) maxConcurrency = inFlight;
      try {
        return await originalQuery(...args);
      } finally {
        inFlight--;
      }
    };

    if (typeof client.transaction === "function") {
      const originalTransaction = client.transaction.bind(client);
      client.transaction = (<T>(callback: (tx: PgliteLike) => Promise<T>) =>
        originalTransaction((tx: PgliteLike) => {
          wrapClient(tx);
          return callback(tx);
        })) as PgliteLike["transaction"];
    }

    return client;
  }

  wrapClient(pglite);

  return {
    reset() {
      total = 0;
      inFlight = 0;
      maxConcurrency = 0;
      sequentialDepth = 0;
    },
    snapshot() {
      return { total, sequentialDepth, maxConcurrency };
    },
  };
}

export type ScenarioResult = QuerySnapshot & { scenario: string; ms: number };

/** Runs `fn` against a fresh counter reading, timing wall-clock too. */
export async function measure(
  counter: QueryCounter,
  scenario: string,
  fn: () => Promise<unknown>,
): Promise<ScenarioResult> {
  counter.reset();
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  return { scenario, ms, ...counter.snapshot() };
}

/** Renders a fixed-width table for console.log — no external table dep. */
export function formatTable(rows: ScenarioResult[]): string {
  const header = ["scenario", "total queries", "sequential depth", "ms"];
  const cells = rows.map((r) => [
    r.scenario,
    String(r.total),
    String(r.sequentialDepth),
    r.ms.toFixed(1),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i].length)),
  );
  const line = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join(" | ");
  const sep = widths.map((w) => "-".repeat(w)).join("-|-");
  return [line(header), sep, ...cells.map(line)].join("\n");
}
