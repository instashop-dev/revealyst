// The privacy/status screens' disclosure source of truth.
//
// LAW 3 (cross-cutting): the "what leaves / what never leaves this computer"
// FIELD claims are NEVER hand-written in a screen. They render from the
// checked-in allowlist artifact
// (`src-tauri/generated/allowlist.json`), which is generated FROM
// `src/lib/agent-collection-schema.ts` by `npm run generate:desktop-allowlist`.
// Importing that JSON at build time binds the UI to the collector's real
// allowlist projection: a rendered claim cannot drift from what the agent
// actually sends, because both come from the same generated file. There is no
// Tauri command in this path — the artifact is a static build input, so a
// narrow compile-time import is the smallest honest binding.
//
// This is the desktop analogue of the web `scope-claims.ts` discipline (W3-N /
// W3-P): a claim surface must render from a registry, never from prose typed
// into a component.
import allowlist from "../../src-tauri/generated/allowlist.json";

/** One collected field, as described by the generated allowlist. */
export type DisclosureField = {
  /** Machine field name (e.g. `usage.input_tokens`). */
  field: string;
  /** Plain-English label shown to the user. */
  label: string;
  /** Plain-English purpose / handling note. */
  purpose: string;
  /** Whether this field's VALUE leaves the device. */
  sent: boolean;
};

const FIELDS: DisclosureField[] = allowlist.fields;

/** Fields whose value leaves this computer (`sent: true`). Rendered under
 * "What leaves this computer". */
export const SENT_FIELDS: DisclosureField[] = FIELDS.filter((f) => f.sent);

/** Fields read on-device but whose value NEVER leaves (`sent: false`).
 * Rendered under "What never leaves this computer". */
export const ON_DEVICE_ONLY_FIELDS: DisclosureField[] = FIELDS.filter(
  (f) => !f.sent,
);

/** Categories of data the collector never even reads. Rendered as the
 * strongest "never leaves" guarantee. */
export const NEVER_COLLECTED: string[] = allowlist.neverCollected;

/**
 * The T3.2 encryption-disclosure delta — the HONEST boundary of the
 * application-layer field encryption this app ships (it does NOT whole-file /
 * SQLCipher encrypt). Invariant (b): we disclose exactly what is and isn't
 * protected, never claiming more.
 *
 * SOURCE OF TRUTH for the wording: the "Privacy-disclosure delta" docstring in
 * `src-tauri/src/store/mod.rs`. Mirror any change there in the same PR — the
 * same mirror discipline `state.ts` follows for `state.rs`.
 */
export const ENCRYPTION_DISCLOSURE =
  "The activity details this app queues are encrypted one by one with " +
  "AES-256-GCM, using a key kept only in your operating system's secure " +
  "keychain. The database file itself is a standard file in a protected app " +
  "folder: its structure and bookkeeping — timestamps, counts, sync status, " +
  "and connector names — can be read if someone copies the file, but the " +
  "encrypted activity contents cannot.";

/**
 * Sources that are NOT supported in Phase 1 — surfaced honestly on the status
 * screen's "Unsupported sources" row so users are never left to assume
 * coverage that doesn't exist. Claude Desktop (the chat app) is a distinct
 * product from Claude Code; the agent reads Claude Code's local logs only.
 */
export const UNSUPPORTED_SOURCES: string[] = [
  "Claude Desktop: detailed conversation sync is not available in Phase 1",
];

/**
 * Coverage limitations for what the agent CAN measure — the honest caveats
 * shown on the status screen. Kept minimal and Phase-1 accurate.
 */
export const COVERAGE_LIMITATIONS: string[] = [
  "Only your own Claude Code activity on this computer is measured",
  "Spend is estimated from token counts — the local logs don't include exact cost",
];
