import { RetryableConnectorError } from "../../poller/run";
import type {
  CompletionsBucket,
  CostsBucket,
  OpenAiPage,
  OrgProjectsList,
  OrgUsersList,
  ProjectApiKeysList,
} from "./types";

// Thin HTTP layer for the OpenAI org admin surface. Error policy per
// connector-facts §4: no published rate limits for these endpoints →
// generic 429/Retry-After backoff (NLV-O6); 5xx retryable; 401/403/4xx
// permanent (admin keys can expire — NLV-O12 — which lands here as a
// permanent error surfaced on the connection).

const BASE = "https://api.openai.com";
export type FetchFn = typeof fetch;

/** Spacing between consecutive vendor calls in one message (burst-polite). */
export const CALL_SPACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep as callSpacing };

async function getJson<T>(
  credential: string,
  path: string,
  params: Record<string, string | string[]>,
  fetchFn: FetchFn,
): Promise<T> {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v);
    } else if (value !== "") {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetchFn(url.toString(), {
    headers: {
      authorization: `Bearer ${credential}`,
      "user-agent": "revealyst-connector-openai/1",
    },
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RetryableConnectorError(
      "openai: 429 rate limited",
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
    );
  }
  if (response.status >= 500) {
    throw new RetryableConnectorError(
      `openai: ${response.status} server error`,
      60,
    );
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`openai: ${response.status} on ${path}: ${body}`);
  }
  return (await response.json()) as T;
}

async function paginatePages<T>(
  credential: string,
  path: string,
  params: Record<string, string | string[]>,
  fetchFn: FetchFn,
): Promise<Array<OpenAiPage<T>>> {
  const pages: Array<OpenAiPage<T>> = [];
  let cursor: string | null = null;
  do {
    const result: OpenAiPage<T> = await getJson<OpenAiPage<T>>(
      credential,
      path,
      cursor ? { ...params, page: cursor } : params,
      fetchFn,
    );
    pages.push(result);
    cursor = result.has_more ? result.next_page : null;
    if (cursor) {
      await sleep(CALL_SPACING_MS);
    }
  } while (cursor);
  return pages;
}

/** Auth probe: the cheapest admin-key check (project keys 401/403 here —
 * the wrong-key-kind case personal-mode onboarding must catch). */
export async function checkAdminKey(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await getJson(credential, "/v1/organization/users", { limit: "1" }, fetchFn);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Org members — person subjects; ids join usage `user_id` (key owners). */
export async function fetchOrgUsers(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<OrgUsersList["data"]> {
  const users: OrgUsersList["data"] = [];
  let after: string | null | undefined = null;
  do {
    const page: OrgUsersList = await getJson<OrgUsersList>(
      credential,
      "/v1/organization/users",
      after ? { limit: "100", after } : { limit: "100" },
      fetchFn,
    );
    users.push(...page.data);
    if (page.has_more && !page.last_id) {
      // A silent break here would truncate the member list and quietly
      // degrade person attribution — fail loudly instead (review finding).
      throw new Error(
        "openai: /organization/users returned has_more without last_id",
      );
    }
    after = page.has_more ? page.last_id : null;
    if (after) {
      await sleep(CALL_SPACING_MS);
    }
  } while (after);
  return users;
}

/** The shared `{data, has_more, last_id}` org-list envelope. */
type OrgListPage<Item> = {
  object: "list";
  data: Item[];
  has_more: boolean;
  last_id?: string | null;
};

/** Generic cursor walk for the org-list endpoints (projects, project
 * api_keys). Mirrors fetchOrgUsers' loud-fail on a truncated page
 * (has_more without a cursor). */
async function paginateOrgList<Item>(
  credential: string,
  path: string,
  fetchFn: FetchFn,
): Promise<Item[]> {
  const out: Item[] = [];
  let after: string | null | undefined = null;
  do {
    const page: OrgListPage<Item> = await getJson<OrgListPage<Item>>(
      credential,
      path,
      after ? { limit: "100", after } : { limit: "100" },
      fetchFn,
    );
    out.push(...page.data);
    if (page.has_more && !page.last_id) {
      throw new Error(`openai: ${path} returned has_more without last_id`);
    }
    after = page.has_more ? page.last_id : null;
    if (after) await sleep(CALL_SPACING_MS);
  } while (after);
  return out;
}

/** Org projects — coverage subjects (org-admin mode). */
export async function fetchProjects(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<OrgProjectsList["data"]> {
  return paginateOrgList<OrgProjectsList["data"][number]>(
    credential,
    "/v1/organization/projects",
    fetchFn,
  );
}

/** A project's API keys — the key→owner map (org-admin mode). */
export async function fetchProjectApiKeys(
  credential: string,
  projectId: string,
  fetchFn: FetchFn = fetch,
): Promise<ProjectApiKeysList["data"]> {
  return paginateOrgList<ProjectApiKeysList["data"][number]>(
    credential,
    `/v1/organization/projects/${projectId}/api_keys`,
    fetchFn,
  );
}

const unixStart = (day: string) => `${Date.parse(`${day}T00:00:00Z`) / 1000}`;

/**
 * Completions usage, 1h buckets over [start, end] inclusive UTC days,
 * grouped so the person/key/model dims survive (ungrouped responses null
 * them — connector-facts quirk).
 */
export async function fetchCompletionsUsage(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<OpenAiPage<CompletionsBucket>>> {
  return paginatePages<CompletionsBucket>(
    credential,
    "/v1/organization/usage/completions",
    {
      start_time: unixStart(window.start),
      end_time: unixStart(nextDay(window.end)),
      bucket_width: "1h",
      group_by: ["user_id", "api_key_id", "model", "batch"],
      limit: "168",
    },
    fetchFn,
  );
}

/** Costs, 1d buckets (authoritative spend; no user dimension exists). */
export async function fetchCosts(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<OpenAiPage<CostsBucket>>> {
  return paginatePages<CostsBucket>(
    credential,
    "/v1/organization/costs",
    {
      start_time: unixStart(window.start),
      end_time: unixStart(nextDay(window.end)),
      bucket_width: "1d",
      limit: "180",
    },
    fetchFn,
  );
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
