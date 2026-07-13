// The sync flow with injected I/O (file listing, streaming parse, push,
// output), so tests can lock the R2-critical invariant directly: a push is
// NEVER attempted for an empty batch — the server treats the declared
// window as authoritative (delete-then-upsert), so pushing an empty
// authoritative window would erase previously-captured days and restate
// nothing. The CLI (cli.ts) supplies the real deps; tests supply fakes.

import { resolveConfig, type AgentConfig } from "./config";
import type { SessionFileRef } from "./discover";
import { resolveLocalIdentity } from "./identity";
import { buildIngestRequest } from "./index";
import type { pushBatch } from "./push";
import {
  composeSyncReward,
  summarizeBatchHighlights,
  transparencyUrl,
} from "./reward";
import type { StreamParseResult } from "./stream";
import { trailingWindow } from "./window";

export type SyncOptions = {
  days: number;
  dryRun: boolean;
};

export type SyncDeps = {
  homeDir: string;
  env: Record<string, string | undefined>;
  defaultApi: string;
  agentVersion: string;
  deviceSeed: string;
  now: () => Date;
  listFiles: () => SessionFileRef[];
  parseFiles: (paths: string[]) => Promise<StreamParseResult>;
  push: typeof pushBatch;
  log: (message: string) => void;
  warn: (message: string) => void;
};

export type SyncOutcome = { kind: "ok" } | { kind: "fail"; message: string };

export async function runSync(
  opts: SyncOptions,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const resolved = resolveConfig(deps.env, deps.homeDir, deps.defaultApi);
  let config: AgentConfig | null = null;
  if (resolved.source === "invalid-env") {
    if (!opts.dryRun) {
      return {
        kind: "fail",
        message: "REVEALYST_TOKEN is set but is not a valid rva1.… device token",
      };
    }
    // Dry run never needs credentials — keep that invariant even for a
    // malformed env token, but say so loudly.
    deps.warn(
      "warning: REVEALYST_TOKEN is set but malformed — continuing without it (dry run)",
    );
  } else if (resolved.source !== "none") {
    config = resolved.config;
  }
  if (!config && !opts.dryRun) {
    return {
      kind: "fail",
      message:
        "not logged in — run: revealyst-agent login --token rva1.… " +
        "(or set REVEALYST_TOKEN for one-shot/CI use)",
    };
  }

  const files = deps.listFiles();
  if (files.length === 0) {
    deps.log("No Claude Code session logs found — nothing to sync.");
    return { kind: "ok" };
  }

  // Streamed, never readFileSync: documented multi-GB session files exceed
  // V8's string ceiling before parse (plan R4).
  const { parsed, unreadableFiles } = await deps.parseFiles(
    files.map((f) => f.path),
  );
  // Messaging fast-path only — the records guard below is the safety
  // mechanism (zero events always implies zero records).
  if (parsed.events.length === 0) {
    deps.log(
      "No parseable Claude Code activity found in your logs — nothing to sync.",
    );
    return { kind: "ok" };
  }

  const identity = resolveLocalIdentity(
    deps.homeDir,
    config?.consentIdentity ?? false,
    deps.deviceSeed,
  );
  const requestedWindow = trailingWindow(deps.now(), opts.days);
  const batch = buildIngestRequest({
    parsed,
    window: requestedWindow,
    identity,
    agentVersion: deps.agentVersion,
  });

  // R2 safety mechanism: never push an empty authoritative window.
  if (batch.records.length === 0) {
    deps.log(
      `No Claude Code activity within the last ${opts.days} days — nothing ` +
        "to sync (nothing was deleted or pushed).",
    );
    return { kind: "ok" };
  }

  const activeDays = new Set(batch.records.map((r) => r.day)).size;
  deps.log(
    `Summarized ${files.length} session files (${unreadableFiles} unreadable) → ` +
      `${batch.records.length} metric records, ${batch.signals.length} day signals ` +
      `across ${activeDays} active days [window ${batch.window.start}..${batch.window.end}]`,
  );
  if (batch.window.start !== requestedWindow.start) {
    deps.log(
      `Window pinned to ${batch.window.start} (earliest surviving local ` +
        "log day) so older captured history is preserved.",
    );
  }
  deps.log(
    `Identity: ${identity.descriptor.kind} (${identity.attribution}-level attribution)`,
  );

  if (opts.dryRun) {
    deps.log("Dry run — nothing pushed.");
    return { kind: "ok" };
  }
  if (!config) {
    // Unreachable: guarded above. Kept as a narrow + tripwire so a future
    // reorder of the guards cannot compile its way into a null deref here.
    return { kind: "fail", message: "not logged in" };
  }

  const result = await deps.push(config.apiBaseUrl, config.token, batch);
  if (!result.ok) {
    return {
      kind: "fail",
      message: `push failed (${result.status ?? "network"}): ${result.error}`,
    };
  }
  deps.log(
    `Pushed: ${result.records} records, ${result.signals} signals, ` +
      `${result.subjects} subject(s) upserted.`,
  );

  // The same-click reward (Spec §10): factual counts from the server's echo
  // plus one honesty-gated superlative from the batch we just built. Never a
  // sync nag; never a fabricated positive on thin data.
  const reward = composeSyncReward({
    records: result.records,
    signals: result.signals,
    subjects: result.subjects,
    window: batch.window,
    highlights: summarizeBatchHighlights(batch),
  });
  deps.log(reward.headline);
  if (reward.positive) {
    deps.log(reward.positive);
  }
  deps.log(`See exactly what this sync sent: ${transparencyUrl(config.apiBaseUrl)}`);
  return { kind: "ok" };
}
