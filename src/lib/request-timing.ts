// Request-lifecycle instrumentation (incident: authenticated pages >7s in
// prod). Cheap, always-on server-side stage timing that surfaces as a
// standard `Server-Timing` response header (devtools / `curl -sD`) and a
// structured console.log line (wrangler tail / Workers Logs).
//
// Variant shipped: AsyncLocalStorage-backed per-request collector.
// wrangler.jsonc has `nodejs_compat` in compatibility_flags, which is what
// OpenNext itself requires and what makes `node:async_hooks` available on
// Workers — so ALS works in prod, not just under Node/vitest. Every helper
// below no-ops safely when called outside an active store (e.g. a unit test
// that imports a wrapped function directly, or any code path that never ran
// through `runWithRequestTiming`) — no throw, negligible overhead.
//
// RELATIVE imports only: this file is imported from src/db and src/lib
// modules that vitest loads directly (no Next/tsc path aliasing at test
// runtime — see CLAUDE.md).
import { AsyncLocalStorage } from "node:async_hooks";

export type StageRecord = { name: string; dur: number };

type RequestTimingStore = {
  start: number;
  stages: StageRecord[];
};

// One ALS instance per isolate. `Date.now()` (not `performance.now()`) for
// the marks — millisecond resolution is plenty for a >7s incident and avoids
// depending on a High Resolution Time seam that varies by runtime/compat flag.
const als = new AsyncLocalStorage<RequestTimingStore>();

/**
 * Start a new per-request store and run `fn` inside it. Call once per
 * request, as high up the call chain as possible (src/worker.ts), so every
 * `timeStage` nested anywhere inside `fn` (including across await points
 * deep in React Server Component rendering) shares one collector.
 */
export function runWithRequestTiming<T>(fn: () => T): T {
  return als.run({ start: Date.now(), stages: [] }, fn);
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
    store.stages.push({ name, dur: Date.now() - t0 });
  }
}

/**
 * Read the accumulated stages + elapsed total (ms since
 * `runWithRequestTiming` started) for the active request, or null outside a
 * request-timing context.
 */
export function readRequestTiming(): {
  total: number;
  stages: StageRecord[];
} | null {
  const store = als.getStore();
  if (!store) return null;
  return { total: Date.now() - store.start, stages: store.stages };
}

/**
 * Format stages (+ an optional trailing "total" entry) as a standard
 * Server-Timing header value: `name;dur=12, name2;dur=4`. Names and
 * durations only — no query text, no user data, safe to always emit.
 */
export function formatServerTiming(
  stages: readonly StageRecord[],
  total?: number,
): string {
  const entries =
    total !== undefined ? [...stages, { name: "total", dur: total }] : stages;
  return entries.map((s) => `${s.name};dur=${s.dur}`).join(", ");
}
