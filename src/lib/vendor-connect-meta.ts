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

// Individual Copilot exposes no metrics API — honest, not a dead form.
export const COMING_SOON = [
  { label: "GitHub Copilot", note: "Individual plans have no metrics API yet." },
];
