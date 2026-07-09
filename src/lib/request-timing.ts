// Request-lifecycle instrumentation (incident: authenticated pages >7s in
// prod). Cheap server-side stage timing that surfaces as a standard
// `Server-Timing` response header (devtools / `curl -sD`) and structured
// console.log lines (wrangler tail / Workers Logs).
//
// Variant shipped: AsyncLocalStorage-backed per-request collector.
// wrangler.jsonc has `nodejs_compat` in compatibility_flags, which is what
// OpenNext itself requires and what makes `node:async_hooks` available on
// Workers — so ALS works in prod, not just under Node/vitest. Every helper
// below no-ops safely when called outside an active store (e.g. a unit test
// that imports a wrapped function directly, or any code path that never ran
// through `runWithRequestTiming`) — no throw, negligible overhead.
//
// The store is created explicitly by the caller (src/worker.ts) and passed
// into `runWithRequestTiming`, NOT re-read via `als.getStore()` after the
// run returns — the caller's own async context is outside `als.run`, so
// `getStore()` there would be undefined and the collected stages unreachable.
// Holding the plain object reference sidesteps that entirely.
//
// RELATIVE imports only: this file is imported from src/db and src/lib
// modules that vitest loads directly (no Next/tsc path aliasing at test
// runtime — see CLAUDE.md).
import { AsyncLocalStorage } from "node:async_hooks";

export type StageRecord = { name: string; dur: number };

export type RequestTimingStore = {
  start: number;
  stages: StageRecord[];
  /** Request path, for the per-stage late-log lines. */
  path: string;
  /**
   * Set by the caller once the summary log + Server-Timing header have been
   * emitted (i.e. response headers are out the door). Stages that complete
   * AFTER this point — a Suspense boundary streaming its body after the
   * shell flushed, exactly the slow-dashboard case this tool exists for —
   * can no longer reach the header, so `timeStage` logs them individually
   * instead. Without this, the heaviest stage of a streamed page would be
   * silently invisible.
   */
  flushed: boolean;
};

// One ALS instance per isolate. `Date.now()` (not `performance.now()`) for
// the marks — millisecond resolution is plenty for a >7s incident and avoids
// depending on a High Resolution Time seam that varies by runtime/compat flag.
const als = new AsyncLocalStorage<RequestTimingStore>();

export function createRequestTimingStore(path: string): RequestTimingStore {
  return { start: Date.now(), stages: [], path, flushed: false };
}

/**
 * Run `fn` inside the given per-request store. Call once per instrumented
 * request, as high up the call chain as possible (src/worker.ts), so every
 * `timeStage` nested anywhere inside `fn` (including across await points
 * deep in React Server Component rendering) shares one collector.
 */
export function runWithRequestTiming<T>(
  store: RequestTimingStore,
  fn: () => T,
): T {
  return als.run(store, fn);
}

/**
 * Time an async stage and record its duration into the active request's
 * store, if any. Outside a request-timing context (unit tests, scripts,
 * cron/queue handlers that never called `runWithRequestTiming`) this is a
 * pure passthrough — no store, no throw, no extra overhead beyond `fn` itself.
 */
export async function timeStage<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const store = als.getStore();
  if (!store) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const dur = Date.now() - t0;
    store.stages.push({ name, dur });
    if (store.flushed) {
      // Late (streamed) stage — the summary line already went out without
      // it. One line per late stage; stage names + durations only, no query
      // text or user data.
      console.log(JSON.stringify({ path: store.path, lateStage: name, dur }));
    }
  }
}

/**
 * Format stages plus a trailing "total" entry as a standard Server-Timing
 * header value: `session;dur=42, total;dur=402`. Names and durations only —
 * no query text, no user data, safe to always emit.
 */
export function formatServerTiming(
  stages: readonly StageRecord[],
  total: number,
): string {
  return [...stages, { name: "total", dur: total }]
    .map((s) => `${s.name};dur=${s.dur}`)
    .join(", ");
}
