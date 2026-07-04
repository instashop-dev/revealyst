// W0-A live verification — GitHub Copilot usage-metrics reports API.
// Covers NLV-C2, C3, C4, C7, C8, C9(partial), C10, C11(partial), C12, C13, C14, C17.
// Env: GITHUB_TOKEN (org admin PAT or App installation token), GH_ORG,
//      optional GH_USER_TOKEN + GH_USER (personal-plan checks).
import { env, section, finding, manual, call, shape, daysAgo, isoDay } from "./_lib.mjs";

const token = env("GITHUB_TOKEN");
const org = env("GH_ORG");
const userToken = env("GH_USER_TOKEN", { optional: true });
const user = env("GH_USER", { optional: true });

const gh = (path, tok = token) =>
  call(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${tok}`,
      "x-github-api-version": "2026-03-10",
      accept: "application/vnd.github+json",
    },
  });

section("NLV-C4: rate-limit headers on a metrics listing call");
{
  const r = await gh(`/orgs/${org}/copilot/metrics/reports/organization-1-day?day=${isoDay(daysAgo(4))}`);
  finding("C4", "status + headers", { status: r.status, headers: r.headers });
}

section("NLV-C7: day bounds and availability lag");
for (const [label, day] of [
  ["earliest documented (2025-10-10)", "2025-10-10"],
  ["before earliest (2025-10-09)", "2025-10-09"],
  ["D-1", isoDay(daysAgo(1))],
  ["D-3", isoDay(daysAgo(3))],
]) {
  const r = await gh(`/orgs/${org}/copilot/metrics/reports/users-1-day?day=${day}`);
  finding("C7", `users-1-day ${label}`, {
    status: r.status,
    links: Array.isArray(r.body?.download_links) ? r.body.download_links.length : r.body?.message ?? shape(r.body),
  });
}

section("NLV-C8: 28-day endpoint accepts a day param?");
{
  const latest = await gh(`/orgs/${org}/copilot/metrics/reports/users-28-day/latest`);
  const withDay = await gh(`/orgs/${org}/copilot/metrics/reports/users-28-day/latest?day=${isoDay(daysAgo(40))}`);
  finding("C8", "latest", { status: latest.status, report_start_day: latest.body?.report_start_day, report_end_day: latest.body?.report_end_day });
  finding("C8", "latest?day=D-40 (should be ignored or rejected)", { status: withDay.status, report_start_day: withDay.body?.report_start_day });
}

section("NLV-C2 + C3 + C10: download link TTL params, unauthenticated fetch, NDJSON details");
{
  const r = await gh(`/orgs/${org}/copilot/metrics/reports/users-1-day?day=${isoDay(daysAgo(4))}`);
  const links = r.body?.download_links ?? [];
  finding("C10", "file count", links.length);
  if (links.length) {
    const u = new URL(links[0]);
    finding("C2", "link host + query param names (TTL hints)", { host: u.host, params: [...u.searchParams.keys()] });
    const dl = await fetch(links[0]); // deliberately no auth header
    const bodyText = await dl.text();
    const lines = bodyText.split("\n").filter(Boolean);
    finding("C3", "unauthenticated download", { status: dl.status, rateLimitHeaderPresent: dl.headers.get("x-ratelimit-limit") !== null, contentEncoding: dl.headers.get("content-encoding") });
    if (lines.length) {
      let rec = {};
      try { rec = JSON.parse(lines[0]); } catch {}
      finding("C10", "records in file 1", lines.length);
      finding("C10", "first record keys", Object.keys(rec));
      finding("C10", "organization_id type", typeof rec.organization_id);
    }
    manual("C2", `Re-run this fetch on the same URL after 1h and 24h to measure link TTL: ${u.host}${u.pathname.slice(0, 40)}…`);
  } else {
    finding("C2/C3/C10", "no download links returned", r.status);
  }
}

section("NLV-C17: legacy endpoint tombstones");
for (const p of [`/orgs/${org}/copilot/metrics`, `/orgs/${org}/copilot/usage`]) {
  const r = await gh(p);
  finding("C17", p, { status: r.status, message: r.body?.message });
}

section("NLV-C12: AI-credit billing usage (org)");
{
  const now = new Date();
  const r = await gh(`/organizations/${org}/settings/billing/ai_credit/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`);
  finding("C12", "status", r.status);
  const items = r.body?.usageItems ?? [];
  finding("C12", "distinct sku values", [...new Set(items.map((i) => i.sku))].slice(0, 20));
  finding("C12", "distinct product values", [...new Set(items.map((i) => i.product))].slice(0, 20));
  finding("C12", "item shape", items.length ? shape(items[0]) : "none");
}

if (userToken && user) {
  section("NLV-C13/C14: personal-plan surface");
  const now = new Date();
  const m = await gh(`/orgs/${org}/copilot/metrics/reports/users-1-day?day=${isoDay(daysAgo(4))}`, userToken);
  finding("C14", "org metrics with personal token (expect 403/404)", m.status);
  const b = await gh(`/users/${user}/settings/billing/ai_credit/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, userToken);
  finding("C13/C14", "personal ai_credit usage", { status: b.status, items: (b.body?.usageItems ?? []).length });
} else {
  manual("C13/C14", "Set GH_USER_TOKEN + GH_USER (a personal-plan account) and re-run for the personal-surface checks.");
}

section("Remaining manual checks");
manual("C1", "Install a GitHub App with ONLY 'Organization Copilot metrics' (read); repeat this script with its installation token — all report endpoints should still return 200.");
manual("C5", "Run against an org with <5 Copilot seats: do organization-1-day / users-1-day return data, empty, or 422?");
manual("C6", "Run against a Copilot Business org on a GitHub Free/Team (non-GHEC) plan.");
manual("C9", "Fetch users-1-day for one fixed day at D+1, D+2, D+3, D+5; diff per-user rows to quantify restatement.");
manual("C11", "Compare users-1-day ai_credits_used vs billing ai_credit/usage for the same user+day.");
manual("C15", "Disable the 'Copilot usage metrics' org policy; record the exact status/body from a report endpoint; re-enable.");
manual("C16", "In an org with a <5-seat team, confirm the team is absent from user-teams-1-day (vs present-with-nulls).");
