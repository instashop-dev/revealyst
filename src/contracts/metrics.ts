import { z } from "zod";
import { ATTRIBUTION_LEVELS } from "./attribution";

// Frozen W0-C metric contracts. CANONICAL_METRICS mirrors the seeded
// metric_catalog rows exactly — a contract test asserts the two never
// drift. Post-freeze catalog changes are ADR-gated data migrations that
// update BOTH the seed and this constant.

export const METRIC_FAMILIES = [
  "active_users",
  "sessions",
  "prompts",
  "tokens",
  "spend",
  "model_mix",
  "acceptance",
  "feature_usage",
  "output_shipped",
  // V1.5 (ADR 0018 / §8.3): agent-mediated work — agent sessions, agent
  // requests, agentic adoption. Additive; every vendor maps only the agent
  // fields it genuinely reports (invariant b — no fabricated agent numbers).
  "agentic",
] as const;
export type MetricFamily = (typeof METRIC_FAMILIES)[number];

export const METRIC_UNITS = [
  "count",
  "tokens",
  "usd_cents",
  "lines",
  "flag",
  // V1.5 (ADR 0018 / §10.1): GitHub Copilot usage-based-billing AI Credits.
  // Credits are NOT a dollar amount — any cents conversion is derived and
  // must land on spend_cents_estimated, never presented as billing truth.
  "credits",
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

type CatalogEntry = {
  family: MetricFamily;
  unit: MetricUnit;
  dimKind: "model" | "feature" | null;
};

/** The Level-1 catalog, frozen at contracts-v1 (≡ drizzle/0007 seed). */
export const CANONICAL_METRICS = {
  active_day: { family: "active_users", unit: "flag", dimKind: null },
  sessions: { family: "sessions", unit: "count", dimKind: null },
  prompts: { family: "prompts", unit: "count", dimKind: null },
  tokens_input: { family: "tokens", unit: "tokens", dimKind: null },
  tokens_output: { family: "tokens", unit: "tokens", dimKind: null },
  tokens_cache_read: { family: "tokens", unit: "tokens", dimKind: null },
  tokens_cache_write: { family: "tokens", unit: "tokens", dimKind: null },
  spend_cents: { family: "spend", unit: "usd_cents", dimKind: null },
  spend_cents_estimated: { family: "spend", unit: "usd_cents", dimKind: null },
  model_requests: { family: "model_mix", unit: "count", dimKind: "model" },
  model_tokens: { family: "model_mix", unit: "tokens", dimKind: "model" },
  suggestions_offered: { family: "acceptance", unit: "count", dimKind: null },
  suggestions_accepted: { family: "acceptance", unit: "count", dimKind: null },
  edit_actions_accepted: { family: "acceptance", unit: "count", dimKind: null },
  edit_actions_rejected: { family: "acceptance", unit: "count", dimKind: null },
  retries: { family: "acceptance", unit: "count", dimKind: null },
  feature_used: { family: "feature_usage", unit: "flag", dimKind: "feature" },
  commits: { family: "output_shipped", unit: "count", dimKind: null },
  pull_requests: { family: "output_shipped", unit: "count", dimKind: null },
  lines_added: { family: "output_shipped", unit: "lines", dimKind: null },
  lines_removed: { family: "output_shipped", unit: "lines", dimKind: null },
  lines_suggested: { family: "output_shipped", unit: "lines", dimKind: null },
  // V1.5 agentic metrics (ADR 0018 / §8.3). Each source vendor maps only the
  // agent fields it truly reports: agent_sessions from Copilot CLI sessions +
  // Claude Code sessions; agent_requests from Cursor agentRequests + Copilot
  // agent-mode requests; agent_active is the cross-vendor "used an agent this
  // day" flag. Never fabricated where a vendor has no agent signal.
  agent_sessions: { family: "agentic", unit: "count", dimKind: null },
  agent_requests: { family: "agentic", unit: "count", dimKind: null },
  agent_active: { family: "agentic", unit: "flag", dimKind: null },
  // Copilot AI Credits (ADR 0018 / §10.1) — vendor-reported usage-based-billing
  // credits, a native credits unit. NOT dollars: a cents conversion is
  // derived/estimated (spend_cents_estimated) and labeled, never billing truth.
  ai_credits: { family: "spend", unit: "credits", dimKind: null },
} as const satisfies Record<string, CatalogEntry>;

export type MetricKey = keyof typeof CANONICAL_METRICS;
export const METRIC_KEYS = Object.keys(CANONICAL_METRICS) as MetricKey[];

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "UTC calendar day, YYYY-MM-DD");

/** What Connector.normalize() emits per metric row (pre-subject-resolution:
 * subjects are referenced by their discover() key, not a DB id). */
export const metricRecordInputSchema = z.object({
  subject: z.object({
    kind: z.enum([
      "person",
      "api_key",
      "service_account",
      "workspace",
      "project",
      "account",
    ]),
    externalId: z.string().min(1),
  }),
  metricKey: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]),
  day: daySchema,
  dim: z.string().default(""),
  value: z.number().finite(),
  attribution: z.enum(ATTRIBUTION_LEVELS),
});
export type MetricRecordInput = z.infer<typeof metricRecordInputSchema>;

export const subjectDaySignalInputSchema = z.object({
  subject: z.object({
    kind: z.enum([
      "person",
      "api_key",
      "service_account",
      "workspace",
      "project",
      "account",
    ]),
    externalId: z.string().min(1),
  }),
  day: daySchema,
  hours: z.array(z.number().int().min(0)).length(24).nullable(),
  peakConcurrency: z.number().int().min(0).nullable().default(null),
  sourceGranularity: z.enum(["event", "1m", "1h", "none"]),
});
export type SubjectDaySignalInput = z.infer<typeof subjectDaySignalInputSchema>;
