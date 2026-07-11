#!/usr/bin/env node
// Revealyst Agent CLI — the sanctioned local-ingest path (spec §10).
//
//   revealyst-agent login --token rva1.… [--api <url>] [--consent-identity]
//   revealyst-agent sync  [--days 30] [--dry-run]
//   revealyst-agent status
//
// Everything printed here is structural (counts, days, masked token) —
// never log content, never file paths of individual sessions.

import { hostname, homedir, userInfo } from "node:os";
import { parseArgs } from "node:util";
import {
  isValidTokenShape,
  maskToken,
  resolveConfig,
  saveConfig,
} from "./config";
import { claudeConfigDirs, listSessionFiles } from "./discover";
import { pushBatch } from "./push";
import { parseSessionFilesStreaming } from "./stream";
import { runSync } from "./sync-run";

const AGENT_VERSION = "0.2.0";
const DEFAULT_API = "https://app.revealyst.com";
const DEFAULT_DAYS = 30;

function fail(message: string): never {
  console.error(`revealyst-agent: ${message}`);
  process.exit(1);
}

function deviceSeed(): string {
  let user = "unknown";
  try {
    user = userInfo().username;
  } catch {
    // Some environments (restricted containers) cannot resolve the user.
  }
  return `${hostname()}:${user}`;
}

async function login(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      token: { type: "string" },
      api: { type: "string", default: DEFAULT_API },
      "consent-identity": { type: "boolean", default: false },
    },
  });
  const token = values.token;
  if (!token || !isValidTokenShape(token)) {
    fail(
      "a device token is required: revealyst-agent login --token rva1.… " +
        "(create one in Revealyst → Connections → Revealyst Agent)",
    );
  }
  saveConfig(homedir(), {
    token,
    apiBaseUrl: values.api ?? DEFAULT_API,
    consentIdentity: values["consent-identity"] === true,
  });
  console.log(`Logged in (${maskToken(token)} → ${values.api}).`);
  console.log(
    values["consent-identity"]
      ? "Identity: your Claude account email will be attached (person-level metrics)."
      : "Identity: device-scoped only. Re-run login with --consent-identity for person-level metrics.",
  );
}

async function sync(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      days: { type: "string", default: String(DEFAULT_DAYS) },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    fail("--days must be an integer between 1 and 90");
  }
  const dryRun = values["dry-run"] === true;

  const outcome = await runSync(
    { days, dryRun },
    {
      homeDir: homedir(),
      env: process.env,
      defaultApi: DEFAULT_API,
      agentVersion: AGENT_VERSION,
      deviceSeed: deviceSeed(),
      now: () => new Date(),
      listFiles: () => listSessionFiles(claudeConfigDirs(process.env, homedir())),
      parseFiles: parseSessionFilesStreaming,
      push: pushBatch,
      log: (message) => console.log(message),
      warn: (message) => console.error(`revealyst-agent: ${message}`),
    },
  );
  if (outcome.kind === "fail") {
    fail(outcome.message);
  }
}

function status(): void {
  const resolved = resolveConfig(process.env, homedir(), DEFAULT_API);
  const dirs = claudeConfigDirs(process.env, homedir());
  const files = listSessionFiles(dirs);
  console.log(`revealyst-agent ${AGENT_VERSION}`);
  if (resolved.source === "invalid-env") {
    console.log("Login: REVEALYST_TOKEN is set but malformed");
  } else if (resolved.source === "none") {
    console.log("Login: not configured");
  } else {
    const { config } = resolved;
    const suffix =
      resolved.source === "env" ? " [from REVEALYST_TOKEN env]" : "";
    console.log(
      `Login: ${maskToken(config.token)} → ${config.apiBaseUrl} ` +
        `(identity consent: ${config.consentIdentity ? "yes" : "no"})${suffix}`,
    );
  }
  console.log(`Log dirs: ${dirs.length} (${files.length} session files)`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "login":
      return login(rest);
    case "sync":
      return sync(rest);
    case "status":
      return status();
    default:
      console.log(
        "usage: revealyst-agent <login|sync|status>\n" +
          "  login  --token rva1.… [--api <url>] [--consent-identity]\n" +
          "  sync   [--days 30] [--dry-run]\n" +
          "  status",
      );
      process.exit(command ? 1 : 0);
  }
}

void main();
