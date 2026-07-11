import { RetryableConnectorError } from "../../poller/run";
import { withTimeout } from "../http";
import type {
  AnthropicPage,
  ClaudeCodeRecord,
  CostBucket,
  UsageBucket,
} from "./types";

// Thin HTTP layer for the Console admin surface. Error policy per
// connector-facts §3: 429 honors Retry-After (fallback 60s), 5xx retries,
// 401/403/4xx are permanent (bad key / plan gate — surfaced on the
// connection). Rate courtesy: the documented guidance is "poll once per
// minute sustained; bursts acceptable for pagination", so a small fixed
// spacing between calls inside one message is enough — chunk sizing
// (registry maxCallsPerDay) bounds the total.

const BASE = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Test seam + default: global fetch on Workers/Node. */
export type FetchFn = typeof fetch;

/** Spacing between consecutive vendor calls in one message (burst-polite). */
export const CALL_SPACING_MS = 250;

async function getJson<T>(
  credential: string,
  path: string,
  params: Record<string, string | string[]>,
  fetchFn: FetchFn,
): Promise<T> {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(`${key}[]`, v);
    } else if (value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return withTimeout("anthropic", async (signal) => {
    const response = await fetchFn(url.toString(), {
      headers: {
        "x-api-key": credential,
        "anthropic-version": ANTHROPIC_VERSION,
        "user-agent": "revealyst-connector-anthropic/1",
      },
      signal,
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new RetryableConnectorError(
        "anthropic: 429 rate limited",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      );
    }
    if (response.status >= 500) {
      throw new RetryableConnectorError(
        `anthropic: ${response.status} server error`,
        60,
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(`anthropic: ${response.status} on ${path}: ${body}`);
    }
    return (await response.json()) as T;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function paginate<T>(
  credential: string,
  path: string,
  params: Record<string, string | string[]>,
  fetchFn: FetchFn,
): Promise<Array<AnthropicPage<T>>> {
  const pages: Array<AnthropicPage<T>> = [];
  let page: string | null = null;
  do {
    const result: AnthropicPage<T> = await getJson<AnthropicPage<T>>(
      credential,
      path,
      page ? { ...params, page } : params,
      fetchFn,
    );
    pages.push(result);
    page = result.has_more ? result.next_page : null;
    if (page) {
      await sleep(CALL_SPACING_MS);
    }
  } while (page);
  return pages;
}

/** Auth probe: /me is the cheapest admin-key check. Transient failures
 * (429/5xx/timeout) RETHROW as RetryableConnectorError: the credential-save
 * contract (api-impl putConnectionCredential) treats a throw as inconclusive
 * and keeps the key, while `{ok:false}` definitively rejects it and errors
 * the connection — a vendor blip must never do that. */
export async function checkAdminKey(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await getJson(credential, "/v1/organizations/me", {}, fetchFn);
    return { ok: true };
  } catch (error) {
    if (error instanceof RetryableConnectorError) throw error;
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Org members — the person-subject source (id joins usage account_id). */
export async function fetchOrgUsers(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<Array<{ id: string; email: string; name: string | null }>> {
  const pages = await paginate<{ id: string; email: string; name: string | null }>(
    credential,
    "/v1/organizations/users",
    {},
    fetchFn,
  );
  return pages.flatMap((p) => p.data);
}

/**
 * Usage report, 1h buckets over [start, end] inclusive UTC days, grouped so
 * the person/key/account dims survive (ungrouped responses null them).
 */
export async function fetchUsageMessages(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<AnthropicPage<UsageBucket>>> {
  return paginate<UsageBucket>(
    credential,
    "/v1/organizations/usage_report/messages",
    {
      starting_at: `${window.start}T00:00:00Z`,
      ending_at: `${nextDay(window.end)}T00:00:00Z`,
      bucket_width: "1h",
      group_by: ["api_key_id", "account_id", "service_account_id", "model"],
    },
    fetchFn,
  );
}

/** Cost report, 1d buckets (the authoritative org spend). */
export async function fetchCostReport(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<AnthropicPage<CostBucket>>> {
  return paginate<CostBucket>(
    credential,
    "/v1/organizations/cost_report",
    {
      starting_at: `${window.start}T00:00:00Z`,
      ending_at: `${nextDay(window.end)}T00:00:00Z`,
      bucket_width: "1d",
    },
    fetchFn,
  );
}

/**
 * Claude Code Analytics — one UTC day per call (NLV-A13: a range variant
 * may exist; until verified live, the documented single-day form is used
 * and chunk sizing budgets one call per day).
 */
export async function fetchClaudeCodeDay(
  credential: string,
  day: string,
  fetchFn: FetchFn = fetch,
): Promise<Array<AnthropicPage<ClaudeCodeRecord>>> {
  return paginate<ClaudeCodeRecord>(
    credential,
    "/v1/organizations/usage_report/claude_code",
    { starting_at: day, limit: "1000" },
    fetchFn,
  );
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export { sleep as callSpacing };
