import {
  canonicalizeConfig,
  composeAndSignDesktopConfig,
  type SignedDesktopConfig,
} from "../../src/lib/desktop-config";

// Golden canonical test vector for the desktop signed-remote-config (T4.2,
// ADR 0049). The agent-side Rust `config.rs` (later PR) must reproduce the
// SORTED-key canonicalization byte-for-byte to verify signatures; this vector
// is its byte-parity fixture (`include_str!`), and the backend drift-guard test
// (`tests/desktop-config.test.ts`) regenerates it from this one builder and
// asserts equality with the checked-in file so it can never silently rot.
//
// The keypair below is a FIXED THROWAWAY test key — NOT a production key, never
// used to sign anything real. The private key is committed ONLY so this vector
// is reproducible; production signing uses the Worker secret
// DESKTOP_CONFIG_SIGNING_KEY (see src/lib/desktop-config.ts).

/** Throwaway Ed25519 PKCS8 private key (base64), version-labelled `vtest`.
 * NON-PRODUCTION — do not use to sign real configs. */
export const TEST_SIGNING_KEY =
  "vtest:MC4CAQAwBQYDK2VwBCIEILz66nz2gKE39kwSYlH60NXP6UNBcdpIudlSyhWgkqjH";

/** The matching raw 32-byte Ed25519 public key (base64) — what the agent would
 * bake in to verify configs signed by `vtest`. */
export const TEST_PUBLIC_KEY_RAW_B64 = "QRMp+h+t+11d1fBZgzrMRR2yb/FmPE4tRhtOBMl6Zrw=";

/** A fixed epoch so issuedAt/expiresAt (and therefore the signed bytes) are
 * deterministic: 2026-01-01T00:00:00Z. */
export const TEST_VECTOR_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

/** A representative (non-default) config so the vector exercises every field
 * with concrete values rather than leaning on production constants (which may
 * drift). */
export const TEST_VECTOR_INPUT = {
  now: TEST_VECTOR_NOW,
  configurationVersion: 7,
  minimumAgentVersion: "1.2.3",
  updateChannel: "beta",
  emergencyShutdown: false,
  claudeCode: {
    enabled: true,
    minimumVersion: "1.0.0",
    pollIntervalSeconds: 60,
  },
} as const;

export type DesktopConfigVector = {
  config: Omit<SignedDesktopConfig, "signature">;
  /** base64 of the exact UTF-8 bytes the signature covers. */
  canonicalBytes: string;
  /** base64 raw 32-byte Ed25519 public key. */
  publicKeyRaw: string;
  /** base64 Ed25519 signature over `canonicalBytes`. */
  signature: string;
};

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The single source of truth for the vector — used by both the generator
 * script and the drift-guard test. Deterministic (fixed key + fixed inputs). */
export async function buildDesktopConfigVector(): Promise<DesktopConfigVector> {
  const signed = await composeAndSignDesktopConfig(
    { DESKTOP_CONFIG_SIGNING_KEY: TEST_SIGNING_KEY },
    TEST_VECTOR_INPUT,
  );
  const { signature, ...config } = signed;
  return {
    config,
    canonicalBytes: utf8ToBase64(canonicalizeConfig(config)),
    publicKeyRaw: TEST_PUBLIC_KEY_RAW_B64,
    signature,
  };
}
