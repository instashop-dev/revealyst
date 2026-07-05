import { PGlite } from "@electric-sql/pglite";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  currentKekVersion,
  decryptCredential,
  encryptCredential,
  rewrapCredential,
  type CredentialEnv,
} from "../src/lib/credentials";

// W0-C credential envelope: round-trip, tamper detection, AAD tenant
// binding, KEK rotation, and the no-plaintext-column schema invariant.

function testKek(version: string, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${version}:${btoa(binary)}`;
}

const ENV_V1: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek("v1", 1) };
const ENV_V2_WITH_PREV: CredentialEnv = {
  CREDENTIAL_KEK_CURRENT: testKek("v2", 2),
  CREDENTIAL_KEK_PREVIOUS: testKek("v1", 1),
};
const ENV_V2_ONLY: CredentialEnv = {
  CREDENTIAL_KEK_CURRENT: testKek("v2", 2),
};

const BINDING = { orgId: "org-1", connectionId: "conn-1", kind: "api_key" };

/** Flips one base64 character mid-string so decoded bytes change. */
function tamper(b64: string): string {
  const i = Math.floor(b64.length / 2);
  const replacement = b64[i] === "A" ? "B" : "A";
  return b64.slice(0, i) + replacement + b64.slice(i + 1);
}

describe("envelope round-trip", () => {
  it.each([
    ["vendor API key", "sk-ant-admin01-abc123-XYZ"],
    ["multi-KB PEM private key", `-----BEGIN RSA PRIVATE KEY-----\n${"MIIEpAIBAAKCAQEA".repeat(300)}\n-----END RSA PRIVATE KEY-----`],
    ["device token", "rvl_device_9f8e7d6c5b4a"],
  ])("round-trips a %s", async (_label, plaintext) => {
    const row = await encryptCredential(ENV_V1, BINDING, plaintext);
    expect(await decryptCredential(ENV_V1, BINDING, row)).toBe(plaintext);
  });

  it("ciphertext does not contain the plaintext", async () => {
    const plaintext = "sk-super-secret-value";
    const row = await encryptCredential(ENV_V1, BINDING, plaintext);
    expect(row.ciphertextB64).not.toContain(plaintext);
    expect(atob(row.ciphertextB64)).not.toContain(plaintext);
  });

  it("uses a fresh DEK and IV per encryption", async () => {
    const a = await encryptCredential(ENV_V1, BINDING, "same-plaintext");
    const b = await encryptCredential(ENV_V1, BINDING, "same-plaintext");
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.wrappedDekB64).not.toBe(b.wrappedDekB64);
  });
});

describe("tamper detection (AES-GCM auth)", () => {
  it.each(["ciphertextB64", "ivB64", "wrappedDekB64", "dekIvB64"] as const)(
    "rejects a tampered %s",
    async (field) => {
      const row = await encryptCredential(ENV_V1, BINDING, "secret");
      const tampered = { ...row, [field]: tamper(row[field]) };
      await expect(
        decryptCredential(ENV_V1, BINDING, tampered),
      ).rejects.toThrow();
    },
  );
});

describe("AAD tenant binding", () => {
  it("rejects decryption under a different org, connection, or kind", async () => {
    const row = await encryptCredential(ENV_V1, BINDING, "secret");
    await expect(
      decryptCredential(ENV_V1, { ...BINDING, orgId: "org-2" }, row),
    ).rejects.toThrow();
    await expect(
      decryptCredential(ENV_V1, { ...BINDING, connectionId: "conn-2" }, row),
    ).rejects.toThrow();
    await expect(
      decryptCredential(ENV_V1, { ...BINDING, kind: "pat" }, row),
    ).rejects.toThrow();
  });
});

describe("KEK rotation", () => {
  it("decrypts old rows via the previous KEK during the rotation window", async () => {
    const row = await encryptCredential(ENV_V1, BINDING, "secret");
    expect(await decryptCredential(ENV_V2_WITH_PREV, BINDING, row)).toBe(
      "secret",
    );
  });

  it("rewrap bumps the KEK version without touching the data ciphertext", async () => {
    const row = await encryptCredential(ENV_V1, BINDING, "secret");
    const rewrapped = await rewrapCredential(ENV_V2_WITH_PREV, BINDING, row);
    expect(rewrapped.kekVersion).toBe("v2");
    expect(rewrapped.ciphertextB64).toBe(row.ciphertextB64);
    expect(rewrapped.ivB64).toBe(row.ivB64);
    expect(rewrapped.wrappedDekB64).not.toBe(row.wrappedDekB64);
    // After the previous KEK is dropped, rewrapped rows still decrypt…
    expect(await decryptCredential(ENV_V2_ONLY, BINDING, rewrapped)).toBe(
      "secret",
    );
  });

  it("fails loudly for rows whose KEK was dropped before rewrapping", async () => {
    const row = await encryptCredential(ENV_V1, BINDING, "secret");
    await expect(decryptCredential(ENV_V2_ONLY, BINDING, row)).rejects.toThrow(
      /no KEK available for version v1/,
    );
  });

  it("rejects a KEK pair that reuses a version label (bytes-rotated, label-reused)", async () => {
    // The operator mistake this guards: rotating key bytes but keeping the
    // 'v1' label. Selection is version-string-only, so without the guard
    // the wrong bytes would be tried with no fallback and new rows would
    // poison the version→key mapping.
    const ambiguous: CredentialEnv = {
      CREDENTIAL_KEK_CURRENT: testKek("v1", 9),
      CREDENTIAL_KEK_PREVIOUS: testKek("v1", 1),
    };
    const row = await encryptCredential(ENV_V1, BINDING, "secret");
    await expect(
      decryptCredential(ambiguous, BINDING, row),
    ).rejects.toThrow(/reuses CREDENTIAL_KEK_CURRENT's version label/);
    await expect(
      encryptCredential(ambiguous, BINDING, "new-secret"),
    ).rejects.toThrow(/reuses CREDENTIAL_KEK_CURRENT's version label/);
  });

  it("exposes the current version label for rotation sweeps", () => {
    expect(currentKekVersion(ENV_V2_WITH_PREV)).toBe("v2");
  });
});

describe("KEK configuration errors", () => {
  it("rejects a missing KEK", async () => {
    await expect(encryptCredential({}, BINDING, "x")).rejects.toThrow(
      /CREDENTIAL_KEK_CURRENT is not configured/,
    );
  });

  it.each([
    ["missing version prefix", btoa("0".repeat(32))],
    ["wrong key length", `v1:${btoa("short")}`],
    ["invalid base64", "v1:!!!not-base64!!!"],
  ])("rejects a malformed KEK (%s)", async (_label, kek) => {
    await expect(
      encryptCredential({ CREDENTIAL_KEK_CURRENT: kek }, BINDING, "x"),
    ).rejects.toThrow();
  });
});

describe("repository boundary (PGlite)", () => {
  let db: Db;
  let orgA: string;
  let orgB: string;
  let connA: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;

    const [a] = await db
      .insert(schema.orgs)
      .values({ name: "cred-org-a" })
      .returning();
    const [b] = await db
      .insert(schema.orgs)
      .values({ name: "cred-org-b" })
      .returning();
    orgA = a.id;
    orgB = b.id;
    connA = (
      await forOrg(db, orgA).connections.create({
        vendor: "cursor",
        displayName: "Cursor",
        authKind: "api_key",
      })
    ).id;
  });

  it("stores encrypted and decrypts only inside withCredential", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.connections.storeCredential(
      connA,
      "api_key",
      "crsr_live_key",
      ENV_V1,
    );

    const seen = await scoped.connections.withCredential(
      connA,
      "api_key",
      ENV_V1,
      async (plaintext) => plaintext.toUpperCase(),
    );
    expect(seen).toBe("CRSR_LIVE_KEY");

    // On disk: only envelope fields, no plaintext.
    const [row] = await db.select().from(schema.connectionCredentials);
    expect(row.kekVersion).toBe("v1");
    expect(JSON.stringify(row)).not.toContain("crsr_live_key");
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("re-storing replaces the credential (upsert on connection+kind)", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.connections.storeCredential(connA, "api_key", "v2-key", ENV_V1);
    const rows = await db.select().from(schema.connectionCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0].rotatedAt).not.toBeNull();
    const seen = await scoped.connections.withCredential(
      connA,
      "api_key",
      ENV_V1,
      async (p) => p,
    );
    expect(seen).toBe("v2-key");
  });

  it("another org cannot reach the credential through the repo layer", async () => {
    await expect(
      forOrg(db, orgB).connections.withCredential(
        connA,
        "api_key",
        ENV_V1,
        async (p) => p,
      ),
    ).rejects.toThrow(/no api_key credential stored/);
  });

  it("refuses an expired credential", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.connections.storeCredential(
      connA,
      "device_token",
      "expired-token",
      ENV_V1,
      new Date("2025-01-01T00:00:00Z"),
    );
    await expect(
      scoped.connections.withCredential(
        connA,
        "device_token",
        ENV_V1,
        async (p) => p,
      ),
    ).rejects.toThrow(/expired at 2025-01-01/);
  });

  it("does not stamp last_used_at when fn fails", async () => {
    const scoped = forOrg(db, orgA);
    await scoped.connections.storeCredential(connA, "pat", "pat-token", ENV_V1);
    await expect(
      scoped.connections.withCredential(connA, "pat", ENV_V1, async () => {
        throw new Error("vendor rejected the key");
      }),
    ).rejects.toThrow(/vendor rejected/);
    const [row] = await db
      .select()
      .from(schema.connectionCredentials)
      .where(eq(schema.connectionCredentials.kind, "pat"));
    expect(row.lastUsedAt).toBeNull();
  });

  it("cross-org storeCredential is rejected (cannot overwrite another org's row)", async () => {
    await expect(
      forOrg(db, orgB).connections.storeCredential(
        connA,
        "api_key",
        "smuggled",
        ENV_V1,
      ),
    ).rejects.toThrow(/not found in org/);

    // Org A's credential is untouched and still decrypts under A's AAD.
    const seen = await forOrg(db, orgA).connections.withCredential(
      connA,
      "api_key",
      ENV_V1,
      async (p) => p,
    );
    expect(seen).toBe("v2-key");
  });

  it("rewrapCredentials sweeps stale rows to the current KEK", async () => {
    const scoped = forOrg(db, orgA);
    // Rows so far were stored under v1. Sweep to v2 during the window.
    const rewrapped = await scoped.connections.rewrapCredentials(
      ENV_V2_WITH_PREV,
    );
    expect(rewrapped).toBeGreaterThanOrEqual(1);
    // After the sweep, the previous KEK can be dropped entirely.
    const seen = await scoped.connections.withCredential(
      connA,
      "api_key",
      ENV_V2_ONLY,
      async (p) => p,
    );
    expect(seen).toBe("v2-key");
    // Idempotent: a second sweep finds nothing stale.
    expect(await scoped.connections.rewrapCredentials(ENV_V2_ONLY)).toBe(0);
  });
});

describe("schema invariant: no plaintext credential columns", () => {
  // Better Auth owns these tables; its session/OAuth tokens are auth
  // artifacts, not vendor credentials, and are documented exceptions.
  const AUTH_TABLES = new Set(["user", "session", "account", "verification"]);
  const SENSITIVE = /(secret|token|password|credential|private|api_key)/i;

  it("application tables carry no credential-shaped columns", () => {
    for (const exported of Object.values(schema)) {
      if (!(exported instanceof PgTable)) continue;
      const tableName = getTableName(exported);
      if (AUTH_TABLES.has(tableName)) continue;
      if (tableName === "connection_credentials") continue;
      for (const column of Object.values(getTableColumns(exported))) {
        expect(
          SENSITIVE.test(column.name),
          `${tableName}.${column.name} looks credential-shaped`,
        ).toBe(false);
      }
    }
  });

  it("connection_credentials stores only envelope fields", () => {
    const { columns } = getTableConfig(schema.connectionCredentials);
    const names = columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "id",
        "org_id",
        "connection_id",
        "kind",
        "ciphertext_b64",
        "iv_b64",
        "wrapped_dek_b64",
        "dek_iv_b64",
        "kek_version",
        "expires_at",
        "created_at",
        "rotated_at",
        "last_used_at",
      ].sort(),
    );
  });
});
