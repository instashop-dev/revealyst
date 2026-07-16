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
  fetchCodeInterpreterUsage,
  fetchCompletionsUsage,
  fetchCosts,
  fetchOrgUsers,
  fetchProjectApiKeys,
  fetchProjects,
  fetchWebSearchUsage,
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
    const fetchFn = fetchFrom(ctx);
    const users = await fetchOrgUsers(ctx.credential, fetchFn);
    // externalId joins usage `user_id` (key owners); email feeds W2-K.
    const subjects: SubjectDescriptor[] = users.map((u) => ({
      kind: "person",
      externalId: `user:${u.id}`,
      email: u.email,
      displayName: u.name,
      meta: { role: u.role },
    }));

    // Org-admin mode (W2-J, Team): also enumerate projects and their API
    // keys, so an admin sees exactly what's covered and which keys resolve
    // to a person (owner.type "user" → usage attributes to that user_id)
    // vs stay key-level (service accounts — the shared_key_not_person_level
    // case). These are coverage/identity-map subjects: a key's usage still
    // lands on the person subject when user-owned, so no double count. The
    // key `externalId` is the raw key id — the same value normalize() keys
    // api_key subjects by (usage `api_key_id`), so they merge. Personal
    // mode (org of one) skips all this — its one user + own key already
    // discovered above, and the extra calls buy nothing.
    if (ctx.connection.config.mode === "org_admin") {
      const projects = await fetchProjects(ctx.credential, fetchFn);
      for (const p of projects) {
        subjects.push({
          kind: "project",
          externalId: `project:${p.id}`,
          displayName: p.name,
          meta: { status: p.status ?? null },
        });
        await callSpacing(CALL_SPACING_MS);
        const keys = await fetchProjectApiKeys(ctx.credential, p.id, fetchFn);
        for (const k of keys) {
          subjects.push({
            kind: "api_key",
            externalId: k.id,
            displayName: k.name,
            // The key→person map W2-K resolves identity with. A
            // service-account owner has no person → stays unresolved.
            meta: {
              projectId: p.id,
              ownerType: k.owner.type,
              ownerUserId: k.owner.user?.id ?? null,
            },
          });
        }
        await callSpacing(CALL_SPACING_MS);
      }
    }
    return subjects;
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
    await callSpacing(CALL_SPACING_MS);

    // W5-E re-scope (§1.2 (3)): two previously-unfetched usage families that
    // serve the wedge — web-search calls (per-subject feature signal) and
    // code-interpreter sessions (org-level feature presence). Both land as
    // feature_used flags in normalize(); audio/images/embeddings/moderations/
    // vector_stores/file_search stay unfetched (cut order: no score consumes
    // them yet).
    const webSearchPages = await fetchWebSearchUsage(ctx.credential, window, fetchFn);
    for (const page of webSearchPages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.webSearch,
        window,
        payload: { surface: "usage_web_search", page },
      });
    }
    await callSpacing(CALL_SPACING_MS);

    const codeInterpreterPages = await fetchCodeInterpreterUsage(
      ctx.credential,
      window,
      fetchFn,
    );
    for (const page of codeInterpreterPages) {
      envelopes.push({
        kind: ENVELOPE_KINDS.codeInterpreter,
        window,
        payload: { surface: "usage_code_interpreter", page },
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
  scopeClaims: SCOPE_CLAIMS.openai,
  sourceConnector: "openai@1",
  // Per covered day: 1h completions buckets (168/request → ~1 call per week) +
  // costs (180d/request) + web-search-calls (1d) + code-interpreter-sessions
  // (1d) + pagination headroom ≈ 4 (W5-E added the two usage families).
  maxCallsPerDay: 4,
  pollIntervalMinutes: 60,
};
