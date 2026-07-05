import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isValidTokenShape,
  loadConfig,
  maskToken,
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
