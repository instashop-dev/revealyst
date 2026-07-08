import { RetryableConnectorError } from "../../poller/run";
import { withTimeout } from "../http";
import type {
  CursorDailyUsageResponse,
  CursorDailyUsageRow,
  CursorMembersResponse,
  CursorUsageEvent,
  CursorUsageEventsResponse,
} from "./types";

// Thin HTTP layer for the Cursor Admin API. Error policy per
// connector-facts §2: 20 req/min/team → 429 with Retry-After (retryable);
// 5xx retryable; other 4xx permanent (bad/rotated key surfaces on the
// connection). Basic auth: the API key is the username, password empty
// (`-u KEY:`); Bearer is also accepted but Basic matches the docs.

const BASE = "https://api.cursor.com";
export type FetchFn = typeof fetch;

/** Spacing between consecutive vendor calls (20 req/min → ≥3s is safe; we
 * page a handful of times per poll, so 300ms burst spacing stays well under
 * the minute budget while keeping polls quick). */
export const CALL_SPACING_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep as callSpacing };

/** Members page/day cap — a generous ceiling so a runaway pagination loop
 * (misbehaving cursor) can't spin forever. */
const MAX_PAGES = 200;
const PAGE_SIZE = 500;

function authHeader(credential: string): string {
  // Basic auth, key as username, empty password (facts §2). btoa is present
  // on workerd, Node ≥18, and vitest.
  return `Basic ${btoa(`${credential}:`)}`;
}

async function post<T>(
  credential: string,
  path: string,
  body: Record<string, unknown>,
  fetchFn: FetchFn,
): Promise<T> {
  return withTimeout("cursor", async (signal) => {
    const response = await fetchFn(new URL(path, BASE).toString(), {
      method: "POST",
      headers: {
        authorization: authHeader(credential),
        "content-type": "application/json",
        "user-agent": "revealyst-connector-cursor/1",
      },
      body: JSON.stringify(body),
      signal,
    });
    return handle<T>(response, path);
  });
}

async function get<T>(
  credential: string,
  path: string,
  fetchFn: FetchFn,
): Promise<T> {
  return withTimeout("cursor", async (signal) => {
    const response = await fetchFn(new URL(path, BASE).toString(), {
      headers: {
        authorization: authHeader(credential),
        "user-agent": "revealyst-connector-cursor/1",
      },
      signal,
    });
    return handle<T>(response, path);
  });
}

async function handle<T>(response: Response, path: string): Promise<T> {
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RetryableConnectorError(
      "cursor: 429 rate limited",
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
    );
  }
  if (response.status >= 500) {
    throw new RetryableConnectorError(`cursor: ${response.status} server error`, 60);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`cursor: ${response.status} on ${path}: ${detail}`);
  }
  return (await response.json()) as T;
}

/** Auth probe: the cheapest admin-key check. */
export async function checkAdminKey(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await get<CursorMembersResponse>(credential, "/teams/members", fetchFn);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Team roster — person subjects; ids/emails join the usage surfaces. */
export async function fetchMembers(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<CursorMembersResponse["teamMembers"]> {
  const res = await get<CursorMembersResponse>(
    credential,
    "/teams/members",
    fetchFn,
  );
  return res.teamMembers ?? [];
}

/** UTC-midnight epoch-ms for a `YYYY-MM-DD` day. */
function epochMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily-usage rows for the inclusive [start, end] window, ALWAYS paginated
 * (page/pageSize) so inactive members are included — the un-paginated call
 * silently returns active users only (facts §2). All pages are concatenated
 * (member rows are disjoint across pages).
 */
export async function fetchDailyUsage(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<CursorDailyUsageRow[]> {
  const startDate = epochMs(window.start);
  // Exclusive upper bound at the next UTC midnight after `end`.
  const endDate = epochMs(nextDay(window.end));
  const rows: CursorDailyUsageRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await post<CursorDailyUsageResponse>(
      credential,
      "/teams/daily-usage-data",
      { startDate, endDate, page, pageSize: PAGE_SIZE },
      fetchFn,
    );
    const batch = res.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break; // last (short) page
    await sleep(CALL_SPACING_MS);
  }
  return rows;
}

/**
 * Event-level records for the window, paginated by event count and
 * concatenated into ONE list — the (person, day) sums must all reach
 * normalize() in a single envelope (replace-on-conflict upsert, see
 * types.ts).
 */
export async function fetchUsageEvents(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<CursorUsageEvent[]> {
  const startDate = epochMs(window.start);
  const endDate = epochMs(nextDay(window.end));
  const events: CursorUsageEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await post<CursorUsageEventsResponse>(
      credential,
      "/teams/filtered-usage-events",
      { startDate, endDate, page, pageSize: PAGE_SIZE },
      fetchFn,
    );
    const batch = res.usageEvents ?? [];
    events.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    await sleep(CALL_SPACING_MS);
  }
  return events;
}
