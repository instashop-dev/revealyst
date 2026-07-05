import type { AttributionLevel, SubjectKind, VendorId } from "./attribution";
import type { MetricRecordInput, SubjectDaySignalInput } from "./metrics";

// The frozen W0-C Connector interface — the contract every vendor
// connector (W1-D, W1-E, W2-J) implements and every fixture harness
// (W1-S) records against. Changing ANY shape here post-freeze is an ADR.
//
// Design invariants:
// - normalize() is PURE (no I/O, no clock): the rule-2 fixture seam.
//   Recorded payloads in → deterministic records/signals/gaps out.
// - Credentials reach a connector only through ConnectorContext inside the
//   poller's withCredential scope; they never appear in return values.
// - Honesty gaps are first-class output, surfaced to the UI — degraded
//   attribution is reported, never papered over (invariant b).

/** Inclusive UTC calendar-day window. */
export type DateWindow = { start: string; end: string };

export type AuthCheckResult =
  | { ok: true; details?: string }
  | { ok: false; reason: string };

/** Per-vendor person-level holes the schema represents honestly. */
export type HonestyGap = {
  kind:
    | "oauth_actors_missing" // Anthropic Console bug #27780
    | "telemetry_only_users_in_totals" // Copilot server-side telemetry
    | "shared_key_not_person_level" // OpenAI shared/service keys
    | "service_accounts_unresolved" // Cursor service accounts
    | "sub_daily_unavailable" // Copilot: daily grain only
    | "other";
  detail?: string;
};

/** What discover() emits — upserted on (connection, kind, external_id). */
export type SubjectDescriptor = {
  kind: SubjectKind;
  externalId: string;
  email?: string | null;
  displayName?: string | null;
  meta?: Record<string, unknown>;
};

/** A fetched vendor payload: poll() lands these in raw_payloads and hands
 * them (or replayed fixtures) to normalize(). */
export type RawPayloadEnvelope<Raw = unknown> = {
  /** Endpoint/report id, e.g. 'copilot.users-1-day'. */
  kind: string;
  window: DateWindow | null;
  payload: Raw;
  /** Set when the envelope was landed in raw_payloads (absent in pure
   * fixture replay). */
  rawPayloadId?: string;
};

export type NormalizedBatch = {
  records: MetricRecordInput[];
  signals: SubjectDaySignalInput[];
  gaps: HonestyGap[];
};

export type ConnectorContext = {
  connection: {
    id: string;
    orgId: string;
    vendor: VendorId;
    config: Record<string, unknown>;
  };
  /** Decrypted for the duration of the poll only (withCredential scope). */
  credential: string;
  now(): Date;
  log(message: string): void;
};

export type ConnectorCapabilities = {
  /** Finest intra-day grain the vendor exposes ('none' = Copilot). */
  subDaily: "none" | "1h" | "1m" | "event";
  /** Best attribution this vendor can ever honestly claim. */
  attributionCeiling: AttributionLevel;
  /** Trailing days to re-poll every run (vendors restate recent data). */
  restatementWindowDays: number;
  /** Max backfill depth in days; null = undocumented/unbounded. */
  maxBackfillDays: number | null;
};

export interface Connector<Raw = unknown> {
  vendor: VendorId;
  capabilities: ConnectorCapabilities;
  validateAuth(ctx: ConnectorContext): Promise<AuthCheckResult>;
  discover(ctx: ConnectorContext): Promise<SubjectDescriptor[]>;
  poll(
    ctx: ConnectorContext,
    window: DateWindow,
  ): Promise<RawPayloadEnvelope<Raw>[]>;
  /** PURE — fixture-testable with no I/O. */
  normalize(raw: RawPayloadEnvelope<Raw>): NormalizedBatch;
}
