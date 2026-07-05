import { z } from "zod";
import { ATTRIBUTION_LEVELS } from "./attribution";
import { METRIC_KEYS, type MetricKey } from "./metrics";
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

/** One frozen route contract: path + method + request/response schemas. */
export type RouteContract = {
  method: "GET" | "POST" | "PUT" | "DELETE";
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
  connectionsPoll: {
    method: "POST",
    path: "/api/connections/:id/poll",
    request: null,
    response: ok,
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
} as const satisfies Record<string, RouteContract>;
