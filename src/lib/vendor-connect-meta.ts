// Client-safe vendor metadata for connect/manage UI (onboarding wizard +
// connections page). Deliberately NOT derived from src/connectors/registry.ts:
// the registry fills via server-only side-effect imports and would be empty in
// a client bundle. tests/vendor-connect-meta.test.ts is the drift guard — it
// fails if this list and the registered connectors diverge. Table labels come
// from vendor-labels.ts; this module owns the connect-flow copy.

/** A key-based vendor connectable right now. */
export type KeyVendor = {
  vendor: "anthropic_console" | "openai" | "cursor";
  /** connections.auth_kind for the created row (credential PUT kind is
   * always "api_key"; the poller maps admin_key → api_key too). */
  authKind: "api_key" | "admin_key";
  label: string;
  blurb: string;
  placeholder: string;
  keyHint: string;
};

export const KEY_VENDORS: KeyVendor[] = [
  {
    vendor: "anthropic_console",
    authKind: "api_key",
    label: "Anthropic",
    blurb: "Console usage + cost and Claude Code analytics.",
    placeholder: "sk-ant-…",
    keyHint: "Admin API key from console.anthropic.com → Settings → API keys.",
  },
  {
    vendor: "openai",
    authKind: "api_key",
    label: "OpenAI",
    blurb: "Personal usage + spend from your OpenAI API key.",
    placeholder: "sk-…",
    keyHint: "API key from platform.openai.com → API keys.",
  },
  {
    vendor: "cursor",
    authKind: "admin_key",
    label: "Cursor",
    blurb: "Team usage + per-request events from the Cursor Admin API.",
    placeholder: "crsr_…",
    keyHint:
      "Team admin API key from the Cursor dashboard → API Keys (team/enterprise plans — individual plans have no usage API).",
  },
];

/** A vendor connected via a GitHub App install redirect (not a key paste).
 * The "Connect" button links to `setupPath`, which starts the App install and
 * returns to the callback that creates the connection (W4-T). */
export type GithubAppVendor = {
  vendor: "github_copilot";
  label: string;
  blurb: string;
  /** Route that begins the GitHub App install (a plain <a>, never <Link> —
   * it 30x's to github.com). */
  setupPath: string;
  /** Honest plan/permission requirement copy (never over-promised). */
  requirements: string;
};

export const GITHUB_APP_VENDORS: GithubAppVendor[] = [
  {
    vendor: "github_copilot",
    label: "GitHub Copilot",
    blurb:
      "Org usage metrics via the Revealyst GitHub App — per-user daily activity, acceptance, agent usage, and AI Credits (org daily grain; no hour-by-hour signal).",
    setupPath: "/api/integrations/github/setup",
    requirements:
      "Copilot Business or Enterprise with the “Copilot usage metrics” policy on. An org owner installs the read-only Revealyst GitHub App; individual plans get spend context only, not usage metrics.",
  },
];

/**
 * Registered connectors whose LIVE integration is still founder-gated (NLV
 * run + deploy secrets pending), per the "never present-tense an unshipped
 * connector" rule (Spec V3 §10.1 / the thrice-relearned W3 lesson):
 *
 * - The MARKETING landing "Connects" strip keeps these in the "Soon" list —
 *   statically (the marketing page must stay statically renderable; no
 *   runtime env check there). **Founder flip after the NLV run passes:
 *   remove the vendor from this array — one line** (ADR 0022;
 *   scripts/verify/copilot.mjs prints the reminder).
 * - The APP connect surfaces gate on the runtime env instead (the GitHub App
 *   secrets being configured — see `readCopilotAppConfig`), so they flip
 *   automatically when secrets sync, independent of this list.
 *
 * A drift test asserts every entry has a registered connector — an entry for
 * an unregistered vendor is stale and fails the sweep.
 */
export const NLV_PENDING_VENDORS: readonly string[] = ["github_copilot"];

// Everything key-based or GitHub-App-based now has a connect path; nothing is
// "coming soon" on the connect surface today. (Individual Copilot usage
// metrics still don't exist as an API — that honesty lives in the GitHub App
// requirements copy above, not a dead card.)
export const COMING_SOON: { label: string; note: string }[] = [];
