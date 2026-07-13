import { z } from "zod";
import { ATTRIBUTION_LEVELS } from "./attribution";
import {
  METRIC_KEYS,
  metricRecordInputSchema,
  subjectDaySignalInputSchema,
  type MetricKey,
} from "./metrics";
import { PERIOD_GRAINS, SCORE_SUBJECT_LEVELS } from "./scores";

// Frozen W0-C internal API-route contracts — the shapes W1-G's shell and
// the W2 dashboards bind to, and W1-S's contract tests enforce against
// route handlers. Privacy is enforced BY SHAPE:
// - Person-bearing responses expose { id, pseudonym, displayName|null } —
//   displayName is only non-null when the org's visibility mode permits.
// - Credentials are WRITE-ONLY: there is no credential-read route, and no
//   response schema carries credential material.
// - Billing responses surface unresolved subjects alongside the billable
//   count — "surfaced, not billed" is part of the payload shape itself.

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// STRICT: a person payload carrying anything beyond these three fields
// (email, auth ids, …) fails the contract — privacy enforced by shape.
export const personRefSchema = z.strictObject({
  id: uuid,
  pseudonym: z.string(),
  displayName: z.string().nullable(),
});

export const periodQuerySchema = z.object({ from: day, to: day });

const vendorSchema = z.enum([
  "github_copilot",
  "cursor",
  "anthropic_console",
  "anthropic_claude_enterprise",
  "openai",
  "claude_code_local",
]);

export const connectionSchema = z.object({
  id: uuid,
  vendor: vendorSchema,
  displayName: z.string(),
  status: z.enum(["pending", "active", "paused", "error"]),
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});

export const subjectSchema = z.object({
  id: uuid,
  connectionId: uuid,
  kind: z.enum([
    "person",
    "api_key",
    "service_account",
    "workspace",
    "project",
    "account",
  ]),
  externalId: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  resolved: z.boolean(),
});

export const scoreResultSchema = z.object({
  definitionSlug: z.string(),
  definitionVersion: z.number().int(),
  subjectLevel: z.enum(SCORE_SUBJECT_LEVELS),
  person: personRefSchema.nullable(),
  teamId: uuid.nullable(),
  periodStart: day,
  periodEnd: day,
  periodGrain: z.enum(PERIOD_GRAINS),
  value: z.number(),
  attribution: z.enum(ATTRIBUTION_LEVELS),
  components: z.record(z.string(), z.unknown()),
});

// --- Revealyst Agent ingest (W1-E, ADR 0002 — additive) -------------------
// The CLI summarizes Claude Code logs LOCALLY and pushes only these shapes.
// Privacy enforced by shape: the request schema admits metric rows, subject
// descriptors, and honesty gaps — no field can carry log lines, prompt
// content, file paths, or tool output.

export const subjectDescriptorSchema = z.object({
  kind: z.enum([
    "person",
    "api_key",
    "service_account",
    "workspace",
    "project",
    "account",
  ]),
  externalId: z.string().min(1).max(320),
  email: z.string().max(320).nullable().default(null),
  displayName: z.string().max(200).nullable().default(null),
});

export const honestyGapSchema = z.object({
  kind: z.enum([
    "oauth_actors_missing",
    "telemetry_only_users_in_totals",
    "shared_key_not_person_level",
    "service_accounts_unresolved",
    "sub_daily_unavailable",
    "sync_window_incomplete", // ADR 0025
    "other",
  ]),
  detail: z.string().max(500).optional(),
});

export const agentIngestRequestSchema = z.object({
  /** CLI package version, informational (e.g. "0.1.0"). */
  agentVersion: z.string().min(1).max(64),
  /** Version of the local summarizer's semantics; the server composes
   * source_connector as `claude-code-local@<summarizerVersion>`. */
  summarizerVersion: z.number().int().min(1),
  window: z.object({ start: day, end: day }),
  /** Every record/signal must reference one of these by (kind, externalId). */
  subjects: z.array(subjectDescriptorSchema).min(1).max(1_000),
  records: z.array(metricRecordInputSchema).max(100_000),
  signals: z.array(subjectDaySignalInputSchema).max(10_000),
  gaps: z.array(honestyGapSchema).max(100),
});
export type AgentIngestRequest = z.infer<typeof agentIngestRequestSchema>;

/** One frozen route contract: path + method + request/response schemas. */
export type RouteContract = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  request: z.ZodType | null;
  response: z.ZodType;
};

const ok = z.object({ ok: z.literal(true) });

export const apiRoutes = {
  me: {
    method: "GET",
    path: "/api/me",
    request: null,
    response: z.object({
      userId: z.string(),
      org: z.object({
        id: uuid,
        name: z.string(),
        kind: z.enum(["personal", "team", "system"]),
        visibilityMode: z.enum(["private", "managed", "full"]),
      }),
      role: z.enum(["admin", "member"]),
    }),
  },

  connectionsList: {
    method: "GET",
    path: "/api/connections",
    request: null,
    response: z.object({ connections: z.array(connectionSchema) }),
  },
  connectionsCreate: {
    method: "POST",
    path: "/api/connections",
    request: z.object({
      vendor: vendorSchema,
      displayName: z.string().min(1),
      authKind: z.enum([
        "api_key",
        "admin_key",
        "analytics_key",
        "github_app",
        "pat",
        "device_token",
      ]),
      config: z.record(z.string(), z.unknown()).default({}),
    }),
    response: z.object({ connection: connectionSchema }),
  },
  /** WRITE-ONLY: the credential goes in; only `ok` comes back. No read
   * route exists anywhere in this contract. */
  connectionCredentialPut: {
    method: "POST",
    path: "/api/connections/:id/credential",
    request: z.object({
      kind: z.enum([
        "api_key",
        "github_app_private_key",
        "github_app_installation",
        "pat",
        "device_token",
      ]),
      value: z.string().min(1),
      expiresAt: z.string().datetime().nullable().default(null),
    }),
    response: ok,
  },
  /** ADR 0002. Issues (or rotates) the connection's device token and
   * returns it ONCE — the narrow, deliberate exception to credential
   * write-only-ness: issuance-time display is the only way device pairing
   * can work. The stored credential remains read-never after this response;
   * re-issuing overwrites the previous secret. */
  connectionAgentTokenCreate: {
    method: "POST",
    path: "/api/connections/:id/agent-token",
    request: null,
    response: z.object({ token: z.string() }),
  },
  /** ADR 0002. Bearer-authenticated by the device token itself (format
   * rva1.<orgId>.<connectionId>.<secret>) — no session. A push is
   * authoritative for its window: the server transactionally replaces the
   * connection's records/signals inside the window (delete-then-upsert on
   * the frozen natural key), so re-pushes restate without over-counting.
   * Every record/signal day must fall inside `window`. */
  agentIngest: {
    method: "POST",
    path: "/api/agent/ingest",
    request: agentIngestRequestSchema,
    response: z.object({
      ok: z.literal(true),
      subjects: z.number().int(),
      records: z.number().int(),
      signals: z.number().int(),
    }),
  },
  connectionsPoll: {
    method: "POST",
    path: "/api/connections/:id/poll",
    request: null,
    response: ok,
  },
  /** ADR 0013. Rename and/or pause-resume; config is create-time only and
   * credential material goes exclusively through connectionCredentialPut —
   * this route can never carry it. Admin-only at the handler. An empty patch
   * is a 400 (a no-op "update" would fabricate audit-trail entries). Resuming
   * a never-synced connection lands "pending", not "active" — the row never
   * claims a health it hasn't demonstrated (invariant b). */
  connectionsUpdate: {
    method: "PATCH",
    path: "/api/connections/:id",
    request: z
      .object({
        displayName: z.string().min(1).optional(),
        status: z.enum(["active", "paused"]).optional(),
      })
      .refine((patch) => Object.keys(patch).length > 0, {
        message: "at least one field required",
      }),
    response: z.object({ connection: connectionSchema }),
  },
  connectionsDelete: {
    method: "DELETE",
    path: "/api/connections/:id",
    request: null,
    response: ok,
  },

  teamsList: {
    method: "GET",
    path: "/api/teams",
    request: null,
    response: z.object({
      teams: z.array(
        z.object({ id: uuid, name: z.string(), memberCount: z.number().int() }),
      ),
    }),
  },
  teamsCreate: {
    method: "POST",
    path: "/api/teams",
    request: z.object({ name: z.string().min(1) }),
    response: z.object({ id: uuid, name: z.string() }),
  },
  teamsPutMembers: {
    method: "PUT",
    path: "/api/teams/:id/members",
    request: z.object({ personIds: z.array(uuid) }),
    response: ok,
  },

  peopleList: {
    method: "GET",
    path: "/api/people",
    request: null,
    response: z.object({ people: z.array(personRefSchema) }),
  },

  subjectsList: {
    method: "GET",
    path: "/api/subjects",
    request: z.object({ resolved: z.enum(["true", "false"]).optional() }),
    response: z.object({ subjects: z.array(subjectSchema) }),
  },
  identitiesCreate: {
    method: "POST",
    path: "/api/identities",
    request: z.object({
      subjectId: uuid,
      personId: uuid,
      method: z.enum(["email_match", "manual", "vendor_asserted"]),
    }),
    response: ok,
  },
  identitiesDelete: {
    method: "DELETE",
    path: "/api/identities/:subjectId/:personId",
    request: null,
    response: ok,
  },

  dashboardSummary: {
    method: "GET",
    path: "/api/dashboard/summary",
    request: periodQuerySchema,
    response: z.object({
      scores: z.array(scoreResultSchema),
      spendCents: z.number(),
      spendCentsEstimated: z.number(),
      activePeople: z.number().int(),
      unresolvedSubjects: z.number().int(),
      gaps: z.array(
        z.object({ kind: z.string(), detail: z.string().optional() }),
      ),
    }),
  },
  scoresList: {
    method: "GET",
    path: "/api/scores",
    request: periodQuerySchema.extend({
      slug: z.string().optional(),
      level: z.enum(SCORE_SUBJECT_LEVELS).optional(),
    }),
    response: z.object({ results: z.array(scoreResultSchema) }),
  },
  metricsSeries: {
    method: "GET",
    path: "/api/metrics",
    request: periodQuerySchema.extend({
      metric: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]),
      dim: z.string().optional(),
    }),
    response: z.object({
      series: z.array(
        z.object({
          day,
          value: z.number(),
          attribution: z.enum(ATTRIBUTION_LEVELS),
        }),
      ),
    }),
  },

  billingTrackedUsers: {
    method: "GET",
    path: "/api/billing/tracked-users",
    request: periodQuerySchema,
    response: z.object({
      trackedUsers: z.number().int(),
      trackedPeople: z.array(personRefSchema),
      /** Surfaced, NOT billed — by shape. */
      unresolvedSubjects: z.array(subjectSchema),
    }),
  },

  // Paddle Checkout: creates a server-side transaction with org_id bound from
  // the session (ADR 0011), returns the opaque transaction id + the client-safe
  // token/environment the overlay needs. Never sends the server API key.
  billingCheckout: {
    method: "POST",
    path: "/api/billing/checkout",
    request: null,
    response: z.object({
      transactionId: z.string(),
      clientToken: z.string(),
      environment: z.enum(["sandbox", "production"]),
    }),
  },

  // Org settings mutation (ADR 0018, W4-W): rename and/or change the
  // visibility mode — the single most privacy-sensitive mutation in the
  // product (§9.1). Admin-only at the handler; every changed field writes an
  // audit_log entry. An empty patch is a 400 (a no-op "update" would fabricate
  // audit-trail entries, same rule as connectionsUpdate). The current values
  // are read server-side from the session's org (the frozen `me` route already
  // exposes them), so there is no settings-read route. The response carries
  // only the non-sensitive `org` shape `me` already returns.
  settingsUpdate: {
    method: "PATCH",
    path: "/api/settings",
    request: z
      .object({
        // Trimmed server-side: a whitespace-only name would otherwise pass
        // min(1) and blank the workspace name everywhere it renders.
        name: z.string().trim().min(1).optional(),
        visibilityMode: z.enum(["private", "managed", "full"]).optional(),
      })
      .refine((patch) => Object.keys(patch).length > 0, {
        message: "at least one field required",
      }),
    response: z.object({
      org: z.object({
        id: uuid,
        name: z.string(),
        kind: z.enum(["personal", "team", "system"]),
        visibilityMode: z.enum(["private", "managed", "full"]),
      }),
    }),
  },

  // Spend Governance (W4-V, ADR 0020). Admin-set org monthly budget +
  // in-app threshold alert. Observed month-to-date spend and the crossed
  // threshold are DERIVED at read time from spend_cents / spend_cents_estimated
  // metric_records — never a stored ledger. Cents throughout (like
  // metric_records spend_cents); the split into vendor-reported vs. derived is
  // preserved in `monthToDate` so no honesty gap is blended away (invariant b).
  budgetGet: {
    method: "GET",
    path: "/api/budget",
    request: null,
    response: z.object({
      budget: z
        .object({
          monthlyLimitCents: z.number().int().positive(),
          alertThresholds: z.array(z.number().int()),
        })
        .nullable(),
      monthToDate: z.object({
        reportedCents: z.number(),
        estimatedCents: z.number(),
      }),
      alert: z
        .object({
          crossedThreshold: z.number().int(),
          pctUsed: z.number(),
          overBudget: z.boolean(),
        })
        .nullable(),
    }),
  },
  budgetSet: {
    method: "PUT",
    path: "/api/budget",
    request: z.object({
      monthlyLimitCents: z.number().int().positive(),
      alertThresholds: z
        .array(z.number().int().min(1).max(1000))
        .min(1)
        .max(10)
        .optional(),
    }),
    response: z.object({
      budget: z.object({
        monthlyLimitCents: z.number().int().positive(),
        alertThresholds: z.array(z.number().int()),
      }),
    }),
  },

  // Recommendation interaction state (W5-D, ADR 0028) — the Outcomes-loop
  // forerunner (§8.3). A person snoozes / dismisses / marks-tried ONE coaching
  // recommendation. SELF-VIEW ONLY: `personId` must be the caller's OWN person
  // (people.auth_user_id === session user) — the handler 403s otherwise, so a
  // manager can never write (or, by the absence of any read route, read)
  // another person's state. `recId` must be a known static-map id. `snoozeDays`
  // applies only to `snoozed` (server clamps + defaults it); the server derives
  // the absolute `snooze_until`, never the client. WRITE-ONLY by shape: only
  // `ok` comes back — there is no interaction-state read route anywhere in this
  // contract (the state is folded into the self-view page server-side).
  recInteractionSet: {
    method: "POST",
    path: "/api/recommendations/interaction",
    request: z.object({
      personId: uuid,
      recId: z.string().min(1),
      state: z.enum(["snoozed", "dismissed", "tried"]),
      snoozeDays: z.number().int().min(1).max(90).optional(),
    }),
    response: ok,
  },

  // Person → engineering-role assignment (W6-B, ADR 0030). Admin-set org config
  // (NOT self-view — a manager assigns roles), so `adminOnly` at the handler and
  // the 402 free-band gate applies by default. `roleSlug` null UNassigns; a
  // non-null value must be a known `roles` slug (the handler 400s otherwise) and
  // `personId` must belong to the caller's org (404 otherwise; the composite
  // tenant FK is the backstop). WRITE-ONLY by shape: only `ok` comes back — the
  // current assignments are read server-side into the Settings page (no
  // assignment-read route). Nothing else consumes roles until W6-C.
  roleAssignmentSet: {
    method: "PUT",
    path: "/api/people/:id/role",
    request: z.object({ roleSlug: z.string().min(1).nullable() }),
    response: ok,
  },

  // Paddle hosted customer portal: creates a fresh authenticated session (ADR
  // 0011) and returns its links. Generated per request, never cached.
  billingPortal: {
    method: "GET",
    path: "/api/billing/portal",
    request: null,
    response: z.object({
      overviewUrl: z.string().url(),
      cancelUrl: z.string().url().nullable(),
      updatePaymentUrl: z.string().url().nullable(),
    }),
  },
} as const satisfies Record<string, RouteContract>;

/** ADR 0013 — the PATCH body, derived from the frozen schema so impl layers
 * can't drift from the contract. */
export type ConnectionsUpdateRequest = z.infer<
  typeof apiRoutes.connectionsUpdate.request
>;

/** ADR 0018 — the PATCH /api/settings body, derived from the frozen schema so
 * impl layers can't drift from the contract. */
export type SettingsUpdateRequest = z.infer<
  typeof apiRoutes.settingsUpdate.request
>;
