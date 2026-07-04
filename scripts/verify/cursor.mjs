// W0-A live verification — Cursor Admin + Analytics APIs.
// Covers NLV-U1, U2, U3, U4, U10, U11, U12(observational), U13(partial).
// Env: CURSOR_API_KEY (team admin key).
import { env, section, finding, manual, call, shape, daysAgo } from "./_lib.mjs";

const key = env("CURSOR_API_KEY");
const basic = { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
const api = (path, opts = {}) => call(`https://api.cursor.com${path}`, { headers: basic, ...opts });

section("NLV-U1: which endpoints work on this plan (record 200 vs 401/403)");
{
  const now = Date.now();
  const probes = [
    ["GET /teams/members", () => api("/teams/members")],
    ["POST /teams/daily-usage-data (7d)", () => api("/teams/daily-usage-data", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: now - 7 * 86400000, endDate: now } })],
    ["POST /teams/spend", () => api("/teams/spend", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: {} })],
    ["POST /teams/filtered-usage-events (7d)", () => api("/teams/filtered-usage-events", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: now - 7 * 86400000, endDate: now, pageSize: 25 } })],
    ["GET /analytics/team/dau (7d)", () => api("/analytics/team/dau?startDate=7d&endDate=today")],
    ["GET /analytics/by-user/models (7d)", () => api("/analytics/by-user/models?startDate=7d&endDate=today")],
    ["GET /analytics/ai-code/commits", () => api("/analytics/ai-code/commits?startDate=7d&endDate=today")],
    ["GET /teams/audit-logs", () => api("/teams/audit-logs")],
  ];
  for (const [label, fn] of probes) {
    const r = await fn();
    finding("U1", label, { status: r.status, shape: r.status === 200 ? shape(r.body) : r.body?.error ?? r.body?.message ?? String(r.body).slice(0, 120) });
  }
}

section("NLV-U4: undocumented fields in /teams/spend and daily-usage-data");
{
  const r = await api("/teams/spend", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: {} });
  const m = r.body?.teamMemberSpend?.[0];
  finding("U4", "spend top-level keys", Object.keys(r.body ?? {}));
  finding("U4", "member keys (diff vs docs: userId,name,email,role,spendCents,overallSpendCents,fastPremiumRequests,hardLimitOverrideDollars,monthlyLimitDollars)", m ? Object.keys(m) : "no members");
  const now = Date.now();
  const d = await api("/teams/daily-usage-data", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: now - 3 * 86400000, endDate: now, page: 1, pageSize: 5 } });
  finding("U4", "daily-usage-data row keys", d.body?.data?.[0] ? Object.keys(d.body.data[0]) : `status ${d.status}`);
}

section("NLV-U2: max lookback (walk 30-day windows backward)");
{
  for (const back of [30, 60, 90, 180, 365]) {
    const end = Date.now() - (back - 30) * 86400000;
    const start = Date.now() - back * 86400000;
    const r = await api("/teams/daily-usage-data", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: start, endDate: end, page: 1, pageSize: 1 } });
    finding("U2", `window ending D-${back - 30}`, { status: r.status, rows: r.body?.data?.length ?? 0, error: r.body?.error });
    if (r.status !== 200) break;
  }
}

section("NLV-U3: past billing cycles via /teams/groups?billingCycle=");
{
  for (const back of [1, 2, 3, 6]) {
    const cycle = daysAgo(back * 30).toISOString().slice(0, 10);
    const r = await api(`/teams/groups?billingCycle=${cycle}`);
    const g = r.body?.groups?.[0];
    finding("U3", `cycle ~${back} month(s) back (${cycle})`, { status: r.status, groups: r.body?.groups?.length ?? 0, dailySpendDays: g?.dailySpend?.length ?? 0 });
    if (r.status !== 200) break;
  }
}

section("NLV-U11: distinct `kind` values in usage events");
{
  const now = Date.now();
  const r = await api("/teams/filtered-usage-events", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: now - 30 * 86400000, endDate: now, page: 1, pageSize: 500 } });
  const events = r.body?.usageEvents ?? [];
  finding("U11", "distinct kind values", [...new Set(events.map((e) => e.kind))]);
  finding("U11", "event keys", events[0] ? Object.keys(events[0]) : "none");
  finding("U10", "pageSize=500 honored?", { requested: 500, returned: events.length, totalKeys: Object.keys(r.body ?? {}) });
}

section("NLV-U10: oversized window + burst behavior");
{
  const now = Date.now();
  const r = await api("/teams/filtered-usage-events", { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: { startDate: now - 120 * 86400000, endDate: now, page: 1, pageSize: 10 } });
  finding("U10", "120-day window (cap behavior)", { status: r.status, error: r.body?.error, rows: r.body?.usageEvents?.length });
  manual("U10/U13", "To measure 429s + Retry-After and whether the 20/min Admin limit is shared across endpoints, run ~25 rapid alternating calls to /teams/members and /teams/daily-usage-data and record which endpoint 429s first.");
}

section("Remaining manual checks");
manual("U5", "If you hold a legacy key_ prefixed key, test whether it still authenticates.");
manual("U6", "Send a daily-usage-data range straddling UTC midnight after generating activity at a known local time; check which `day` the activity lands in.");
manual("U7", "Generate activity, then poll daily-usage-data hourly; record lag and whether past rows mutate at 24/48/72h.");
manual("U8", "With one privacy-mode-forced user, diff their rows vs a non-privacy user across all three surfaces.");
manual("U9", "On an individual Pro account, check cursor.com/dashboard → Usage for a CSV export; save its header row (schema) if present.");
manual("U12", "Re-run this script against a 1-seat Teams org (Personal-as-org-of-one feasibility).");
