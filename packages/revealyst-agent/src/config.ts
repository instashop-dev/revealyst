// Local agent config: <home>/.revealyst/agent.json — the device token, the
// API base URL, and the identity-consent flag captured at `login`. The
// token is a bearer secret: the file is written 0o600 (owner-only on
// POSIX; on Windows the user-profile ACL covers it).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentConfig = {
  token: string;
  apiBaseUrl: string;
  consentIdentity: boolean;
};

export function configPath(homeDir: string): string {
  return join(homeDir, ".revealyst", "agent.json");
}

/** Structural token check (mirrors the server's parseAgentToken; the
 * server remains the authority). */
export function isValidTokenShape(token: string): boolean {
  const parts = token.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "rva1" &&
    parts.slice(1).every((p) => p.length > 0)
  );
}

export function maskToken(token: string): string {
  return token.length > 8 ? `rva1.…${token.slice(-4)}` : "…";
}

export function loadConfig(homeDir: string): AgentConfig | null {
  try {
    const parsed = JSON.parse(
      readFileSync(configPath(homeDir), "utf8"),
    ) as Partial<AgentConfig>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.apiBaseUrl !== "string"
    ) {
      return null;
    }
    return {
      token: parsed.token,
      apiBaseUrl: parsed.apiBaseUrl,
      consentIdentity: parsed.consentIdentity === true,
    };
  } catch {
    return null;
  }
}

export function saveConfig(homeDir: string, config: AgentConfig): void {
  const path = configPath(homeDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}
