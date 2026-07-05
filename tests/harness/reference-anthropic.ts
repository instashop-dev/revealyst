import { z } from "zod";
import type {
  Connector,
  NormalizedBatch,
  RawPayloadEnvelope,
} from "../../src/contracts/connector";
import type { MetricRecordInput } from "../../src/contracts/metrics";

// W1-S reference connector for anthropic_console — a REPLAY-ONLY stand-in
// that keeps the cross-workstream E2E runnable before W1-D's real connector
// merges to main (rule 3: never read another workstream's branch). Its
// normalize() is pure and follows docs/connector-facts.md §3 (Claude Code
// Analytics field inventory + Level-1 mapping) so the E2E exercises the real
// seams: RawPayloadEnvelope in → contract-valid records/gaps out.
//
// It is NOT the W1-D deliverable: I/O methods refuse, only the claude_code
// report kind is handled, and tests/harness/seams.ts swaps in the real
// connector the moment it exists on main.

const claudeCodeRowSchema = z
  .object({
    date: z.string(),
    actor: z
      .object({
        type: z.enum(["user_actor", "api_actor"]),
        email_address: z.string().optional(),
        api_key_name: z.string().optional(),
      })
      .loose(),
    terminal_type: z.string().nullish(),
    core_metrics: z
      .object({
        num_sessions: z.number().default(0),
        lines_of_code: z
          .object({ added: z.number().default(0), removed: z.number().default(0) })
          .default({ added: 0, removed: 0 }),
        commits_by_claude_code: z.number().default(0),
        pull_requests_by_claude_code: z.number().default(0),
      })
      .loose(),
    tool_actions: z
      .record(
        z.string(),
        z.object({ accepted: z.number().default(0), rejected: z.number().default(0) }).loose(),
      )
      .default({}),
    model_breakdown: z
      .array(
        z
          .object({
            model: z.string(),
            tokens: z
              .object({
                input: z.number().default(0),
                output: z.number().default(0),
                cache_read: z.number().default(0),
                cache_creation: z.number().default(0),
              })
              .loose(),
            // number cents here vs decimal-string cents in cost_report —
            // the facts file's documented money-format inconsistency.
            estimated_cost: z
              .object({ amount: z.number(), currency: z.string() })
              .loose()
              .nullish(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

const claudeCodePayloadSchema = z
  .object({ data: z.array(claudeCodeRowSchema) })
  .loose();

type Accumulator = {
  subject: MetricRecordInput["subject"];
  attribution: MetricRecordInput["attribution"];
  day: string;
  sums: Map<string, number>; // metricKey|dim -> value
};

function add(acc: Accumulator, metricKey: string, value: number, dim = "") {
  if (value === 0) return;
  const k = `${metricKey}|${dim}`;
  acc.sums.set(k, (acc.sums.get(k) ?? 0) + value);
}

export const referenceAnthropicConsole: Connector = {
  vendor: "anthropic_console",
  capabilities: {
    subDaily: "1m", // messages usage report 1m buckets (facts §3)
    attributionCeiling: "person",
    restatementWindowDays: 4, // worst documented restatement lag
    maxBackfillDays: null, // history floor undocumented (NLV-A3)
  },
  async validateAuth() {
    return { ok: false, reason: "reference stub — fixture replay only" };
  },
  async discover() {
    throw new Error("reference stub does no I/O; subjects come from normalize output");
  },
  async poll() {
    throw new Error("reference stub does no I/O; replay recorded envelopes");
  },

  normalize(raw: RawPayloadEnvelope): NormalizedBatch {
    if (raw.kind !== "anthropic_console.claude_code") {
      throw new Error(
        `reference connector only replays anthropic_console.claude_code (got '${raw.kind}') — W1-D's connector handles the rest`,
      );
    }
    const payload = claudeCodePayloadSchema.parse(raw.payload);

    // Aggregate by (day, actor): NLV-A8 leaves open whether the API returns
    // one record per (date, actor), so summing duplicates is the safe read.
    const byActorDay = new Map<string, Accumulator>();
    for (const row of payload.data) {
      const day = row.date.slice(0, 10);
      const isPerson = row.actor.type === "user_actor";
      const externalId = isPerson
        ? (row.actor.email_address ?? "")
        : (row.actor.api_key_name ?? "");
      if (!externalId) continue; // malformed actor — nothing honest to attribute
      const key = `${day}|${row.actor.type}|${externalId}`;
      let acc = byActorDay.get(key);
      if (!acc) {
        acc = {
          subject: { kind: isPerson ? "person" : "api_key", externalId },
          // user_actor carries a real identity; an api_key actor is only
          // key-level until W2-K identity mapping — never claim person.
          attribution: isPerson ? "person" : "key_project",
          day,
          sums: new Map(),
        };
        byActorDay.set(key, acc);
      }

      add(acc, "active_day", 1);
      add(acc, "sessions", row.core_metrics.num_sessions);
      add(acc, "lines_added", row.core_metrics.lines_of_code.added);
      add(acc, "lines_removed", row.core_metrics.lines_of_code.removed);
      add(acc, "commits", row.core_metrics.commits_by_claude_code);
      add(acc, "pull_requests", row.core_metrics.pull_requests_by_claude_code);
      for (const action of Object.values(row.tool_actions)) {
        add(acc, "edit_actions_accepted", action.accepted);
        add(acc, "edit_actions_rejected", action.rejected);
      }
      for (const mb of row.model_breakdown) {
        add(acc, "tokens_input", mb.tokens.input);
        add(acc, "tokens_output", mb.tokens.output);
        add(acc, "tokens_cache_read", mb.tokens.cache_read);
        add(acc, "tokens_cache_write", mb.tokens.cache_creation);
        add(
          acc,
          "model_tokens",
          mb.tokens.input + mb.tokens.output + mb.tokens.cache_read + mb.tokens.cache_creation,
          mb.model,
        );
        // estimated, never authoritative — spend_cents comes from cost_report
        add(acc, "spend_cents_estimated", mb.estimated_cost?.amount ?? 0);
      }
      if (row.terminal_type) add(acc, "feature_used", 1, row.terminal_type);
    }

    const records: MetricRecordInput[] = [];
    for (const acc of byActorDay.values()) {
      for (const [k, value] of acc.sums) {
        const [metricKey, dim] = k.split("|") as [MetricRecordInput["metricKey"], string];
        // feature_used is a flag: multiple rows for the same terminal collapse to 1
        const v = metricKey === "active_day" || metricKey === "feature_used" ? 1 : value;
        records.push({
          subject: acc.subject,
          metricKey,
          day: acc.day,
          dim,
          value: v,
          attribution: acc.attribution,
        });
      }
    }

    return {
      records,
      signals: [], // claude_code analytics is daily-grain; sub-daily comes from the messages usage report (W1-D)
      gaps: [
        {
          kind: "oauth_actors_missing",
          detail:
            "Console Claude Code Analytics returns only customer_type:'api' actors in practice (bug #27780) — OAuth/subscription users may be missing; surface, never fabricate.",
        },
      ],
    };
  },
};
