// Envelope encryption for vendor credentials — the W0-C frozen column
// shape (connection_credentials) and its only read/write path.
//
// No Cloudflare KMS exists, so the envelope pattern is: a per-credential
// random 256-bit DEK encrypts the plaintext (AES-256-GCM); the DEK is
// wrapped by a KEK held as a Worker secret. Rotation re-wraps DEKs only —
// data is never re-encrypted. AAD binds every ciphertext to
// `${orgId}:${connectionId}:${kind}`, so a row copied across orgs or
// connections fails authentication (cryptographic tenant binding on top of
// the composite-FK isolation).
//
// Pure WebCrypto: identical behavior on workerd, Node, and vitest. Keys
// are imported per call — nothing is cached at module scope (Workers
// cancel cross-request I/O).

export type CredentialEnv = {
  /** Format: `v<N>:<base64 of 32 random bytes>`, e.g. `v1:3q2+7w…`. */
  CREDENTIAL_KEK_CURRENT?: string;
  /** Previous KEK, kept only during a rotation window. Same format. */
  CREDENTIAL_KEK_PREVIOUS?: string;
};

/** Tenant binding — the AAD. A credential row is only readable under the
 * exact (org, connection, kind) it was written for. */
export type CredentialBinding = {
  orgId: string;
  connectionId: string;
  kind: string;
};

/** The frozen encrypted-credential column shape (all base64 text). */
export type EncryptedCredential = {
  ciphertextB64: string;
  ivB64: string;
  wrappedDekB64: string;
  dekIvB64: string;
  kekVersion: string;
};

const KEK_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseKek(raw: string | undefined, name: string) {
  if (!raw) {
    throw new Error(`${name} is not configured`);
  }
  const separator = raw.indexOf(":");
  if (separator < 1) {
    throw new Error(`${name} must be formatted as v<N>:<base64 32 bytes>`);
  }
  const version = raw.slice(0, separator);
  let keyBytes: Uint8Array;
  try {
    keyBytes = fromBase64(raw.slice(separator + 1));
  } catch {
    throw new Error(`${name} key material is not valid base64`);
  }
  if (keyBytes.length !== KEK_BYTE_LENGTH) {
    throw new Error(`${name} key material must be exactly 32 bytes`);
  }
  return { version, keyBytes };
}

function importAesKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function aadFor(binding: CredentialBinding): Uint8Array {
  return new TextEncoder().encode(
    `${binding.orgId}:${binding.connectionId}:${binding.kind}`,
  );
}

async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
    },
    key,
    plaintext as BufferSource,
  );
  return new Uint8Array(ciphertext);
}

async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
    },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

/** Selects the KEK matching a stored row's version: current first, then
 * previous (rotation window). */
function kekForVersion(env: CredentialEnv, version: string) {
  const current = parseKek(env.CREDENTIAL_KEK_CURRENT, "CREDENTIAL_KEK_CURRENT");
  if (current.version === version) {
    return current;
  }
  if (env.CREDENTIAL_KEK_PREVIOUS) {
    const previous = parseKek(
      env.CREDENTIAL_KEK_PREVIOUS,
      "CREDENTIAL_KEK_PREVIOUS",
    );
    if (previous.version === version) {
      return previous;
    }
  }
  throw new Error(
    `no KEK available for version ${version} — was the previous key dropped before rewrapping?`,
  );
}

export async function encryptCredential(
  env: CredentialEnv,
  binding: CredentialBinding,
  plaintext: string,
): Promise<EncryptedCredential> {
  const kek = parseKek(env.CREDENTIAL_KEK_CURRENT, "CREDENTIAL_KEK_CURRENT");
  const aad = aadFor(binding);

  const dekBytes = crypto.getRandomValues(new Uint8Array(32));
  const dek = await importAesKey(dekBytes);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const ciphertext = await aesGcmEncrypt(
    dek,
    iv,
    aad,
    new TextEncoder().encode(plaintext),
  );

  const kekKey = await importAesKey(kek.keyBytes);
  const dekIv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const wrappedDek = await aesGcmEncrypt(kekKey, dekIv, aad, dekBytes);

  return {
    ciphertextB64: toBase64(ciphertext),
    ivB64: toBase64(iv),
    wrappedDekB64: toBase64(wrappedDek),
    dekIvB64: toBase64(dekIv),
    kekVersion: kek.version,
  };
}

export async function decryptCredential(
  env: CredentialEnv,
  binding: CredentialBinding,
  row: EncryptedCredential,
): Promise<string> {
  const kek = kekForVersion(env, row.kekVersion);
  const aad = aadFor(binding);

  const kekKey = await importAesKey(kek.keyBytes);
  const dekBytes = await aesGcmDecrypt(
    kekKey,
    fromBase64(row.dekIvB64),
    aad,
    fromBase64(row.wrappedDekB64),
  );
  const dek = await importAesKey(dekBytes);
  const plaintext = await aesGcmDecrypt(
    dek,
    fromBase64(row.ivB64),
    aad,
    fromBase64(row.ciphertextB64),
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Rotation: unwraps the DEK with the row's (old) KEK and re-wraps it with
 * the current KEK. The data ciphertext is untouched — the whole point of
 * the envelope.
 */
export async function rewrapCredential(
  env: CredentialEnv,
  binding: CredentialBinding,
  row: EncryptedCredential,
): Promise<EncryptedCredential> {
  const current = parseKek(
    env.CREDENTIAL_KEK_CURRENT,
    "CREDENTIAL_KEK_CURRENT",
  );
  const old = kekForVersion(env, row.kekVersion);
  const aad = aadFor(binding);

  const oldKey = await importAesKey(old.keyBytes);
  const dekBytes = await aesGcmDecrypt(
    oldKey,
    fromBase64(row.dekIvB64),
    aad,
    fromBase64(row.wrappedDekB64),
  );

  const currentKey = await importAesKey(current.keyBytes);
  const dekIv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const wrappedDek = await aesGcmEncrypt(currentKey, dekIv, aad, dekBytes);

  return {
    ciphertextB64: row.ciphertextB64,
    ivB64: row.ivB64,
    wrappedDekB64: toBase64(wrappedDek),
    dekIvB64: toBase64(dekIv),
    kekVersion: current.version,
  };
}
