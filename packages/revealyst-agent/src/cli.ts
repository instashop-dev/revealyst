#!/usr/bin/env node
// Revealyst Agent CLI — the sanctioned local-ingest path (spec §10).
//
//   revealyst-agent login --token rva1.… [--api <url>] [--consent-identity]
//   revealyst-agent sync  [--days 30] [--dry-run]
//   revealyst-agent status
//
// Everything printed here is structural (counts, days, masked token) —
// never log content, never file paths of individual sessions.

import { readFileSync } from "node:fs";
import { hostname, homedir, userInfo } from "node:os";
import { parseArgs } from "node:util";
import {
  isValidTokenShape,
  loadConfig,
  maskToken,
  saveConfig,
} from "./config";
import { claudeConfigDirs, listSessionFiles } from "./discover";
import { resolveLocalIdentity } from "./identity";
import { buildIngestRequest } from "./index";
import { pushBatch } from "./push";
import { trailingWindow } from "./window";

const AGENT_VERSION = "0.1.0";
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

  const config = loadConfig(homedir());
  if (!config && !dryRun) {
    fail("not logged in — run: revealyst-agent login --token rva1.…");
  }

  const dirs = claudeConfigDirs(process.env, homedir());
  const files = listSessionFiles(dirs);
  if (files.length === 0) {
    console.log("No Claude Code session logs found — nothing to sync.");
    return;
  }

  const contents: string[] = [];
  let unreadable = 0;
  for (const file of files) {
    try {
      contents.push(readFileSync(file.path, "utf8"));
    } catch {
      unreadable++;
    }
  }

  const identity = resolveLocalIdentity(
    homedir(),
    config?.consentIdentity ?? false,
    deviceSeed(),
  );
  const batch = buildIngestRequest({
    sessionContents: contents,
    window: trailingWindow(new Date(), days),
    identity,
    agentVersion: AGENT_VERSION,
  });

  const activeDays = new Set(batch.records.map((r) => r.day)).size;
  console.log(
    `Summarized ${files.length} session files (${unreadable} unreadable) → ` +
      `${batch.records.length} metric records, ${batch.signals.length} day signals ` +
      `across ${activeDays} active days [window ${batch.window.start}..${batch.window.end}]`,
  );
  console.log(
    `Identity: ${identity.descriptor.kind} (${identity.attribution}-level attribution)`,
  );

  if (dryRun) {
    console.log("Dry run — nothing pushed.");
    return;
  }

  const result = await pushBatch(config!.apiBaseUrl, config!.token, batch);
  if (!result.ok) {
    fail(`push failed (${result.status ?? "network"}): ${result.error}`);
  }
  console.log(
    `Pushed: ${result.records} records, ${result.signals} signals, ` +
      `${result.subjects} subject(s) upserted.`,
  );
}

function status(): void {
  const config = loadConfig(homedir());
  const dirs = claudeConfigDirs(process.env, homedir());
  const files = listSessionFiles(dirs);
  console.log(`revealyst-agent ${AGENT_VERSION}`);
  console.log(
    config
      ? `Login: ${maskToken(config.token)} → ${config.apiBaseUrl} ` +
          `(identity consent: ${config.consentIdentity ? "yes" : "no"})`
      : "Login: not configured",
  );
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
