// Signed remote configuration for the desktop agent (Desktop Agent plan T4.2,
// spec §17). The server composes a small config object, Ed25519-signs its
// canonical JSON, and serves `{...config, signature}` from
// GET /api/desktop/config (device-token authed).
//
// THE NEVER-BROADEN LAW (spec §16.2 + §29 + plan law 1). Remote config must
// never silently increase collection scope. In Phase 1 the ONLY content mode
// is Analytics Only, so `defaultContentMode` is pinned to `"analytics_only"`
// two ways that back each other up:
//   1. Structurally — `DesktopContentMode` is the single literal type
//      `"analytics_only"`, so a broader value cannot even be constructed.
//   2. At runtime — `composeDesktopConfig` asserts the value before returning,
//      so if this file ever grows a broader union the assert fails loudly
//      rather than shipping a widening config.
// The agent applies a THIRD check independently (`defaultContentMode` ≤ local
// mode → else `policy_blocked`); a signed config can DISABLE collection but a
// verified-and-broader config is still refused agent-side.
//
// Pure WebCrypto (`crypto.subtle` Ed25519) — identical on workerd, Node, and
// vitest (verified against Node 24 + the Cloudflare runtime, both of which
// ship Ed25519 in Web Crypto). No JS crypto dependency is added: the Workers
// runtime provides the primitive, so we prefer it over @noble/ed25519.
//
// Keys are imported per call — nothing cached at module scope (Workers cancel
// cross-request I/O).

// ---------------------------------------------------------------------------
// Config shape (spec §17.2)
// ---------------------------------------------------------------------------

/**
 * The ONLY content mode implemented in Phase 1. Kept as a single-literal type
 * on purpose: a broader value (`redacted_summary`, `full_content`) is not
 * representable, so the never-broaden law is enforced by the type system in
 * addition to the runtime assert in `composeDesktopConfig`.
 */
export type DesktopContentMode = "analytics_only";

/** The pinned Phase-1 content mode. Hard-coded; never derived from input. */
export const DESKTOP_DEFAULT_CONTENT_MODE: DesktopContentMode = "analytics_only";

/** Update channels (spec §18.2). */
export type DesktopUpdateChannel = "internal" | "beta" | "stable";

/** Per-connector enablement entry (spec §17.2 `connectors` map). */
export type DesktopConnectorConfig = {
  enabled: boolean;
  minimumVersion: string;
  pollIntervalSeconds: number;
};

/**
 * The UNSIGNED config body. The Ed25519 signature covers the canonical JSON of
 * exactly this object; the served response is this object plus a `signature`
 * field (which is NOT part of the signed bytes).
 */
export type DesktopConfig = {
  /** Monotonic config revision. Bump `DESKTOP_CONFIGURATION_VERSION` when any
   * field below changes so the agent can detect a newer config. */
  configurationVersion: number;
  /** ISO-8601 UTC. When this config was minted. */
  issuedAt: string;
  /** ISO-8601 UTC. After this the agent must treat the config as stale
   * (keep-last-valid-unexpired, else restrictive built-ins). */
  expiresAt: string;
  /** SemVer floor: agents below this must update before continuing. */
  minimumAgentVersion: string;
  /** ALWAYS `"analytics_only"` in Phase 1 (never-broaden law). */
  defaultContentMode: DesktopContentMode;
  /** Which local sources are enabled + their poll cadence. */
  connectors: {
    claude_code: DesktopConnectorConfig;
  };
  /** Which auto-update channel this fleet follows. */
  updateChannel: DesktopUpdateChannel;
  /** Emergency kill switch: when true the agent halts ALL connector
   * collection regardless of per-connector `enabled` (spec §17.1). */
  emergencyShutdown: boolean;
  /** Which signing key produced the signature — lets the agent select the
   * correct baked-in public key across a key rotation (see rotation note
   * below). Covered by the signature, so it cannot be swapped. */
  signingKeyVersion: string;
};

/** The served payload: the signed body plus its detached signature. */
export type SignedDesktopConfig = DesktopConfig & {
  /** Base64 (standard, not base64url) of the 64-byte Ed25519 signature over
   * the canonical JSON of the body WITHOUT this field. */
  signature: string;
};

// ---------------------------------------------------------------------------
// Phase-1 defaults (the source of truth — there is no admin UI or config table
// yet, so these constants ARE the fleet config; bump the version on change)
// ---------------------------------------------------------------------------

/** Bump this whenever any default below changes (spec §17.2
 * `configurationVersion`). Monotonic. */
export const DESKTOP_CONFIGURATION_VERSION = 1;

/** Config validity window. A signed config is served fresh on every request,
 * but the agent caches the last one it fetched; this bounds how long a cached
 * config stays usable if the agent goes offline. */
export const DESKTOP_CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** SemVer floor for agents (spec §17.1 minimum agent version). */
export const DESKTOP_MINIMUM_AGENT_VERSION = "0.1.0";

/** Default per-connector config for the only Phase-1 source. */
export const DESKTOP_CLAUDE_CODE_DEFAULT: DesktopConnectorConfig = {
  enabled: true,
  minimumVersion: "0.1.0",
  pollIntervalSeconds: 30,
};

/** Default update channel for the general fleet. */
export const DESKTOP_DEFAULT_UPDATE_CHANNEL: DesktopUpdateChannel = "stable";

/** Sane bounds for a signed poll cadence (inclusive). A config below the floor
 * would hammer the vendor surface; above the ceiling it is effectively off and
 * a typo'd huge value should not be silently trusted. Enforced fail-closed so
 * a future admin path can never get an out-of-range cadence SIGNED. */
export const DESKTOP_MIN_POLL_INTERVAL_SECONDS = 5;
export const DESKTOP_MAX_POLL_INTERVAL_SECONDS = 24 * 60 * 60; // 1 day

/** A plain `MAJOR.MINOR.PATCH` version — all our version fields (agent +
 * connector minimums) use this shape; anything else is rejected before it can
 * be signed and trusted by the agent. */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Optional overrides for tests / future admin control. `defaultContentMode`
 * is deliberately NOT overridable — it is always `analytics_only`. */
export type ComposeDesktopConfigInput = {
  now?: number;
  configurationVersion?: number;
  minimumAgentVersion?: string;
  updateChannel?: DesktopUpdateChannel;
  emergencyShutdown?: boolean;
  claudeCode?: DesktopConnectorConfig;
  signingKeyVersion: string;
};

function assertSemver(value: string, field: string): void {
  if (!SEMVER_RE.test(value)) {
    throw new Error(
      `desktop config ${field} must be MAJOR.MINOR.PATCH, got ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Fail-closed validation of a connector override (never used by the route
 * today, but a future admin path could supply one — an out-of-range or
 * malformed value must never get SIGNED and trusted by the agent). Rejects a
 * malformed `minimumVersion` and a `pollIntervalSeconds` outside the sane
 * bounded range; throws rather than silently clamping so a mistaken value is
 * surfaced, not quietly reshaped.
 */
function validateConnectorConfig(
  connector: DesktopConnectorConfig,
  field: string,
): void {
  assertSemver(connector.minimumVersion, `${field}.minimumVersion`);
  const poll = connector.pollIntervalSeconds;
  if (
    !Number.isInteger(poll) ||
    poll < DESKTOP_MIN_POLL_INTERVAL_SECONDS ||
    poll > DESKTOP_MAX_POLL_INTERVAL_SECONDS
  ) {
    throw new Error(
      `desktop config ${field}.pollIntervalSeconds must be an integer in [${DESKTOP_MIN_POLL_INTERVAL_SECONDS}, ${DESKTOP_MAX_POLL_INTERVAL_SECONDS}], got ${JSON.stringify(poll)}`,
    );
  }
}

/**
 * Compose the (unsigned) config body. `defaultContentMode` is hard-coded to
 * `analytics_only` and then re-asserted — the never-broaden law (spec §16.2)
 * lives here, not only in the type. There is no input that can widen it.
 */
export function composeDesktopConfig(
  input: ComposeDesktopConfigInput,
): DesktopConfig {
  const now = input.now ?? Date.now();
  const minimumAgentVersion =
    input.minimumAgentVersion ?? DESKTOP_MINIMUM_AGENT_VERSION;
  assertSemver(minimumAgentVersion, "minimumAgentVersion");
  const claudeCode = input.claudeCode ?? DESKTOP_CLAUDE_CODE_DEFAULT;
  validateConnectorConfig(claudeCode, "connectors.claude_code");

  const config: DesktopConfig = {
    configurationVersion:
      input.configurationVersion ?? DESKTOP_CONFIGURATION_VERSION,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DESKTOP_CONFIG_TTL_MS).toISOString(),
    minimumAgentVersion,
    defaultContentMode: DESKTOP_DEFAULT_CONTENT_MODE,
    connectors: {
      claude_code: claudeCode,
    },
    updateChannel: input.updateChannel ?? DESKTOP_DEFAULT_UPDATE_CHANNEL,
    emergencyShutdown: input.emergencyShutdown ?? false,
    signingKeyVersion: input.signingKeyVersion,
  };

  // Runtime backstop for the never-broaden law: even if this file later grows
  // a broader content-mode union, an accidental widening config never ships.
  if (config.defaultContentMode !== "analytics_only") {
    throw new Error(
      `desktop config would broaden collection scope: defaultContentMode=${config.defaultContentMode} (spec §16.2 forbids silent broadening)`,
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// Canonicalization (the bytes the signature covers)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization the AGENT must reproduce exactly to verify
 * the signature. The scheme:
 *   - object keys sorted ascending by UTF-16 code unit (JS default string
 *     compare — safe here, all keys are ASCII),
 *   - no insignificant whitespace,
 *   - arrays kept in their given order,
 *   - standard JSON number/string escaping (via `JSON.stringify`),
 *   - the result encoded as UTF-8 bytes.
 * The `signature` field is never part of the canonical body.
 *
 * CRITICAL for the agent side: the wire JSON is insertion-order, but the
 * signature covers this SORTED-key canonical form — the Rust `config.rs`
 * (later PR) must reproduce this exact byte layout or every verify fails. A
 * checked-in golden vector, `desktop-agent/src-tauri/fixtures/
 * desktop-config-vector.json` (fixed test keypair; `canonicalBytes` = base64
 * of the exact signed bytes), is the byte-parity fixture the Rust test
 * consumes via `include_str!`; `tests/desktop-config.test.ts` regenerates it
 * from this code and asserts it matches the file, so the vector can't rot.
 */
export function canonicalizeConfig(config: DesktopConfig): string {
  return canonicalize(config);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Primitives (and null) — JSON.stringify handles escaping/number format.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    // Drop undefined-valued keys so they never appear (mirrors JSON.stringify).
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    .join(",")}}`;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** Worker-secret env carrying the Ed25519 signing key. */
export type DesktopConfigSigningEnv = {
  /**
   * Format: `v<N>:<base64 of the PKCS8 DER Ed25519 private key>`, e.g.
   * `v1:MC4CAQ…`. The version label enables rotation (see below). The
   * matching PUBLIC key (raw 32-byte Ed25519, exported via
   * `crypto.subtle.exportKey("raw", publicKey)`) is baked into the desktop
   * agent at build time — a later agent-side PR (T4.2 output) verifies against
   * it. This secret is NEVER exposed to PR workflows (spec §29).
   */
  DESKTOP_CONFIG_SIGNING_KEY?: string;
};

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Parses `v<N>:<base64 pkcs8>` into its version label + DER key bytes. */
export function parseSigningKey(raw: string | undefined): {
  version: string;
  pkcs8: Uint8Array;
} {
  if (!raw) {
    throw new Error("DESKTOP_CONFIG_SIGNING_KEY is not configured");
  }
  const separator = raw.indexOf(":");
  if (separator < 1) {
    throw new Error(
      "DESKTOP_CONFIG_SIGNING_KEY must be formatted as v<N>:<base64 pkcs8>",
    );
  }
  const version = raw.slice(0, separator);
  let pkcs8: Uint8Array;
  try {
    pkcs8 = fromBase64(raw.slice(separator + 1));
  } catch {
    throw new Error(
      "DESKTOP_CONFIG_SIGNING_KEY key material is not valid base64",
    );
  }
  return { version, pkcs8 };
}

/** The version label the signing key carries — stamped into the config body so
 * the agent can pick the right baked public key. */
export function signingKeyVersion(env: DesktopConfigSigningEnv): string {
  return parseSigningKey(env.DESKTOP_CONFIG_SIGNING_KEY).version;
}

/**
 * Compose + Ed25519-sign the config in one step. Reads the versioned private
 * key from the Worker secret, stamps its version into the (signed) body, signs
 * the canonical bytes, and returns the served `{...config, signature}` shape.
 */
export async function composeAndSignDesktopConfig(
  env: DesktopConfigSigningEnv,
  input?: Omit<ComposeDesktopConfigInput, "signingKeyVersion">,
): Promise<SignedDesktopConfig> {
  const { version, pkcs8 } = parseSigningKey(env.DESKTOP_CONFIG_SIGNING_KEY);
  const config = composeDesktopConfig({ ...input, signingKeyVersion: version });
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8 as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const bytes = new TextEncoder().encode(canonicalizeConfig(config));
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    bytes as BufferSource,
  );
  return { ...config, signature: toBase64(new Uint8Array(sig)) };
}

/**
 * Verify a signed config against a raw 32-byte Ed25519 public key — the exact
 * check the agent performs (this is here so the backend test can prove the
 * server's signature verifies, and to document the agent's algorithm). The
 * `signature` field is stripped before canonicalizing.
 */
export async function verifyDesktopConfig(
  publicKeyRaw: Uint8Array,
  signed: SignedDesktopConfig,
): Promise<boolean> {
  const { signature, ...config } = signed;
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyRaw as BufferSource,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const bytes = new TextEncoder().encode(canonicalizeConfig(config));
  let sig: Uint8Array;
  try {
    sig = fromBase64(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    sig as BufferSource,
    bytes as BufferSource,
  );
}

// ---------------------------------------------------------------------------
// Key rotation (documented procedure — mirrors the KEK versioning in
// src/lib/credentials.ts, but this is a DISTINCT signing key, not the KEK)
// ---------------------------------------------------------------------------
//
// The signing key is a Worker secret `DESKTOP_CONFIG_SIGNING_KEY` in the
// `v<N>:<base64 pkcs8>` format. Its version label is stamped into the signed
// body (`signingKeyVersion`), so the agent can hold more than one baked public
// key and pick the right one. To rotate:
//
//   1. Generate a NEW Ed25519 keypair OFFLINE (never in a PR/CI workflow —
//      spec §29 "do not expose signing secrets to pull-request workflows"):
//        const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true,
//          ["sign", "verify"]);
//        pkcs8  = base64(exportKey("pkcs8", kp.privateKey))  // → the secret
//        rawPub = base64(exportKey("raw",   kp.publicKey))   // → baked in agent
//   2. Ship an agent release that BAKES IN the new public key ALONGSIDE the
//      old one (the agent accepts a config signed by any baked key whose
//      version it recognizes). Wait for that release to roll out.
//   3. Only then set `DESKTOP_CONFIG_SIGNING_KEY` to `v<N+1>:<new pkcs8>` (the
//      deploy.yml secret-sync step pushes it). New configs now sign under vN+1.
//   4. After the old-key agents have all updated, drop the old public key from
//      the agent in a later release.
//
// This ordering (new public key distributed BEFORE the private key flips)
// guarantees no agent ever sees a config it cannot verify. Unlike the KEK,
// there is no stored ciphertext to re-wrap — configs are minted fresh per
// request, so rotation is purely "new key signs, old key retires".
