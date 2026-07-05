import type {
  Connector,
  ConnectorContext,
  DateWindow,
  RawPayloadEnvelope,
  SubjectDescriptor,
} from "../../contracts/connector";
import type { RegisteredConnector } from "../registry";
import {
  callSpacing,
  CALL_SPACING_MS,
  checkAdminKey,
  fetchCompletionsUsage,
  fetchCosts,
  fetchOrgUsers,
  type FetchFn,
} from "./client";
import { normalizeOpenAi } from "./normalize";
import { ENVELOPE_KINDS, type OpenAiRaw } from "./types";

// OpenAI connector — ONE connector with two credential modes (execution
// plan W1-D), never two connectors:
//   - personal_key (W1-D, Personal mode): the user's own admin key on their
//     personal org ("every API account is an org" — org of one).
//   - org_admin (W2-J, Team mode): an org owner's admin key; adds
//     project/key discovery UX, not new data semantics.
// connection.config.mode records which; poll() and normalize() are
// IDENTICAL — attribution honesty comes from the data (user_id presence),
// not from the mode.

function fetchFrom(ctx: ConnectorContext): FetchFn {
  const injected = ctx.connection.config.fetchImpl;
  return typeof injected === "function" ? (injected as FetchFn) : fetch;
}

export const openAiConnector: Connector<OpenAiRaw> = {
  vendor: "openai",
  capabilities: {
    subDaily: "1h",
    attributionCeiling: "person", // user-owned keys only; else key/account
    // usage is minutes-fresh but costs lag up to ~24h (NLV-O7) — re-poll a
    // trailing 3 days so restatements land via the upsert key.
    restatementWindowDays: 3,
    // Undocumented floor; cursors reportedly walk a year+ (NLV-O5). null =
    // dispatch clamps to the framework default (90d).
    maxBackfillDays: null,
  },

  async validateAuth(ctx) {
    return checkAdminKey(ctx.credential, fetchFrom(ctx));
  },

  async discover(ctx) {
    const users = await fetchOrgUsers(ctx.credential, fetchFrom(ctx));
    // externalId joins usage `user_id` (key owners); email feeds W2-K.
    return users.map(
      (u): SubjectDescriptor => ({
        kind: "person",
        externalId: `user:${u.id}`,
        email: u.email,
        displayName: u.name,
        meta: { role: u.role },
      }),
    );
  },

  async poll(ctx, window: DateWindow) {
    const fetchFn = fetchFrom(ctx);
    const envelopes: RawPayloadEnvelope<OpenAiRaw>[] = [];

    const usagePages = await fetchCompletionsUsage(ctx.credential, window, fetchFn);
    for (const page of usagePages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.completions,
        window,
        payload: { surface: "usage_completions", page },
      });
    }
    await callSpacing(CALL_SPACING_MS);

    const costPages = await fetchCosts(ctx.credential, window, fetchFn);
    for (const page of costPages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.costs,
        window,
        payload: { surface: "costs", page },
      });
    }
    ctx.log(
      `openai: ${envelopes.length} envelopes for ${window.start}..${window.end}`,
    );
    return envelopes;
  },

  normalize: normalizeOpenAi,
};

export const openAiEntry: RegisteredConnector = {
  connector: openAiConnector as Connector,
  sourceConnector: "openai@1",
  // Per covered day: 1h usage buckets (168/request → ~1 call per week) +
  // costs (180d/request) + pagination headroom ≈ 2.
  maxCallsPerDay: 2,
  pollIntervalMinutes: 60,
};
