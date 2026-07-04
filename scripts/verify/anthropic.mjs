// W0-A live verification — Anthropic Admin (usage/cost), Claude Code Analytics,
// and optionally the claude.ai Enterprise Analytics API.
// Covers NLV-A1, A2, A3, A4, A5(headers only), A7, A8, A11, A12; A10 if Enterprise key set.
// Env: ANTHROPIC_ADMIN_KEY (sk-ant-admin01-…); optional ANTHROPIC_ANALYTICS_KEY (Enterprise).
import { env, section, finding, manual, call, shape, daysAgo, isoDay } from "./_lib.mjs";

const adminKey = env("ANTHROPIC_ADMIN_KEY");
const entKey = env("ANTHROPIC_ANALYTICS_KEY", { optional: true });
const H = { "x-api-key": adminKey, "anthropic-version": "2023-06-01" };
const api = (path) => call(`https://api.anthropic.com${path}`, { headers: H });

section("NLV-A1: OAuth/subscription actors in /usage_report/claude_code (bug #27780)");
{
  const customerTypes = new Set();
  const actorTypes = new Set();
  const subTypes = new Set();
  const perDayActors = {};
  for (let d = 2; d <= 8; d++) {
    const day = isoDay(daysAgo(d));
    const r = await api(`/v1/organizations/usage_report/claude_code?starting_at=${day}&limit=1000`);
    if (r.status !== 200) { finding("A1", `${day} status`, { status: r.status, err: shape(r.body) }); continue; }
    const rows = r.body?.data ?? [];
    for (const row of rows) {
      customerTypes.add(row.customer_type);
      actorTypes.add(row.actor?.type);
      subTypes.add(String(row.subscription_type));
      const k = `${row.date}|${row.actor?.email_address ?? row.actor?.api_key_name}`;
      perDayActors[k] = (perDayActors[k] ?? 0) + 1;
    }
    finding("A1", `${day}`, { rows: rows.length, headers: r.headers });
  }
  finding("A1", "customer_type values seen (bug repro: only 'api' = bug present)", [...customerTypes]);
  finding("A1", "actor.type values seen", [...actorTypes]);
  finding("A1", "subscription_type values seen", [...subTypes]);
  const dupes = Object.entries(perDayActors).filter(([, n]) => n > 1);
  finding("A8", "actors with >1 record per (date, actor) — dedup key evidence", dupes.slice(0, 5).map(([k, n]) => `${n}× (redacted)`) .length ? `${dupes.length} duplicated actor-days` : "none — (date, actor) is unique");
}

section("NLV-A2: account_id group_by on messages usage report");
{
  const start = daysAgo(7).toISOString();
  const r = await api(`/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(start)}&bucket_width=1d&group_by[]=account_id&group_by[]=model`);
  finding("A2", "status", r.status);
  const results = (r.body?.data ?? []).flatMap((b) => b.results ?? []);
  const accountIds = [...new Set(results.map((x) => x.account_id).filter(Boolean))];
  finding("A2", "non-null account_id rows (OAuth attribution works?)", { rows: results.length, distinctAccounts: accountIds.length, idFormat: accountIds[0]?.slice(0, 8) ?? "none" });
  const users = await api(`/v1/organizations/users?limit=100`);
  const userIds = (users.body?.data ?? []).map((u) => u.id);
  finding("A2", "account_ids that join to /organizations/users ids", accountIds.filter((a) => userIds.includes(a)).length);
  finding("A12", "next_page shape on usage report", { has_more: r.body?.has_more, next_page_prefix: typeof r.body?.next_page === "string" ? r.body.next_page.slice(0, 12) : r.body?.next_page });
}

section("NLV-A3: usage/cost history floor (probe backwards)");
for (const back of [35, 95, 185, 400]) {
  const start = daysAgo(back).toISOString();
  const end = daysAgo(back - 5).toISOString();
  const u = await api(`/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(start)}&ending_at=${encodeURIComponent(end)}&bucket_width=1d`);
  const buckets = u.body?.data ?? [];
  const nonEmpty = buckets.filter((b) => (b.results ?? []).length).length;
  finding("A3", `usage D-${back}..D-${back - 5}`, { status: u.status, buckets: buckets.length, nonEmpty });
  if (u.status !== 200) break;
}

section("NLV-A4: /claude_code earliest retrievable date");
for (const back of [35, 95, 185, 400]) {
  const r = await api(`/v1/organizations/usage_report/claude_code?starting_at=${isoDay(daysAgo(back))}&limit=5`);
  finding("A4", `D-${back}`, { status: r.status, rows: r.body?.data?.length ?? 0, err: r.status !== 200 ? shape(r.body) : undefined });
  if (r.status !== 200) break;
}

section("NLV-A7: cost_type values in cost report (session_usage semantics)");
{
  const start = daysAgo(30).toISOString();
  const r = await api(`/v1/organizations/cost_report?starting_at=${encodeURIComponent(start)}&group_by[]=description`);
  const results = (r.body?.data ?? []).flatMap((b) => b.results ?? []);
  finding("A7", "distinct cost_type values", [...new Set(results.map((x) => x.cost_type))]);
  finding("A7", "distinct descriptions", [...new Set(results.map((x) => x.description))].slice(0, 15));
  finding("A7", "amount field type (decimal-string expected)", typeof results[0]?.amount);
}

if (entKey) {
  section("NLV-A10: Enterprise Analytics — rate-limit headers + availability lag");
  const EH = { "x-api-key": entKey, "anthropic-version": "2023-06-01" };
  for (const d of [2, 3, 4, 6]) {
    const r = await call(`https://api.anthropic.com/v1/organizations/analytics/summaries?starting_date=${isoDay(daysAgo(d))}&ending_date=${isoDay(daysAgo(d - 1))}`, { headers: EH });
    finding("A10", `summaries D-${d}`, { status: r.status, headers: r.headers, hasData: !!(r.body?.data ?? []).length });
  }
} else {
  manual("A6/A10", "With a claude.ai Enterprise org: create an Analytics key (read:analytics) and set ANTHROPIC_ANALYTICS_KEY. With a claude.ai TEAM org: confirm the Analytics-key creation UI is absent (NLV-A6) and note whether the dashboard CSV export could be automated.");
}

section("Remaining manual checks");
manual("A1", "Ensure the org has ≥1 developer using Claude Code via OAuth subscription auth during the probed window — otherwise 'only api' proves nothing.");
manual("A5", "Poll usage_report at >1 req/s during pagination until a 429; record status body and any ratelimit/retry-after headers.");
manual("A9", "Sum /claude_code model_breakdown.estimated_cost for one day vs cost_report for the same day; record divergence %.");
manual("A11", "On a Console org with subscription-auth Claude Code users and NO API-key usage that day: does the messages usage report show any tokens at all?");
