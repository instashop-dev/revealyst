import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isValidTokenShape,
  loadConfig,
  maskToken,
  resolveConfig,
  saveConfig,
} from "../src/config";

const home = mkdtempSync(join(tmpdir(), "rva-config-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("agent config", () => {
  it("round-trips save → load", () => {
    saveConfig(home, {
      token: "rva1.org.conn.secret",
      apiBaseUrl: "https://example.test",
      consentIdentity: true,
    });
    expect(loadConfig(home)).toEqual({
      token: "rva1.org.conn.secret",
      apiBaseUrl: "https://example.test",
      consentIdentity: true,
    });
  });

  it("returns null for a missing or malformed file", () => {
    expect(loadConfig(join(home, "nope"))).toBeNull();
  });

  it("validates token shape structurally", () => {
    expect(isValidTokenShape("rva1.a.b.c")).toBe(true);
    expect(isValidTokenShape("rva2.a.b.c")).toBe(false);
    expect(isValidTokenShape("rva1.a.b")).toBe(false);
    expect(isValidTokenShape("rva1..b.c")).toBe(false);
    expect(isValidTokenShape("")).toBe(false);
  });

  it("masks the token for display", () => {
    expect(maskToken("rva1.org.conn.supersecret1234")).toBe("rva1.…1234");
    expect(maskToken("short")).toBe("…");
  });
});

describe("resolveConfig (REVEALYST_TOKEN env fallback)", () => {
  const DEFAULT_API = "https://app.revealyst.com";
  const envHome = mkdtempSync(join(tmpdir(), "rva-resolve-"));
  afterAll(() => rmSync(envHome, { recursive: true, force: true }));

  it("an env token is fully env-defined — nothing inherits from the file", () => {
    saveConfig(envHome, {
      token: "rva1.org.conn.filesecret",
      apiBaseUrl: "https://stale-staging.test",
      consentIdentity: true,
    });
    const resolved = resolveConfig(
      { REVEALYST_TOKEN: "rva1.org.conn.envsecret" },
      envHome,
      DEFAULT_API,
    );
    expect(resolved).toEqual({
      source: "env",
      config: {
        token: "rva1.org.conn.envsecret",
        // Never the leftover file's host: a prod token must not be
        // replayed at a stale staging apiBaseUrl.
        apiBaseUrl: DEFAULT_API,
        // Never the leftover file's consent: it was given for THAT
        // login's token, not this one. Env runs are device-scoped.
        consentIdentity: false,
      },
    });
  });

  it("REVEALYST_API overrides the api base; defaults apply with no file", () => {
    const bare = mkdtempSync(join(tmpdir(), "rva-bare-"));
    try {
      expect(
        resolveConfig(
          {
            REVEALYST_TOKEN: "rva1.org.conn.envsecret",
            REVEALYST_API: "https://env.test",
          },
          bare,
          DEFAULT_API,
        ),
      ).toEqual({
        source: "env",
        config: {
          token: "rva1.org.conn.envsecret",
          apiBaseUrl: "https://env.test",
          consentIdentity: false,
        },
      });
      expect(
        resolveConfig(
          { REVEALYST_TOKEN: "rva1.org.conn.envsecret" },
          bare,
          DEFAULT_API,
        ),
      ).toMatchObject({
        source: "env",
        config: { apiBaseUrl: DEFAULT_API },
      });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("a malformed env token fails loudly instead of silently using the file", () => {
    expect(
      resolveConfig({ REVEALYST_TOKEN: "not-a-token" }, envHome, DEFAULT_API),
    ).toEqual({ source: "invalid-env" });
  });

  it("falls back to the file, then to none", () => {
    expect(resolveConfig({}, envHome, DEFAULT_API)).toMatchObject({
      source: "file",
      config: { token: "rva1.org.conn.filesecret" },
    });
    const empty = mkdtempSync(join(tmpdir(), "rva-empty-"));
    try {
      expect(resolveConfig({}, empty, DEFAULT_API)).toEqual({
        source: "none",
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
