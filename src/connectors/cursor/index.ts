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
  fetchDailyUsage,
  fetchMembers,
  fetchUsageEvents,
  type FetchFn,
} from "./client";
import { normalizeCursor } from "./normalize";
import { ENVELOPE_KINDS, type CursorRaw } from "./types";

// Cursor connector (W2-J Team surface). Admin API key, no external
// approval. Person-level (numeric userId + email); service accounts are
// surfaced-not-billed. Two surfaces: daily-usage-data (prompts, acceptance,
// lines — no tokens) and filtered-usage-events (tokens, spend, model mix,
// and the only sub-daily signal any vendor gives at event grain).

/** Test seam: poll uses ctx.config.fetchImpl if a test injected one. */
function fetchFrom(ctx: ConnectorContext): FetchFn {
  const injected = ctx.connection.config.fetchImpl;
  return typeof injected === "function" ? (injected as FetchFn) : fetch;
}

export const cursorConnector: Connector<CursorRaw> = {
  vendor: "cursor",
  capabilities: {
    subDaily: "event", // filtered-usage-events per-request timestamps
    attributionCeiling: "person",
    // Today's row mutates (hourly aggregation) and the trailing 24–48h is
    // unstable (facts §2) — re-poll 2 trailing days so restatements land.
    restatementWindowDays: 2,
    // 30-day window caps per request; max lookback undocumented (NLV-U2).
    // null = dispatch clamps to the framework default backfill depth.
    maxBackfillDays: null,
  },

  async validateAuth(ctx) {
    return checkAdminKey(ctx.credential, fetchFrom(ctx));
  },

  async discover(ctx) {
    const members = await fetchMembers(ctx.credential, fetchFrom(ctx));
    // People are keyed by email (the identifier events also carry); the
    // numeric userId is kept in meta for reference/debugging.
    return members.map(
      (m): SubjectDescriptor => ({
        kind: "person",
        externalId: `email:${m.email.toLowerCase()}`,
        email: m.email,
        displayName: m.name,
        meta: { userId: m.id, role: m.role, isRemoved: m.isRemoved ?? false },
      }),
    );
  },

  async poll(ctx, window: DateWindow) {
    const fetchFn = fetchFrom(ctx);
    const envelopes: RawPayloadEnvelope<CursorRaw>[] = [];

    // Each surface lands as ONE page-concatenated envelope so normalize()
    // sums a (person, day) across all pages in a single pass (the metric
    // upsert is replace-on-conflict, not additive — see types.ts).
    const rows = await fetchDailyUsage(ctx.credential, window, fetchFn);
    envelopes.push({
      kind: ENVELOPE_KINDS.dailyUsage,
      window,
      payload: { surface: "daily_usage", rows },
    });
    await callSpacing(CALL_SPACING_MS);

    const events = await fetchUsageEvents(ctx.credential, window, fetchFn);
    envelopes.push({
      kind: ENVELOPE_KINDS.usageEvents,
      window,
      payload: { surface: "usage_events", events },
    });

    ctx.log(
      `cursor: ${rows.length} daily rows + ${events.length} events for ${window.start}..${window.end}`,
    );
    return envelopes;
  },

  normalize: normalizeCursor,
};

export const cursorEntry: RegisteredConnector = {
  connector: cursorConnector as Connector,
  sourceConnector: "cursor@1",
  // Per covered day, worst case: daily-usage member pages (~1 for a normal
  // team) + event pages (several on a busy day) + headroom ≈ 6.
  maxCallsPerDay: 6,
  // Facts §2: poll ≤1/hr for daily-usage-data / filtered-usage-events.
  pollIntervalMinutes: 60,
};
