// Shared helpers for W0-A verification scripts. Node >= 18, no dependencies.

export function env(name, { optional = false } = {}) {
  const v = process.env[name];
  if (!v && !optional) {
    console.error(`Missing env var ${name} — see scripts/verify/README.md`);
    process.exit(1);
  }
  return v;
}

export function section(title) {
  console.log(`\n${"=".repeat(70)}\n## ${title}\n${"=".repeat(70)}`);
}

export function finding(id, label, value) {
  console.log(`[${id}] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

export function manual(id, instruction) {
  console.log(`[${id}] MANUAL: ${instruction}`);
}

const SAFE_HEADERS = [
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-used",
  "x-ratelimit-reset", "x-ratelimit-resource", "retry-after",
  "x-github-api-version-selected", "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining", "content-type", "content-encoding",
];

export function safeHeaders(res) {
  const out = {};
  for (const h of SAFE_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  return out;
}

// GET/POST JSON; returns {status, headers, body} and never throws on HTTP errors.
export async function call(url, { method = "GET", headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { accept: "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 2000); }
    return { status: res.status, headers: safeHeaders(res), body: parsed };
  } catch (e) {
    return { status: -1, headers: {}, body: String(e) };
  }
}

// Summarize a JSON value's shape without dumping payload contents.
export function shape(v, depth = 0) {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return v.length ? `[${v.length}× ${shape(v[0], depth + 1)}]` : "[]";
  if (typeof v === "object") {
    if (depth >= 3) return "{…}";
    return `{${Object.keys(v).slice(0, 30).map((k) => `${k}: ${shape(v[k], depth + 1)}`).join(", ")}}`;
  }
  return typeof v;
}

export const daysAgo = (n) => new Date(Date.now() - n * 86400000);
export const isoDay = (d) => d.toISOString().slice(0, 10);
