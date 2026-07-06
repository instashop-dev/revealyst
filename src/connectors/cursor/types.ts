// Raw payload shapes for the Cursor Admin API, per docs/connector-facts.md
// §2 (retrieved 2026-07-04). Base URL https://api.cursor.com. Person-level
// (numeric userId + email); service accounts are unresolved subjects
// (surfaced, not billed — the tracked_user rule).
//
// IMPORTANT (framework interaction): filtered-usage-events paginate by
// EVENT count, so one (person, day) spans many pages. metric_records
// upsert is REPLACE-on-conflict (last-wins), never additive — so poll()
// concatenates every page of a surface into ONE envelope and normalize()
// sums across it in a single pass. daily-usage rows are per (member, day),
// disjoint across member pages, but are concatenated the same way for
// uniformity.

/** GET /teams/members — roster. */
export type CursorMember = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  isRemoved?: boolean;
};

export type CursorMembersResponse = {
  teamMembers: CursorMember[];
};

/**
 * POST /teams/daily-usage-data — per-user × per-day. With page/pageSize it
 * returns ALL members incl. `isActive`; WITHOUT pagination it returns
 * active users only (a silent undercount — so the client always paginates).
 * No tokens and no per-model breakdown live here (facts §2).
 */
export type CursorDailyUsageRow = {
  userId: number;
  email: string;
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Epoch-ms of the day bucket (kept for reference; `day` is authoritative). */
  date?: number;
  isActive: boolean;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  acceptedLinesAdded: number;
  acceptedLinesDeleted: number;
  totalApplies: number;
  totalAccepts: number;
  totalRejects: number;
  totalTabsShown: number;
  totalTabsAccepted: number;
  composerRequests: number;
  chatRequests: number;
  agentRequests: number;
  cmdkUsages: number;
  bugbotUsages: number;
  subscriptionIncludedReqs: number;
  apiKeyReqs: number;
  usageBasedReqs: number;
  mostUsedModel: string | null;
  applyMostUsedExtension: string | null;
  tabMostUsedExtension: string | null;
  clientVersion: string | null;
};

export type CursorDailyUsageResponse = {
  data: CursorDailyUsageRow[];
};

/**
 * POST /teams/filtered-usage-events — event-level, one row per AI request.
 * The ONLY token/spend/sub-daily source for this vendor. `userEmail` keys
 * the person; a `serviceAccountId` (no user email) is an unresolved
 * subject.
 */
export type CursorUsageEvent = {
  /** Epoch-ms string. */
  timestamp: string;
  userEmail: string | null;
  serviceAccountId: string | null;
  serviceAccountName: string | null;
  model: string | null;
  /** Enum undocumented (NLV-U11) — treated as an opaque feature label. */
  kind: string | null;
  maxMode: boolean;
  isHeadless: boolean;
  isTokenBasedCall: boolean;
  isChargeable: boolean;
  requestsCosts: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalCents: number;
    discountPercentOff: number;
  } | null;
  /** Reconciliation field — the amount actually charged for the event. */
  chargedCents: number;
  cursorTokenFee: number;
};

export type CursorUsageEventsResponse = {
  usageEvents: CursorUsageEvent[];
};

/** Discriminated raw union the connector's envelopes carry. Each variant is
 * the FULL, page-concatenated payload for its surface (see note above). */
export type CursorRaw =
  | { surface: "daily_usage"; rows: CursorDailyUsageRow[] }
  | { surface: "usage_events"; events: CursorUsageEvent[] };

export const ENVELOPE_KINDS = {
  dailyUsage: "cursor.daily-usage-data",
  usageEvents: "cursor.filtered-usage-events",
} as const;
