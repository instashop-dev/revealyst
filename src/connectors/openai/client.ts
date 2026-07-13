import { RetryableConnectorError } from "../../poller/run";
import { withTimeout } from "../http";
import type {
  CodeInterpreterSessionsBucket,
  CompletionsBucket,
  CostsBucket,
  OpenAiPage,
  OrgProjectsList,
  OrgUsersList,
  ProjectApiKeysList,
  WebSearchCallsBucket,
} from "./types";

// Thin HTTP layer for the OpenAI org admin surface. Error policy per
// connector-facts §4: no published rate limits for these endpoints →
// generic 429/Retry-After backoff (NLV-O6); 5xx retryable; 401/403/4xx
// permanent (admin keys can expire — NLV-O12 — which lands here as a
// permanent error surfaced on the connection).

/** Appended to 401/403 errors: this exact string is what lands in
 * `connections.lastError` and the credential-save 400 — the raw vendor body
 * ("Missing scopes: api.usage.read …") doesn't tell a user what key to make.
 * Worded to cover every 401/403 cause: wrong key kind at onboarding, a
 * restricted admin key missing a scope, and a mid-life expiry/revocation
 * (NLV-O12) — the last lands on long-active connections, so the hint must
 * not imply the user picked the wrong kind of key. */
const ADMIN_KEY_HINT =
  " — the key must be an active OpenAI org admin key with the" +
  " api.management.read and api.usage.read scopes: project keys (sk-proj-…)" +
  " cannot read the org admin surface, and admin keys can expire or be" +
  " revoked.";

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
  return withTimeout("openai", async (signal) => {
    const response = await fetchFn(url.toString(), {
      headers: {
        authorization: `Bearer ${credential}`,
        "user-agent": "revealyst-connector-openai/1",
      },
      signal,
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
      const hint =
        response.status === 401 || response.status === 403
          ? ADMIN_KEY_HINT
          : "";
      throw new Error(`openai: ${response.status} on ${path}: ${body}${hint}`);
    }
    return (await response.json()) as T;
  });
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

/** Auth probe: the cheapest check of BOTH scopes a sync needs. Restricted
 * admin keys gate the member list (api.management.read) and usage/costs
 * (api.usage.read) separately — a users-only probe passed usage-blind keys
 * through onboarding and every later poll 403'd permanently. Project keys
 * 401/403 on the first call — the wrong-key-kind case personal-mode
 * onboarding must catch. Transient failures (429/5xx/timeout) RETHROW as
 * RetryableConnectorError: the credential-save contract (api-impl
 * putConnectionCredential) treats a throw as inconclusive and keeps the
 * key, while `{ok:false}` definitively rejects it and errors the
 * connection — a vendor blip must never do that. */
export async function checkAdminKey(
  credential: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await getJson(credential, "/v1/organization/users", { limit: "1" }, fetchFn);
    // Cheapest api.usage.read probe: one 1d costs bucket for today. Same
    // param shape as fetchCosts (day-aligned start, explicit bucket_width)
    // so a probe-only 400 can't false-reject a key the real poll accepts.
    // No CALL_SPACING_MS here: this is one interactive save-path call pair,
    // not a poller pagination burst.
    await getJson(
      credential,
      "/v1/organization/costs",
      {
        start_time: unixStart(new Date().toISOString().slice(0, 10)),
        bucket_width: "1d",
        limit: "1",
      },
      fetchFn,
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof RetryableConnectorError) throw error;
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

/**
 * Web-search-call usage, 1d buckets over [start, end] inclusive UTC days
 * (W5-E re-scope, §1.2 (3)). Grouped by user_id/api_key_id so the per-person
 * feature attribution survives (this family is NOT in the project-only
 * restriction — connector-facts §4).
 */
export async function fetchWebSearchUsage(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<OpenAiPage<WebSearchCallsBucket>>> {
  return paginatePages<WebSearchCallsBucket>(
    credential,
    "/v1/organization/usage/web_search_calls",
    {
      start_time: unixStart(window.start),
      end_time: unixStart(nextDay(window.end)),
      bucket_width: "1d",
      group_by: ["user_id", "api_key_id"],
      limit: "31",
    },
    fetchFn,
  );
}

/**
 * Code-interpreter-session usage, 1d buckets. This family has NO user/key
 * dimension (project_id only — connector-facts §4), so it is org-level: the
 * normalizer emits a feature-presence flag on the org subject, never per person.
 */
export async function fetchCodeInterpreterUsage(
  credential: string,
  window: { start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<Array<OpenAiPage<CodeInterpreterSessionsBucket>>> {
  return paginatePages<CodeInterpreterSessionsBucket>(
    credential,
    "/v1/organization/usage/code_interpreter_sessions",
    {
      start_time: unixStart(window.start),
      end_time: unixStart(nextDay(window.end)),
      bucket_width: "1d",
      group_by: ["project_id"],
      limit: "31",
    },
    fetchFn,
  );
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
