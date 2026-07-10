import { RetryableConnectorError } from "../../poller/run";
import { withTimeout } from "../http";
import {
  GITHUB_API_VERSION,
  type FetchFn,
  retryAfterSeconds,
} from "./github-app";
import type {
  CopilotAiCreditUsage,
  CopilotReportListing,
  CopilotUserDayRecord,
  CopilotUserTeamRecord,
} from "./types";

// HTTP layer for the Copilot usage-metrics reports API. Two-hop fetch:
// (1) GET a report endpoint with the installation token → { download_links }
// (2) GET each signed link (NO auth header — facts NLV-C3) → NDJSON text.
//
// Error policy per the connector framework / facts §1: 429 and 5xx are
// retryable (Retry-After / x-ratelimit-reset honored); a 403 WITH rate-limit
// headers is a secondary-rate-limit (retryable), a 403 WITHOUT them is a
// policy-off / permission problem (permanent — surfaced on the connection,
// never read as "no usage"); other 4xx permanent. NDJSON is parsed leniently
// (skip unparseable lines) because the schema churns monthly.

const GITHUB_API = "https://api.github.com";
export const CALL_SPACING_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep as callSpacing };

function reportPath(scope: CopilotScope, reportType: string, day: string): string {
  const base =
    scope.kind === "enterprise"
      ? `/enterprises/${encodeURIComponent(scope.slug)}`
      : `/orgs/${encodeURIComponent(scope.slug)}`;
  return `${base}/copilot/metrics/reports/${reportType}?day=${day}`;
}

/** Whether the target is an org or a GitHub Enterprise (same five reports
 * under a different base — facts §1). */
export type CopilotScope =
  | { kind: "org"; slug: string }
  | { kind: "enterprise"; slug: string };

async function ghJson<T>(
  path: string,
  token: string,
  fetchFn: FetchFn,
): Promise<T> {
  return withTimeout("github_copilot", async (signal) => {
    const res = await fetchFn(`${GITHUB_API}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": GITHUB_API_VERSION,
        "user-agent": "revealyst-connector-copilot/1",
      },
      signal,
    });
    return handleGh<T>(res, path);
  });
}

function isSecondaryRateLimit(res: Response): boolean {
  // A 403 is retried ONLY when it carries `retry-after` — GitHub's secondary
  // rate-limit signal. Primary rate-limit exhaustion returns 429 (handled
  // separately), so a bare 403 (policy-off / missing permission) stays
  // PERMANENT and surfaces the real reason on the connection — never retried
  // forever and never read as "no usage". Keying on `x-ratelimit-remaining: 0`
  // would misclassify a permission 403 that merely coincided with an exhausted
  // quota as retryable.
  return res.status === 403 && res.headers.get("retry-after") !== null;
}

async function handleGh<T>(res: Response, path: string): Promise<T> {
  if (res.status === 429 || res.status >= 500 || isSecondaryRateLimit(res)) {
    throw new RetryableConnectorError(
      `github_copilot: ${res.status} on ${path}`,
      retryAfterSeconds(res),
    );
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`github_copilot: ${res.status} on ${path}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** Auth probe: list the org's users-1-day report for a recently-finalized
 * day (D-4, safely past the ≤3-day finalization). A 200 (or empty links)
 * means the installation + policy grant the reports; a 4xx surfaces the real
 * reason. */
export async function checkReportsAccess(
  token: string,
  scope: CopilotScope,
  day: string,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await ghJson<CopilotReportListing>(
      reportPath(scope, "users-1-day", day),
      token,
      fetchFn,
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Downloads + concatenates the NDJSON behind a report's signed links.
 * Parses leniently (a bad line is counted-and-skipped, never throws) so a
 * monthly schema tweak degrades gracefully instead of bricking a poll. */
async function fetchReportRecords<T>(
  token: string,
  path: string,
  fetchFn: FetchFn,
): Promise<T[]> {
  const listing = await ghJson<CopilotReportListing>(path, token, fetchFn);
  const links = listing.download_links ?? [];
  const out: T[] = [];
  for (const link of links) {
    const text = await withTimeout("github_copilot", async (signal) => {
      // Signed links need NO auth (facts NLV-C3); a bearer header can even
      // 400 some CDNs, so it is deliberately omitted.
      const dl = await fetchFn(link, { signal });
      if (dl.status === 429 || dl.status >= 500) {
        throw new RetryableConnectorError(
          `github_copilot: ${dl.status} downloading report file`,
          retryAfterSeconds(dl),
        );
      }
      if (!dl.ok) {
        const detail = (await dl.text()).slice(0, 200);
        throw new Error(
          `github_copilot: ${dl.status} downloading report file: ${detail}`,
        );
      }
      return dl.text();
    });
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // Lenient NDJSON: skip an unparseable line (schema churn / partial
        // flush) rather than failing the whole day.
      }
    }
    await sleep(CALL_SPACING_MS);
  }
  return out;
}

/** Per-user daily usage records for one UTC day. */
export function fetchUsersDaily(
  token: string,
  scope: CopilotScope,
  day: string,
  fetchFn: FetchFn = fetch,
): Promise<CopilotUserDayRecord[]> {
  return fetchReportRecords<CopilotUserDayRecord>(
    token,
    reportPath(scope, "users-1-day", day),
    fetchFn,
  );
}

/** Per-user team memberships for one UTC day (the join input). */
export function fetchUserTeams(
  token: string,
  scope: CopilotScope,
  day: string,
  fetchFn: FetchFn = fetch,
): Promise<CopilotUserTeamRecord[]> {
  return fetchReportRecords<CopilotUserTeamRecord>(
    token,
    reportPath(scope, "user-teams-1-day", day),
    fetchFn,
  );
}

/**
 * Personal-mode spend context (§6a.2): a personal-plan user's own per-model
 * daily AI-credit spend, read with THEIR token (a PAT), not the App. Usage
 * metrics stay org-only — this endpoint is spend context only.
 */
export async function fetchPersonalAiCreditUsage(
  userToken: string,
  username: string,
  year: number,
  month: number,
  fetchFn: FetchFn = fetch,
): Promise<CopilotAiCreditUsage> {
  const body = await ghJson<Partial<CopilotAiCreditUsage>>(
    `/users/${encodeURIComponent(username)}/settings/billing/ai_credit/usage?year=${year}&month=${month}`,
    userToken,
    fetchFn,
  );
  return { usageItems: body.usageItems ?? [] };
}
