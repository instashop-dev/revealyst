import type {
  Connector,
  ConnectorContext,
  DateWindow,
  RawPayloadEnvelope,
  SubjectDescriptor,
} from "../../contracts/connector";
import type { RegisteredConnector } from "../registry";
import { SCOPE_CLAIMS } from "../scope-claims";
import {
  callSpacing,
  CALL_SPACING_MS,
  checkAdminKey,
  fetchClaudeCodeDay,
  fetchCostReport,
  fetchOrgUsers,
  fetchUsageMessages,
  type FetchFn,
} from "./client";
import { normalizeAnthropic } from "./normalize";
import { ENVELOPE_KINDS, type AnthropicRaw } from "./types";

// Anthropic Console connector (W1-D's first vendor: key-based, no approval
// wait, serves Personal mode fully, exercises spend + usage + Claude Code
// Analytics — execution plan). The claude.ai Enterprise Analytics surface
// is a separate vendor id (anthropic_claude_enterprise) and a later
// workstream; keys are not interchangeable across surfaces.

/** Test seam: poll uses ctx.config.fetchImpl if a test injected one. */
function fetchFrom(ctx: ConnectorContext): FetchFn {
  const injected = ctx.connection.config.fetchImpl;
  return typeof injected === "function" ? (injected as FetchFn) : fetch;
}

export const anthropicConsoleConnector: Connector<AnthropicRaw> = {
  vendor: "anthropic_console",
  capabilities: {
    subDaily: "1h", // 1m exists; 1h is what we persist (24-slot histogram)
    attributionCeiling: "person",
    // usage/cost fresh ~5min but claude_code lags ~1h and cost is
    // revisable; a 5-day trailing re-poll covers every documented lag.
    restatementWindowDays: 5,
    maxBackfillDays: 90,
  },

  async validateAuth(ctx) {
    return checkAdminKey(ctx.credential, fetchFrom(ctx));
  },

  async discover(ctx) {
    const users = await fetchOrgUsers(ctx.credential, fetchFrom(ctx));
    // externalId joins the usage report's account_id (OAuth requests);
    // email is the W2-K identity-resolution key.
    return users.map(
      (u): SubjectDescriptor => ({
        kind: "person",
        externalId: `acct:${u.id}`,
        email: u.email,
        displayName: u.name,
      }),
    );
  },

  async poll(ctx, window: DateWindow) {
    const fetchFn = fetchFrom(ctx);
    const envelopes: RawPayloadEnvelope<AnthropicRaw>[] = [];

    const usagePages = await fetchUsageMessages(ctx.credential, window, fetchFn);
    for (const page of usagePages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.usage,
        window,
        payload: { surface: "usage_messages", page },
      });
    }
    await callSpacing(CALL_SPACING_MS);

    const costPages = await fetchCostReport(ctx.credential, window, fetchFn);
    for (const page of costPages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.cost,
        window,
        payload: { surface: "cost_report", page },
      });
    }

    // Claude Code Analytics: one UTC day per call (NLV-A13) — the chunk
    // budget (maxCallsPerDay below) accounts for exactly this loop.
    for (let day = window.start; day <= window.end; day = nextDayLocal(day)) {
      await callSpacing(CALL_SPACING_MS);
      const pages = await fetchClaudeCodeDay(ctx.credential, day, fetchFn);
      for (const page of pages) {
        envelopes.push({
          kind: ENVELOPE_KINDS.claudeCode,
          window: { start: day, end: day },
          payload: { surface: "claude_code", page },
        });
      }
    }
    ctx.log(
      `anthropic_console: ${envelopes.length} envelopes for ${window.start}..${window.end}`,
    );
    return envelopes;
  },

  normalize: normalizeAnthropic,
};

function nextDayLocal(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const anthropicConsoleEntry: RegisteredConnector = {
  connector: anthropicConsoleConnector as Connector,
  scopeClaims: SCOPE_CLAIMS.anthropic_console,
  sourceConnector: "anthropic-console@1",
  // Per covered day: 1 claude_code call + amortized usage (1h buckets,
  // 168/request) + cost (31/request) + pagination headroom ≈ 3.
  maxCallsPerDay: 3,
  pollIntervalMinutes: 60,
};
