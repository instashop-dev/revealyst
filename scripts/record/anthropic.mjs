// W1-S recorded-payload pipeline — Anthropic recorder (founder-run, live keys).
//
// Records REAL responses from the Anthropic Console Admin API (usage report,
// cost report, Claude Code Analytics) and, when an Enterprise Analytics key
// is present, the claude.ai Enterprise Analytics API. Each response page is
// scrubbed (scripts/record/scrub.mjs) and written to
// fixtures/vendor-payloads/<vendor>/ as a RawPayloadEnvelope fixture that
// connector normalize() tests replay (rule 2: recorded real, not hand-written).
//
// Read-only: every call is a GET report endpoint. Keys come from env vars
// only and are never written to disk; the scrub self-check refuses to write
// any file that still contains identifying material.
//
// Usage (PowerShell):
//   $env:ANTHROPIC_ADMIN_KEY = "<sk-ant-admin01-...>"
//   node scripts/record/anthropic.mjs
// Optional env: ANTHROPIC_ANALYTICS_KEY (Enterprise), RECORD_DAYS (default 30).
//
// Endpoint facts (windows, bucket caps, param styles): docs/connector-facts.md §3.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, section, finding, daysAgo, isoDay } from "../verify/_lib.mjs";
import { createScrubber, findScrubViolations } from "./scrub.mjs";

const adminKey = env("ANTHROPIC_ADMIN_KEY");
const entKey = env("ANTHROPIC_ANALYTICS_KEY", { optional: true });
const RECORD_DAYS = Number(process.env.RECORD_DAYS ?? 30);
const OUT_ROOT = join(process.cwd(), "fixtures", "vendor-payloads");

const scrubber = createScrubber();
const written = [];

function headers(key) {
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "user-agent": "revealyst-w1s-recorder",
  };
}

// GET with 429 retry; returns {status, body} — never throws on HTTP errors.
async function get(url, key) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: headers(key) });
    if (res.status === 429 && attempt <= 3) {
      const wait = Number(res.headers.get("retry-after") ?? 15);
      finding("rate", `429 — waiting ${wait}s`, url.split("?")[0]);
      await sleep(wait * 1000);
      continue;
    }
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { status: res.status, body };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scrub, self-check, write one RawPayloadEnvelope fixture file. */
function record(vendor, kind, window, payload, { endpoint, page }) {
  const fixture = {
    meta: {
      vendor,
      recordedAt: new Date().toISOString(),
      script: "scripts/record/anthropic.mjs",
      scrubbed: true,
      endpoint,
      status: 200,
      ...(page > 1 ? { page } : {}),
    },
    envelope: { kind, window, payload: scrubber.scrub(payload) },
  };
  const violations = findScrubViolations(fixture.envelope.payload);
  if (violations.length) {
    console.error(`REFUSING to write ${kind}: scrub violations remain`);
    for (const v of violations.slice(0, 10)) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  const dir = join(OUT_ROOT, vendor);
  mkdirSync(dir, { recursive: true });
  const windowPart = window ? `${window.start.slice(0, 10)}` : "nowindow";
  const kindPart = kind.split(".")[1].replaceAll("_", "-");
  const file = join(dir, `${kindPart}.${windowPart}${page > 1 ? `.p${page}` : ""}.json`);
  writeFileSync(file, JSON.stringify(fixture, null, 2) + "\n");
  written.push(file);
}

/** Walk a paginated report endpoint, recording every non-empty page. */
async function recordPaginated(vendor, kind, window, baseUrl, key, endpoint) {
  let page = 1;
  let url = baseUrl;
  for (;;) {
    const r = await get(url, key);
    if (r.status !== 200) {
      finding("skip", `${kind} status ${r.status}`, typeof r.body === "string" ? r.body : JSON.stringify(r.body).slice(0, 200));
      return { pages: 0, rows: 0 };
    }
    const rows = (r.body?.data ?? []).length;
    if (rows > 0) record(vendor, kind, window, r.body, { endpoint, page });
    if (!r.body?.has_more || !r.body?.next_page) return { pages: page, rows };
    page += 1;
    const sep = baseUrl.includes("?") ? "&" : "?";
    url = `${baseUrl}${sep}page=${encodeURIComponent(r.body.next_page)}`;
    await sleep(300);
  }
}

const API = "https://api.anthropic.com";
const CONSOLE = "anthropic_console";
const ENTERPRISE = "anthropic_claude_enterprise";

// ---------------------------------------------------------------------------
section(`Console: Claude Code Analytics — last ${RECORD_DAYS} days (one call per day)`);
// Data only returned >1h old and freshness ~1h; start at D-2 like the verify
// script to avoid guaranteed-empty days.
for (let d = 2; d < RECORD_DAYS + 2; d++) {
  const day = isoDay(daysAgo(d));
  const { rows } = await recordPaginated(
    CONSOLE,
    "anthropic_console.claude_code",
    { start: day, end: day },
    `${API}/v1/organizations/usage_report/claude_code?starting_at=${day}&limit=1000`,
    adminKey,
    "/v1/organizations/usage_report/claude_code",
  );
  finding("claude_code", day, rows ? `${rows} rows` : "empty (not written)");
  await sleep(300);
}

// ---------------------------------------------------------------------------
section("Console: messages usage report — 1d buckets, ≤31-bucket windows");
// group_by matches what the connector will request: per-key/workspace/model,
// plus account_id (the NLV-A2 OAuth-attribution probe).
const usageGroupBy = "group_by[]=api_key_id&group_by[]=workspace_id&group_by[]=model&group_by[]=account_id";
for (let start = RECORD_DAYS; start > 0; start -= 31) {
  const winDays = Math.min(31, start);
  const startAt = daysAgo(start).toISOString();
  const endAt = daysAgo(start - winDays).toISOString();
  const window = { start: startAt, end: endAt };
  const { pages, rows } = await recordPaginated(
    CONSOLE,
    "anthropic_console.usage_messages_1d",
    window,
    `${API}/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startAt)}&ending_at=${encodeURIComponent(endAt)}&bucket_width=1d&${usageGroupBy}`,
    adminKey,
    "/v1/organizations/usage_report/messages",
  );
  finding("usage", `${startAt.slice(0, 10)}..${endAt.slice(0, 10)}`, { pages, lastPageRows: rows });
  await sleep(300);
}

// ---------------------------------------------------------------------------
section("Console: cost report — 1d only, ≤31-bucket windows");
for (let start = RECORD_DAYS; start > 0; start -= 31) {
  const winDays = Math.min(31, start);
  const startAt = daysAgo(start).toISOString();
  const endAt = daysAgo(start - winDays).toISOString();
  const window = { start: startAt, end: endAt };
  const { pages, rows } = await recordPaginated(
    CONSOLE,
    "anthropic_console.cost_1d",
    window,
    `${API}/v1/organizations/cost_report?starting_at=${encodeURIComponent(startAt)}&ending_at=${encodeURIComponent(endAt)}&group_by[]=description&group_by[]=workspace_id`,
    adminKey,
    "/v1/organizations/cost_report",
  );
  finding("cost", `${startAt.slice(0, 10)}..${endAt.slice(0, 10)}`, { pages, lastPageRows: rows });
  await sleep(300);
}

// ---------------------------------------------------------------------------
if (entKey) {
  section("Enterprise Analytics: summaries + users + usage/cost reports");
  const span = Math.min(RECORD_DAYS, 31); // ≤31-day usage/cost span per request
  const startDate = isoDay(daysAgo(span + 1));
  const endDate = isoDay(daysAgo(1));
  const window = { start: startDate, end: endDate };
  const ent = (kind, url, endpoint) =>
    recordPaginated(ENTERPRISE, kind, window, url, entKey, endpoint);

  await ent(
    "anthropic_claude_enterprise.summaries",
    `${API}/v1/organizations/analytics/summaries?starting_date=${startDate}&ending_date=${endDate}`,
    "/v1/organizations/analytics/summaries",
  );
  await ent(
    "anthropic_claude_enterprise.users",
    `${API}/v1/organizations/analytics/users?starting_date=${startDate}&ending_date=${endDate}&limit=1000`,
    "/v1/organizations/analytics/users",
  );
  await ent(
    "anthropic_claude_enterprise.usage_report_1d",
    `${API}/v1/organizations/analytics/usage_report?starting_date=${startDate}&ending_date=${endDate}&bucket_width=1d`,
    "/v1/organizations/analytics/usage_report",
  );
  await ent(
    "anthropic_claude_enterprise.cost_report_1d",
    `${API}/v1/organizations/analytics/cost_report?starting_date=${startDate}&ending_date=${endDate}&bucket_width=1d`,
    "/v1/organizations/analytics/cost_report",
  );
} else {
  finding("enterprise", "skipped", "set ANTHROPIC_ANALYTICS_KEY to record Enterprise Analytics payloads");
}

// ---------------------------------------------------------------------------
section("Summary");
finding("written", `${written.length} fixture files`, written.map((f) => f.replace(process.cwd(), ".")));
finding("scrub", "pseudonyms assigned per category", scrubber.summary());
console.log(
  "\nNext: review the files, run `npm test` (tests/vendor-fixtures.test.ts " +
    "validates shape + scrub), then commit under fixtures/vendor-payloads/.",
);
