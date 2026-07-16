import { z } from "zod";
import type { Db } from "../db/client";
import type { CredentialEnv } from "./credentials";
import { authenticateDeviceToken } from "./device-token";
import { DEVICE_VENDOR } from "./desktop-devices";

// Core of POST /api/desktop/diagnostics (Desktop Agent plan T4.3, spec §23.2),
// kept out of the Next route handler so it is unit-testable against PGlite (the
// heartbeat / agent-ingest pattern). Auth and tenancy both derive from the
// device token — the org scope is the token's own orgId, so there is no path
// to another org's rows.
//
// STRUCTURAL PRIVACY GUARANTEE (invariant b, spec §23.2/§26.1): the diagnostic
// bundle carries COUNTS, VERSIONS, STATES, and SANITIZED LOG LINES ONLY. There
// is NO field in `diagnosticBundleSchema` that can hold an activity payload —
// no `events`, no `payload`, no `prompt`, no `response`, no free-form record.
// A payload is therefore not *filtered out*, it is *unrepresentable*: `.strict()`
// rejects any unknown key at every level, so a bundle carrying content fails
// validation with 400 before anything is read. The server-side re-scrub of
// `logTail` (see `scrubLogTail`) is belt-and-braces on top of the agent's own
// scrub — defense-in-depth for the one free-text field, not the primary control.
//
// STORAGE: Workers Logs (a single structured `console.log` JSON line), NOT a
// database table. Diagnostics are operational/support telemetry — a support
// engineer reads them via `wrangler tail` / Workers Logs, exactly like the
// request-timing stage lines (src/lib/request-timing.ts). This deliberately
// avoids adding an org-scoped table (and its frozen-contract surface: migration,
// ADR, tenant-isolation + account-deletion registrations) for what is a
// low-volume, human-triggered, ops-facing signal. Nothing here is tenant
// application data that a page or API renders.
//
// Ordering mirrors heartbeat/agent-ingest: cheap token auth FIRST (a
// revoked/paused device is rejected before the body is parsed), body validation
// only for a caller holding a real credential.

// --- Closed vocabularies -----------------------------------------------------

/** Connector states, verbatim from spec §11.2. A closed enum — an unknown
 * state string is rejected, so the field can never smuggle free text. */
const connectorStateSchema = z.enum([
  "not_detected",
  "detected",
  "permission_required",
  "ready",
  "collecting",
  "partially_supported",
  "paused",
  "degraded",
  "blocked",
  "disabled_remotely",
  "unsupported_version",
]);

/** Agent self-update states (spec §13.1 `update_state`). Closed enum — the spec
 * lists no verbatim variant set, so this is a minimal honest fixed set covering
 * the updater lifecycle (T6.x: check → download → verify → install on
 * idle/restart). Additive changes stay closed by construction. */
const updateStateSchema = z.enum([
  "up_to_date",
  "checking",
  "downloading",
  "downloaded",
  "pending_restart",
  "error",
]);

// --- Bounds ------------------------------------------------------------------

/** Max distinct connectors reported. The agent ships a handful of connectors;
 * 50 is generous headroom while still bounding the array. */
const MAX_CONNECTOR_STATES = 50;
/** Max sanitized log lines accepted. Bounds the bundle and the re-scrub cost. */
export const MAX_LOG_LINES = 500;
/** Max characters per log line (schema-level). Over-length lines are rejected,
 * not silently truncated — a truncated line could split a secret across the
 * cut and defeat the re-scrub. */
export const MAX_LOG_LINE_LENGTH = 1000;
/** Max queue count value — a sanity ceiling shared with the heartbeat's depth. */
const MAX_QUEUE_COUNT = 10_000_000;

// --- Strict bundle schema ----------------------------------------------------

/**
 * Queue depth counts — a closed set of non-negative integers. `.strict()` means
 * an unknown count key (or, critically, a non-numeric field trying to ride in
 * under a count name) is rejected. `pending` + `quarantined` are the two the
 * plan names; `uploaded`/`failed` are optional lifetime counters the agent may
 * include. No value here is anything but a bounded integer.
 */
const queueCountsSchema = z
  .object({
    pending: z.number().int().min(0).max(MAX_QUEUE_COUNT),
    quarantined: z.number().int().min(0).max(MAX_QUEUE_COUNT),
    uploaded: z.number().int().min(0).max(MAX_QUEUE_COUNT).optional(),
    failed: z.number().int().min(0).max(MAX_QUEUE_COUNT).optional(),
  })
  .strict();

/**
 * The diagnostic bundle (spec §23.2). Every field is a count, a version, a
 * state, a timestamp, or a sanitized log line — there is deliberately NO field
 * that can carry an activity payload. `.strict()` at every object level makes a
 * content-bearing key (`events`, `payload`, `prompt`, `response`, …) a 400, so
 * payloads are structurally impossible, not filtered.
 */
export const diagnosticBundleSchema = z
  .object({
    agentVersion: z.string().trim().min(1).max(64),
    platform: z.enum(["macos", "windows"]),
    architecture: z.enum(["arm64", "x64"]),
    connectorStates: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(64),
            state: connectorStateSchema,
          })
          .strict(),
      )
      .max(MAX_CONNECTOR_STATES),
    queueCounts: queueCountsSchema,
    // ISO-8601 timestamp of the last successful sync, or null if never synced.
    lastSuccessfulSync: z.string().datetime().nullable(),
    // Signed remote-config version (numeric, spec §21) and policy version
    // (string identifier). Both are opaque version markers, never content.
    configVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    policyVersion: z.string().trim().min(1).max(128),
    updateState: updateStateSchema,
    // Already agent-scrubbed log lines (spec §23.1). Bounded count + per-line
    // length here; re-scrubbed server-side below.
    logTail: z.array(z.string().max(MAX_LOG_LINE_LENGTH)).max(MAX_LOG_LINES),
  })
  .strict();

export type DiagnosticBundle = z.infer<typeof diagnosticBundleSchema>;

// --- Server-side re-scrub (defense-in-depth) ---------------------------------

/**
 * Patterns that mark a log line as carrying a secret or activity content. A
 * line matching ANY of these is DROPPED entirely (never partially redacted — a
 * partial redaction can leak the shape/length of what it hid, and a dropped
 * line is strictly safer than a scrubbed one). This is belt-and-braces on top
 * of the agent's §23.1 scrub, not the primary privacy control (that is the
 * schema having no payload field at all).
 */
const SECRET_LINE_PATTERNS: RegExp[] = [
  // Revealyst device token (rva1.<org>.<conn>.<secret>) or any rva1.-prefixed
  // secret — must never appear in a diagnostics line.
  /rva1\./i,
  // Bearer / Authorization headers.
  /\bbearer\s+\S/i,
  /\bauthorization\b\s*[:=]/i,
  // Generic secret-ish key/value markers.
  /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|session[_-]?cookie)\b\s*[:=]/i,
  // PEM private-key header.
  /-----BEGIN[^-]*PRIVATE KEY-----/i,
  // Activity-content markers (spec §23.1: no prompt/response text). A line that
  // even labels prompt/response content is dropped rather than risk carrying it.
  /\b(?:prompt|response|completion|message[_-]?content|file[_-]?content|clipboard)\b\s*[:=]/i,
  // Long unbroken base64/hex-looking blobs (>= 40 chars) — the shape of an
  // encoded secret or payload that slipped past the labelled patterns.
  /[A-Za-z0-9+/_-]{40,}={0,2}/,
];

/**
 * Drop every log line that matches a secret/content pattern. Pure and exported
 * for direct unit testing. Input is already schema-bounded (count + per-line
 * length), so this is O(lines × patterns) on a bounded input. Returns the kept
 * lines plus how many were dropped, so the sink can record that a scrub
 * happened without recording what it dropped.
 */
export function scrubLogTail(lines: readonly string[]): {
  kept: string[];
  dropped: number;
} {
  const kept: string[] = [];
  let dropped = 0;
  for (const line of lines) {
    if (SECRET_LINE_PATTERNS.some((re) => re.test(line))) {
      dropped += 1;
      continue;
    }
    kept.push(line);
  }
  return { kept, dropped };
}

// --- Sink --------------------------------------------------------------------

export type DiagnosticsOutcome = {
  status: 200 | 400 | 401 | 403 | 413;
  body: Record<string, unknown>;
};

/**
 * The structured line shape emitted to Workers Logs. Counts/versions/states/
 * sanitized-logs ONLY — mirrors the validated bundle minus the raw (unscrubbed)
 * logTail, which is replaced by its scrubbed form + a drop count. Exported so
 * the test can assert the emitted record carries no payload field.
 */
export type DiagnosticsLogRecord = {
  evt: "desktop.diagnostics";
  orgId: string;
  connectionId: string;
  agentVersion: string;
  platform: DiagnosticBundle["platform"];
  architecture: DiagnosticBundle["architecture"];
  connectorStates: DiagnosticBundle["connectorStates"];
  queueCounts: DiagnosticBundle["queueCounts"];
  lastSuccessfulSync: string | null;
  configVersion: number;
  policyVersion: string;
  updateState: DiagnosticBundle["updateState"];
  logTail: string[];
  logLinesDropped: number;
};

/** Injectable emit seam so the test can capture the record without parsing
 * stdout. Defaults to a single structured `console.log` JSON line (Workers
 * Logs / `wrangler tail`), the request-timing.ts convention. */
export type DiagnosticsEmit = (record: DiagnosticsLogRecord) => void;

const defaultEmit: DiagnosticsEmit = (record) => {
  // One structured line — the Workers Logs sink. No bearer token, no
  // credential, no raw (unscrubbed) log line is ever in `record`.
  console.log(JSON.stringify(record));
};

/**
 * Authenticate the device token, validate the bundle, re-scrub the log tail,
 * and emit ONE structured diagnostics line to Workers Logs. Returns the outcome
 * the route serializes. A paused/revoked device fails auth (403 paused / 401
 * credential gone) and never reaches validation or emit.
 *
 * No DB write: the sink is Workers Logs, so there is no org-scoped table to
 * touch. Auth still goes through the sanctioned `forOrg`-backed device-token
 * verifier (which is the only DB access on this path — a read, for auth).
 */
export async function recordDesktopDiagnostics(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
  rawBody: unknown,
  emit: DiagnosticsEmit = defaultEmit,
): Promise<DiagnosticsOutcome> {
  // --- 1. Authenticate (cheap, before touching the body) ---------------
  const auth = await authenticateDeviceToken(db, env, bearerToken);
  if (!auth.ok) {
    return { status: auth.status, body: auth.body };
  }
  // Diagnostics are for desktop-agent devices only — restrict to the device
  // vendor so a future device_token vendor can't post here. Indistinguishable
  // 401 (same as heartbeat).
  if (auth.connection.vendor !== DEVICE_VENDOR) {
    return { status: 401, body: { error: "invalid device token" } };
  }

  // --- 2. Validate (authenticated callers only) -------------------------
  const parsed = diagnosticBundleSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid request", issues: parsed.error.flatten() },
    };
  }

  // --- 3. Re-scrub the log tail (defense-in-depth) ----------------------
  const { kept, dropped } = scrubLogTail(parsed.data.logTail);

  // --- 4. Emit ONE structured line to Workers Logs (no DB write) --------
  emit({
    evt: "desktop.diagnostics",
    orgId: auth.orgId,
    connectionId: auth.connectionId,
    agentVersion: parsed.data.agentVersion,
    platform: parsed.data.platform,
    architecture: parsed.data.architecture,
    connectorStates: parsed.data.connectorStates,
    queueCounts: parsed.data.queueCounts,
    lastSuccessfulSync: parsed.data.lastSuccessfulSync,
    configVersion: parsed.data.configVersion,
    policyVersion: parsed.data.policyVersion,
    updateState: parsed.data.updateState,
    logTail: kept,
    logLinesDropped: dropped,
  });

  return { status: 200, body: { ok: true, logLinesDropped: dropped } };
}
