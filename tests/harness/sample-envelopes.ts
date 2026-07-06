import type { RawPayloadEnvelope } from "../../src/contracts/connector";
import { ENVELOPE_KINDS, type AnthropicRaw } from "../../src/connectors/anthropic/types";

// Deterministic E2E INPUT envelope — deliberately NOT under
// fixtures/vendor-payloads/ and NOT claiming to be a recording (rule 2
// reserves that directory for scrubbed real API responses). Shaped exactly
// per src/connectors/anthropic/types.ts's ClaudeCodeRecord (the production
// W1-D connector's raw type, not a harness stand-in) so the E2E exercises
// normalizeAnthropic() itself.
//
// Shape notes it intentionally exercises:
//  - user_actor (email identity) AND api_actor (key identity) → mixed
//    person/key_project attribution, so lowestAttribution propagation is
//    observable in the score result;
//  - two UTC days → active_days aggregation > 1;
//  - a duplicated (date, actor) row pair → the NLV-A8 dedup path.

const day1 = "2026-06-01";
const day2 = "2026-06-02";

const model = (
  name: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
  cents: number,
) => ({
  model: name,
  tokens: {
    input,
    output,
    cache_read: cacheRead,
    cache_creation: cacheCreation,
  },
  estimated_cost: { amount: cents, currency: "USD" },
});

export const sampleClaudeCodeEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ENVELOPE_KINDS.claudeCode,
  window: { start: day1, end: day2 },
  payload: {
    surface: "claude_code",
    page: {
      data: [
        {
          date: day1,
          actor: { type: "user_actor", email_address: "user-1@scrubbed.example" },
          organization_id: "org_scrub_1",
          customer_type: "api",
          subscription_type: null,
          terminal_type: "vscode",
          core_metrics: {
            num_sessions: 4,
            lines_of_code: { added: 320, removed: 45 },
            commits_by_claude_code: 3,
            pull_requests_by_claude_code: 1,
          },
          tool_actions: {
            edit_tool: { accepted: 21, rejected: 4 },
            multi_edit_tool: { accepted: 6, rejected: 1 },
            write_tool: { accepted: 5, rejected: 0 },
            notebook_edit_tool: { accepted: 0, rejected: 0 },
          },
          model_breakdown: [
            model("claude-sonnet-4-5", 180_000, 42_000, 350_000, 60_000, 910),
            model("claude-haiku-4-5", 25_000, 6_000, 0, 0, 45),
          ],
        },
        {
          date: day2,
          actor: { type: "user_actor", email_address: "user-1@scrubbed.example" },
          organization_id: "org_scrub_1",
          customer_type: "api",
          subscription_type: null,
          terminal_type: "iTerm.app",
          core_metrics: {
            num_sessions: 2,
            lines_of_code: { added: 110, removed: 12 },
            commits_by_claude_code: 1,
            pull_requests_by_claude_code: 0,
          },
          tool_actions: {
            edit_tool: { accepted: 9, rejected: 2 },
            multi_edit_tool: { accepted: 0, rejected: 0 },
            write_tool: { accepted: 2, rejected: 1 },
            notebook_edit_tool: { accepted: 0, rejected: 0 },
          },
          model_breakdown: [
            model("claude-sonnet-4-5", 60_000, 15_000, 120_000, 20_000, 310),
          ],
        },
        // api_actor: a CI key using Claude Code — key-level attribution only.
        {
          date: day1,
          actor: { type: "api_actor", api_key_name: "api-key-1" },
          organization_id: "org_scrub_1",
          customer_type: "api",
          subscription_type: null,
          terminal_type: "github_actions",
          core_metrics: {
            num_sessions: 12,
            lines_of_code: { added: 80, removed: 8 },
            commits_by_claude_code: 0,
            pull_requests_by_claude_code: 0,
          },
          tool_actions: {
            edit_tool: { accepted: 40, rejected: 15 },
            multi_edit_tool: { accepted: 0, rejected: 0 },
            write_tool: { accepted: 12, rejected: 3 },
            notebook_edit_tool: { accepted: 0, rejected: 0 },
          },
          model_breakdown: [
            model("claude-haiku-4-5", 90_000, 30_000, 10_000, 0, 130),
          ],
        },
        // Duplicate (date, actor) row for api-key-1 (NLV-A8: dedup key not
        // yet verified live) — normalize must SUM these, not drop or
        // double-count.
        {
          date: day1,
          actor: { type: "api_actor", api_key_name: "api-key-1" },
          organization_id: "org_scrub_1",
          customer_type: "api",
          subscription_type: null,
          terminal_type: "github_actions",
          core_metrics: {
            num_sessions: 3,
            lines_of_code: { added: 20, removed: 2 },
            commits_by_claude_code: 0,
            pull_requests_by_claude_code: 0,
          },
          tool_actions: {
            edit_tool: { accepted: 8, rejected: 2 },
            multi_edit_tool: { accepted: 0, rejected: 0 },
            write_tool: { accepted: 1, rejected: 0 },
            notebook_edit_tool: { accepted: 0, rejected: 0 },
          },
          model_breakdown: [
            model("claude-haiku-4-5", 15_000, 5_000, 0, 0, 25),
          ],
        },
      ],
      has_more: false,
      next_page: null,
    },
  },
};

export const SAMPLE_PERIOD = { start: day1, end: day2 };
