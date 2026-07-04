// W0-A live verification — OpenAI Usage & Costs (Admin) API.
// Covers NLV-O1(partial), O2, O3(observational), O5, O8, O10, O11, O13.
// Env: OPENAI_ADMIN_KEY (sk-admin-…); optional OPENAI_PROJECT_KEY (sk-proj-…).
import { env, section, finding, manual, call, shape, daysAgo } from "./_lib.mjs";

const adminKey = env("OPENAI_ADMIN_KEY");
const projKey = env("OPENAI_PROJECT_KEY", { optional: true });
const api = (path, tok = adminKey) =>
  call(`https://api.openai.com${path}`, { headers: { authorization: `Bearer ${tok}` } });
const unix = (d) => Math.floor(d.getTime() / 1000);

section("NLV-O1 (partial): user_id semantics — grouped usage vs org members");
{
  const start = unix(daysAgo(7));
  const r = await api(`/v1/organization/usage/completions?start_time=${start}&bucket_width=1d&group_by=user_id&limit=7`);
  finding("O1", "status", r.status);
  const results = (r.body?.data ?? []).flatMap((b) => b.results ?? []);
  const uids = [...new Set(results.map((x) => x.user_id).filter(Boolean))];
  finding("O1", "rows / distinct user_ids / null-user rows", { rows: results.length, distinct: uids.length, nullRows: results.filter((x) => !x.user_id).length });
  const users = await api(`/v1/organization/users?limit=100`);
  const orgIds = (users.body?.data ?? []).map((u) => u.id);
  finding("O1", "user_ids joining /organization/users", uids.filter((u) => orgIds.includes(u)).length + "/" + uids.length);
  manual("O1", "Full test: (a) call chat completions with a SERVICE-ACCOUNT key passing safety_identifier:'probe-user'; (b) call with a USER-OWNED key and no user field; wait ~10 min; re-run this section. Expect (a) → user_id null, (b) → key owner's user-… id.");
}

section("NLV-O2: project-key rejection shape");
if (projKey) {
  for (const p of [`/v1/organization/usage/completions?start_time=${unix(daysAgo(2))}`, `/v1/organization/costs?start_time=${unix(daysAgo(2))}`]) {
    const r = await api(p, projKey);
    finding("O2", p.split("?")[0], { status: r.status, error: r.body?.error?.message?.slice(0, 120), code: r.body?.error?.code });
  }
} else {
  manual("O2", "Set OPENAI_PROJECT_KEY to record the exact 401/403 status + error body a project key receives.");
}

section("NLV-O5: historical depth at 1d / 1h / 1m");
for (const [bw, back] of [["1d", 30], ["1d", 90], ["1d", 180], ["1d", 400], ["1h", 90], ["1m", 90]]) {
  const start = unix(daysAgo(back));
  const end = unix(daysAgo(back - (bw === "1d" ? 7 : 1)));
  const r = await api(`/v1/organization/usage/completions?start_time=${start}&end_time=${end}&bucket_width=${bw}&group_by=model`);
  const buckets = r.body?.data ?? [];
  finding("O5", `${bw} @ D-${back}`, {
    status: r.status,
    buckets: buckets.length,
    nonEmpty: buckets.filter((b) => (b.results ?? []).length).length,
    error: r.body?.error?.message?.slice(0, 100),
  });
}

section("NLV-O8: UTC bucketing + zero-fill");
{
  const start = unix(daysAgo(3));
  const r = await api(`/v1/organization/usage/completions?start_time=${start}&bucket_width=1d&limit=3`);
  const buckets = r.body?.data ?? [];
  finding("O8", "bucket start_times (UTC-midnight check)", buckets.map((b) => new Date(b.start_time * 1000).toISOString()));
  finding("O8", "buckets with empty results[] present (zero-fill)?", buckets.filter((b) => !(b.results ?? []).length).length + "/" + buckets.length);
}

section("NLV-O10: file_search_calls / web_search_calls result objects");
for (const ep of ["file_search_calls", "web_search_calls"]) {
  const r = await api(`/v1/organization/usage/${ep}?start_time=${unix(daysAgo(30))}&bucket_width=1d&group_by=user_id`);
  const res = (r.body?.data ?? []).flatMap((b) => b.results ?? []);
  finding("O10", ep, { status: r.status, objectName: res[0]?.object ?? "no data", keys: res[0] ? Object.keys(res[0]) : [] });
}

section("NLV-O11: costs group_by=api_key_id + filter");
{
  const r = await api(`/v1/organization/costs?start_time=${unix(daysAgo(14))}&group_by=api_key_id&limit=14`);
  const res = (r.body?.data ?? []).flatMap((b) => b.results ?? []);
  finding("O11", "status / rows / sample keys", { status: r.status, rows: res.length, keys: res[0] ? Object.keys(res[0]) : [] });
  finding("O9", "distinct line_item values (coverage check vs invoice)", [...new Set(res.map((x) => x.line_item).filter(Boolean))].slice(0, 20));
}

section("NLV-O13: /v1/organization/groups availability");
{
  const r = await api(`/v1/organization/groups?limit=5`);
  finding("O13", "status + shape", { status: r.status, shape: r.status === 200 ? shape(r.body) : r.body?.error?.message?.slice(0, 100) });
}

section("Remaining manual checks");
manual("O3", "Confirm in the org UI that a non-Owner member cannot create admin keys; confirm admin-key creation works on a fresh tier-1 org.");
manual("O4", "Repeat this entire script with an admin key from a PERSONAL (org-of-one) account — Personal-mode feasibility.");
manual("O6", "Loop a paginated usage call at increasing rates until 429; record threshold and Retry-After / x-ratelimit-* headers.");
manual("O7", "Generate one completion; poll usage (1m buckets) until it appears (record lag); check costs next day.");
manual("O9", "Diff the line_item list above against a real monthly invoice for missing products (fine-tuning, storage, etc.).");
manual("O12", "Create an admin key with expires_in_seconds=120; after expiry record exact status/error body.");
manual("O14", "From a logged-in browser, re-confirm help articles 9687866 (owner-only admin keys) and the RBAC usage-visibility matrix.");
