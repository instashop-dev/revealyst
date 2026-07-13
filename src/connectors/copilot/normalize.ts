import type {
  HonestyGap,
  NormalizedBatch,
  RawPayloadEnvelope,
} from "../../contracts/connector";
import type { MetricRecordInput } from "../../contracts/metrics";
import {
  AGENT_FEATURES,
  type CopilotAiCreditUsage,
  type CopilotRaw,
  type CopilotUserDayRecord,
} from "./types";

// PURE normalize for the GitHub Copilot reports API — recorded NDJSON in,
// deterministic records/signals/gaps out (rule 2). No I/O, no clock.
//
// Attribution honesty (invariant b), per connector-facts §1:
//   - every per-user row is PERSON-level (user_id + user_login).
//   - Copilot exposes NO sub-daily grain (event API sunset) → signals is
//     always empty and a `sub_daily_unavailable` gap is surfaced; W2-K's
//     shared-account heuristics degrade to daily for Copilot subjects.
//   - server-side-telemetry-only users appear in active-user TOTALS but may
//     be missing from breakdown arrays → a standing
//     `telemetry_only_users_in_totals` gap; breakdowns are used only for
//     adoption flags / agent-request counts, never to recompute actives.
//   - tokens + sessions are CLI-only (IDE tokens/sessions are a documented
//     gap) — never fabricated for IDE users.
//   - ai_credits is vendor-reported CREDITS, not cents; a cents conversion
//     would be estimated and is deliberately NOT emitted here.

const NO_SUBDAILY_GAP: HonestyGap = {
  kind: "sub_daily_unavailable",
  detail:
    "GitHub Copilot reports UTC daily totals only (the event-level API was sunset); Revealyst has no hour-by-hour signal for Copilot subjects.",
};

const TELEMETRY_GAP: HonestyGap = {
  kind: "telemetry_only_users_in_totals",
  detail:
    "Some Copilot users appear in active-user totals via server-side telemetry but may be missing from the per-feature/per-model breakdowns; breakdown-derived figures can under-count them.",
};

type Subject = MetricRecordInput["subject"];

/** People are keyed by the vendor's stable numeric user_id (the identifier on
 * every per-user row). The GitHub login rides along as displayName/meta via
 * discover(); the metrics API exposes no email, so identity resolution keys
 * on user_id/login (never fabricated). */
function personSubject(userId: string | number): Subject {
  return { kind: "person", externalId: `user:${userId}` };
}

export function normalizeCopilot(
  raw: RawPayloadEnvelope<CopilotRaw>,
): NormalizedBatch {
  switch (raw.payload.surface) {
    case "users_daily":
      return normalizeUsersDaily(raw.payload.records);
    case "personal_spend":
      return normalizePersonalSpend(raw.payload.username, raw.payload.usage);
  }
}

function normalizeUsersDaily(records: CopilotUserDayRecord[]): NormalizedBatch {
  const acc = new Accumulator();
  const attribution = "person" as const;

  for (const record of records) {
    if (record.user_id === undefined || record.user_id === null) continue;
    const subject = personSubject(record.user_id);
    const day = record.day;
    if (!day) continue;

    // Presence of a per-user row IS activity for this vendor (the row only
    // exists when the user had Copilot activity that day).
    acc.add(subject, attribution, "active_day", day, "", 1, "max");

    // Prompts / interactions.
    add(acc, subject, "prompts", day, record.user_initiated_interaction_count);

    // Acceptance funnel (facts §1 field mapping).
    add(acc, subject, "suggestions_offered", day, record.code_generation_activity_count);
    add(acc, subject, "suggestions_accepted", day, record.code_acceptance_activity_count);
    add(acc, subject, "lines_suggested", day, record.loc_suggested_to_add_sum);
    add(acc, subject, "lines_added", day, record.loc_added_sum);
    add(acc, subject, "lines_removed", day, record.loc_deleted_sum);

    // W5-E harvest, EVALUATED and SKIPPED (each justified against double-count):
    //  • loc_suggested_to_delete_sum: suggested DELETIONS. lines_suggested is
    //    the completion-funnel *offered* denominator for the LoC-acceptance
    //    ratio loc_added/lines_suggested (metrics-glossary.ts), which is the
    //    ADD side only — folding suggested-deletes into it would corrupt that
    //    ratio (mixing add-offered with delete-offered). There is no
    //    lines_suggested_removed key; a parallel delete funnel
    //    (loc_deleted_sum / suggested-to-delete) needs a new catalog key = ADR.
    //    Skipped, not mismapped (invariant b).
    //  • totals_by_language_feature / totals_by_model_feature: cross-tab
    //    breakdowns of the SAME interactions already counted by
    //    totals_by_language_model (→ model_requests) and the used_* capability
    //    flags. Emitting model_requests from totals_by_model_feature would
    //    double-count the model mix; the `language` axis has no catalog dim
    //    home (dimKind is only model|feature), and the `feature` axis overlaps
    //    the coarse capability flags exactly like the banned granular
    //    totals_by_feature strings. No honest home → skipped until an ADR.
    // tests/connector-copilot.test.ts pins these skips on the extra-fields
    // fixture (no delete-suggested lines, no language/model-feature rows).

    // Spend: native AI Credits (NOT dollars). Emit only when the field is
    // present — earlier days are absence, never a measured zero (facts §1).
    if (typeof record.ai_credits_used === "number") {
      acc.add(subject, attribution, "ai_credits", day, "", record.ai_credits_used);
    }

    // CLI is the ONLY per-user token + session source (IDE is a gap).
    const cli = record.totals_by_cli;
    if (cli) {
      add(acc, subject, "sessions", day, cli.session_count);
      add(acc, subject, "agent_sessions", day, cli.session_count);
      add(acc, subject, "tokens_input", day, cli.token_usage?.prompt_tokens_sum);
      add(acc, subject, "tokens_output", day, cli.token_usage?.output_tokens_sum);
    }

    // Agentic adoption (§8.3). agent_active is the cross-vendor flag; the
    // coding-agent alias is honored.
    const usedAgent =
      record.used_agent ||
      record.used_copilot_coding_agent ||
      record.used_copilot_cloud_agent;
    if (usedAgent) {
      acc.add(subject, attribution, "agent_active", day, "", 1, "max");
    }

    // agent_requests: CLI requests + IDE agent-mode feature interactions
    // (copilot_cli excluded from the feature set to avoid double-counting CLI).
    let agentRequests = cli?.request_count ?? 0;
    for (const f of record.totals_by_feature ?? []) {
      if (f.feature && AGENT_FEATURES.has(f.feature)) {
        agentRequests += f.user_initiated_interaction_count ?? 0;
      }
    }
    if (agentRequests > 0) {
      acc.add(subject, attribution, "agent_requests", day, "", agentRequests);
    }

    // Feature adoption flags — exactly ONE canonical dim per capability, taken
    // from the vendor's coarse used_* booleans (+ completion, derived from the
    // generation-activity count since there is no used_completion boolean).
    // The granular totals_by_feature vendor strings (chat_inline,
    // chat_panel_ask_mode, …) are deliberately NOT emitted as feature_used:
    // they overlap the coarse capabilities and never string-collide, so a
    // chat-only user would otherwise get feature=chat AND feature=chat_inline —
    // double-counting the same capability and inflating any distinct-feature
    // breadth score (invariant b). IDEs are editors, not features — excluded
    // for the same honesty reason. (totals_by_feature agent modes still feed
    // agent_requests above — a count, not a breadth dim.)
    for (const [flag, feature] of [
      [record.code_generation_activity_count ? true : false, "completion"],
      [record.used_chat, "chat"],
      [record.used_cli, "cli"],
      [record.used_agent, "agent"],
      [record.used_copilot_coding_agent || record.used_copilot_cloud_agent, "coding_agent"],
      [
        record.used_copilot_code_review_active || record.used_copilot_code_review_passive,
        "code_review",
      ],
    ] as const) {
      if (flag) {
        acc.add(subject, attribution, "feature_used", day, `feature=${feature}`, 1, "max");
      }
    }

    // ai_adoption_phase (F1.5 harvest, evaluated and SKIPPED): GitHub's
    // per-user maturity cohort (phase_number 0–3 + label) is fetched (see
    // types.ts) but deliberately NOT emitted. The only dim-carrying flag key
    // in the frozen catalog is feature_used, and the live score presets
    // (drizzle/0009_seed-score-presets.sql; ADOPTION_TOOL_COVERAGE +
    // FLUENCY_BREADTH in src/lib/metrics-glossary.ts) aggregate feature_used
    // with `distinct_dims` — src/scoring/evaluate.ts counts EVERY non-empty
    // dim with no namespace filter. A `feature=phase:<label>` dim would
    // therefore inflate Adoption/Fluency breadth merely because GitHub
    // CLASSIFIED a user (even a phase-0 "low adoption" cohort would RAISE
    // the org's Adoption score), and would render as a nonsense chip in the
    // tool-coverage panel's "features in use". There is no score-inert
    // dim-carrying home for a cohort without a catalog ADR (out of scope for
    // F1.5) — skipping beats mismapping (invariant b).
    // tests/connector-copilot.test.ts pins that no phase dim is ever emitted.

    // Model mix — from the per-model breakdown. Requests only: Copilot exposes
    // per-model tokens nowhere per-user (CLI tokens are un-split), so
    // model_tokens is a documented gap and never fabricated. `||` (not `??`)
    // so a model row with 0 interactions still falls back to the generation
    // count instead of being suppressed.
    for (const m of record.totals_by_language_model ?? []) {
      if (!m.model) continue;
      const requests =
        m.user_initiated_interaction_count || m.code_generation_activity_count;
      if (requests) {
        acc.add(subject, attribution, "model_requests", day, `model=${m.model}`, requests);
      }
    }
  }

  return {
    records: acc.records(),
    signals: [], // no sub-daily grain, ever (facts §1)
    gaps: [NO_SUBDAILY_GAP, TELEMETRY_GAP],
  };
}

/**
 * Personal-mode spend context (§6a.2): a personal-plan user's own per-model
 * daily AI-credit usage. Emitted as native `ai_credits` (net credits, summed
 * across models per day) — the unambiguous vendor-reported quantity. The
 * dollar `netAmount` unit is NLV-unverified (facts NLV-C11/C12), so a cents
 * figure is deliberately NOT derived here (invariant b — never a 100×-wrong
 * spend number). This is spend context only; no usage metrics.
 */
function normalizePersonalSpend(
  username: string,
  usage: CopilotAiCreditUsage,
): NormalizedBatch {
  const acc = new Accumulator();
  const subject: Subject = { kind: "person", externalId: `login:${username.toLowerCase()}` };
  for (const item of usage.usageItems ?? []) {
    const day = item.date ?? item.day;
    if (!day) continue;
    const credits = item.netQuantity ?? item.grossQuantity;
    if (typeof credits === "number") {
      acc.add(subject, "person", "ai_credits", day, "", credits);
    }
  }
  return { records: acc.records(), signals: [], gaps: [] };
}

/** Adds a metric only when the vendor field is a real number (absence stays
 * absence — never coerced to 0). */
function add(
  acc: Accumulator,
  subject: Subject,
  metricKey: MetricRecordInput["metricKey"],
  day: string,
  value: number | undefined | null,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    acc.add(subject, "person", metricKey, day, "", value);
  }
}

/** Sums duplicate (subject, metric, day, dim) tuples across the page-
 * concatenated payload. Flags use `max` (a flag is 1, not a count). */
class Accumulator {
  private map = new Map<string, MetricRecordInput>();

  add(
    subject: Subject,
    attribution: MetricRecordInput["attribution"],
    metricKey: MetricRecordInput["metricKey"],
    day: string,
    dim: string,
    value: number,
    mode: "sum" | "max" = "sum",
  ): void {
    const key = `${subject.kind}:${subject.externalId}|${metricKey}|${day}|${dim}`;
    const existing = this.map.get(key);
    if (existing) {
      existing.value =
        mode === "sum" ? existing.value + value : Math.max(existing.value, value);
    } else {
      this.map.set(key, { subject, metricKey, day, dim, value, attribution });
    }
  }

  records(): MetricRecordInput[] {
    // Drop zero-valued sums (idle counters); flags only exist when set.
    return [...this.map.values()].filter((r) => r.value !== 0);
  }
}
