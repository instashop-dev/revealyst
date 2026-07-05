// Deterministic scrubber for recorded vendor payloads (W1-S fixture
// pipeline). Recorded real API responses are committed to
// fixtures/vendor-payloads/ ONLY after passing through this module: every
// identifying value (emails, ids, key names) is replaced with a stable
// pseudonym so cross-file joins survive, while token/spend numbers — the
// data connectors actually normalize — are left untouched.
//
// Determinism contract: within one recording run the same real value always
// maps to the same pseudonym (a run shares one scrubber instance). Re-runs
// rewrite recordings wholesale, so cross-run stability is not required.

/** Object keys whose string values are identifying, by category. */
const KEY_CATEGORIES = {
  email: ["email", "email_address"],
  api_key_name: ["api_key_name"],
  name: ["name", "display_name", "full_name"],
  org: ["organization_id"],
  workspace: ["workspace_id"],
  api_key: ["api_key_id"],
  account: ["account_id", "account_ids"],
  service_account: ["service_account_id"],
  user: ["user_id", "user_ids"],
  rbac_group: ["rbac_group_id"],
};

const CATEGORY_FORMAT = {
  email: (n) => `user-${n}@scrubbed.example`,
  api_key_name: (n) => `api-key-${n}`,
  name: (n) => `name-${n}`,
  org: (n) => `org_scrub_${n}`,
  workspace: (n) => `wrkspc_scrub_${n}`,
  api_key: (n) => `apikey_scrub_${n}`,
  account: (n) => `acct_scrub_${n}`,
  service_account: (n) => `svcacct_scrub_${n}`,
  user: (n) => `user_scrub_${n}`,
  rbac_group: (n) => `rbac_scrub_${n}`,
};

const KEY_TO_CATEGORY = new Map();
for (const [category, keys] of Object.entries(KEY_CATEGORIES)) {
  for (const k of keys) KEY_TO_CATEGORY.set(k, category);
}

const ANTHROPIC_KEY_RE = /sk-ant-[A-Za-z0-9_-]{4,}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function createScrubber() {
  // category -> Map(realValue -> pseudonym)
  const maps = new Map();

  function mapped(category, value) {
    if (!maps.has(category)) maps.set(category, new Map());
    const m = maps.get(category);
    if (!m.has(value)) m.set(value, CATEGORY_FORMAT[category](m.size + 1));
    return m.get(value);
  }

  // Catch identifying values that appear OUTSIDE a known key (e.g. an email
  // embedded in a free-text description).
  function scrubString(s) {
    return s
      .replace(ANTHROPIC_KEY_RE, "sk-ant-REDACTED")
      .replace(EMAIL_RE, (m) =>
        m.endsWith("@scrubbed.example") ? m : mapped("email", m.toLowerCase()),
      );
  }

  function scrub(value, keyHint = null) {
    if (typeof value === "string") {
      const category = keyHint ? KEY_TO_CATEGORY.get(keyHint) : undefined;
      if (category) return mapped(category, value);
      return scrubString(value);
    }
    if (Array.isArray(value)) {
      // Arrays under an identifying key (account_ids, user_ids) scrub each
      // element under that same key.
      return value.map((v) => scrub(v, keyHint));
    }
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
      return out;
    }
    return value; // numbers, booleans, null — the actual metric data
  }

  function summary() {
    const out = {};
    for (const [category, m] of maps) out[category] = m.size;
    return out;
  }

  return { scrub, summary };
}

/**
 * Post-scrub self-check, shared with the CI lint test
 * (tests/vendor-fixtures.test.ts): returns human-readable violations for any
 * identifying material that survived scrubbing. Empty array = clean.
 */
export function findScrubViolations(value, path = "$") {
  const violations = [];
  if (typeof value === "string") {
    if (/sk-ant-(?!REDACTED)/.test(value)) {
      violations.push(`${path}: unredacted Anthropic key material`);
    }
    for (const m of value.match(EMAIL_RE) ?? []) {
      if (!m.endsWith("@scrubbed.example")) {
        violations.push(`${path}: unscrubbed email address`);
      }
    }
    if (/\bBearer\s+[A-Za-z0-9._-]{16,}/.test(value)) {
      violations.push(`${path}: bearer token material`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => violations.push(...findScrubViolations(v, `${path}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      violations.push(...findScrubViolations(v, `${path}.${k}`));
    }
  }
  return violations;
}
