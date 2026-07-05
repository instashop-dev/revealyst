import type {
  HonestyGap,
  NormalizedBatch,
  RawPayloadEnvelope,
} from "../../contracts/connector";
import type {
  MetricRecordInput,
  SubjectDaySignalInput,
} from "../../contracts/metrics";
import type {
  AnthropicRaw,
  ClaudeCodeRecord,
  CostBucket,
  UsageBucket,
} from "./types";

// PURE normalize for the Anthropic Console surface — recorded payload in,
// deterministic records/signals/gaps out (rule 2). Attribution honesty
// (invariant b):
//   - claude_code user_actor (email) → person
//   - usage account_id (one human's OAuth account) → person
//   - api_key / service_account usage → key_project (owner mapping is a
//     W2-K identity-resolution concern, never assumed here)
//   - org-wide cost report → account (it has no person dimension)
// and the confirmed #27780 hole is surfaced as a gap on every claude_code
// batch — OAuth actors may be MISSING; nothing is fabricated to fill them.

const OAUTH_GAP: HonestyGap = {
  kind: "oauth_actors_missing",
  detail:
    "Anthropic Console claude_code analytics returns only customer_type=api actors in practice (anthropics/claude-code#27780); OAuth/subscription users may be missing from these numbers.",
};

/** The whole-org subject the org-level cost report lands on. */
export const ORG_SUBJECT = { kind: "account", externalId: "org" } as const;

type Subject = MetricRecordInput["subject"];

export function normalizeAnthropic(
  raw: RawPayloadEnvelope<AnthropicRaw>,
): NormalizedBatch {
  switch (raw.payload.surface) {
    case "usage_messages":
      return normalizeUsage(raw.payload.page.data);
    case "cost_report":
      return normalizeCost(raw.payload.page.data);
    case "claude_code":
      return normalizeClaudeCode(raw.payload.page.data);
  }
}

function subjectForUsage(result: {
  account_id: string | null;
  api_key_id: string | null;
  service_account_id?: string | null;
}): { subject: Subject; attribution: MetricRecordInput["attribution"] } {
  if (result.account_id) {
    // One human's OAuth console account — person-level by construction.
    return {
      subject: { kind: "person", externalId: `acct:${result.account_id}` },
      attribution: "person",
    };
  }
  if (result.api_key_id) {
    return {
      subject: { kind: "api_key", externalId: result.api_key_id },
      attribution: "key_project",
    };
  }
  if (result.service_account_id) {
    return {
      subject: {
        kind: "service_account",
        externalId: result.service_account_id,
      },
      attribution: "key_project",
    };
  }
  // Ungrouped/Workbench remainder — honestly org-level.
  return { subject: ORG_SUBJECT, attribution: "account" };
}

function normalizeUsage(buckets: UsageBucket[]): NormalizedBatch {
  const acc = new Accumulator();
  // (subjectKey, day) → 24 hour flags, for the W2-K histogram.
  const hourFlags = new Map<string, { subject: Subject; day: string; hours: number[] }>();

  for (const bucket of buckets) {
    const day = bucket.starting_at.slice(0, 10);
    const hour = new Date(bucket.starting_at).getUTCHours();
    for (const result of bucket.results) {
      const { subject, attribution } = subjectForUsage(result);
      const cacheWrite =
        result.cache_creation.ephemeral_5m_input_tokens +
        result.cache_creation.ephemeral_1h_input_tokens;
      const totalTokens =
        result.uncached_input_tokens +
        result.output_tokens +
        result.cache_read_input_tokens +
        cacheWrite;
      acc.add(subject, attribution, "tokens_input", day, "", result.uncached_input_tokens);
      acc.add(subject, attribution, "tokens_output", day, "", result.output_tokens);
      acc.add(subject, attribution, "tokens_cache_read", day, "", result.cache_read_input_tokens);
      acc.add(subject, attribution, "tokens_cache_write", day, "", cacheWrite);
      if (result.model) {
        acc.add(subject, attribution, "model_tokens", day, `model=${result.model}`, totalTokens);
      }
      if (totalTokens > 0) {
        acc.add(subject, attribution, "active_day", day, "", 1, "max");
        const key = `${subject.kind}:${subject.externalId}:${day}`;
        let entry = hourFlags.get(key);
        if (!entry) {
          entry = { subject, day, hours: new Array<number>(24).fill(0) };
          hourFlags.set(key, entry);
        }
        entry.hours[hour] = 1;
      }
    }
  }

  const signals: SubjectDaySignalInput[] = [...hourFlags.values()].map(
    (e) => ({
      subject: e.subject,
      day: e.day,
      hours: e.hours,
      peakConcurrency: null, // not derivable from token buckets — never faked
      sourceGranularity: "1h",
    }),
  );
  return { records: acc.records(), signals, gaps: [] };
}

function normalizeCost(buckets: CostBucket[]): NormalizedBatch {
  const acc = new Accumulator();
  for (const bucket of buckets) {
    const day = bucket.starting_at.slice(0, 10);
    for (const result of bucket.results) {
      // Decimal-string cents (connector-facts quirk). numeric(24,6) keeps
      // the decimal; Number() is exact within that range.
      const cents = Number(result.amount);
      if (!Number.isFinite(cents)) {
        throw new Error(`anthropic cost amount not numeric: ${result.amount}`);
      }
      // The cost report has NO person dimension — org-level, account
      // attribution, and that is the honest ceiling for authoritative spend.
      acc.add(ORG_SUBJECT, "account", "spend_cents", day, "", cents);
    }
  }
  return { records: acc.records(), signals: [], gaps: [] };
}

function normalizeClaudeCode(records: ClaudeCodeRecord[]): NormalizedBatch {
  const acc = new Accumulator();
  for (const record of records) {
    const day = record.date;
    const { subject, attribution } =
      record.actor.type === "user_actor"
        ? {
            subject: {
              kind: "person",
              externalId: record.actor.email_address.toLowerCase(),
              email: record.actor.email_address.toLowerCase(),
            } as Subject & { email: string },
            attribution: "person" as const,
          }
        : {
            // Keyed by NAME (that is all this surface exposes); W2-K links
            // it to the api_key_id-keyed usage subject via reconciliation.
            subject: {
              kind: "api_key",
              externalId: `name:${record.actor.api_key_name}`,
            } as Subject,
            attribution: "key_project" as const,
          };

    const core = record.core_metrics;
    acc.add(subject, attribution, "active_day", day, "", 1, "max");
    acc.add(subject, attribution, "sessions", day, "", core.num_sessions);
    acc.add(subject, attribution, "commits", day, "", core.commits_by_claude_code);
    acc.add(subject, attribution, "pull_requests", day, "", core.pull_requests_by_claude_code);
    acc.add(subject, attribution, "lines_added", day, "", core.lines_of_code.added);
    acc.add(subject, attribution, "lines_removed", day, "", core.lines_of_code.removed);
    acc.add(subject, attribution, "feature_used", day, "feature=claude_code", 1, "max");

    let accepted = 0;
    let rejected = 0;
    for (const action of Object.values(record.tool_actions)) {
      accepted += action.accepted;
      rejected += action.rejected;
    }
    acc.add(subject, attribution, "edit_actions_accepted", day, "", accepted);
    acc.add(subject, attribution, "edit_actions_rejected", day, "", rejected);

    let estimatedCents = 0;
    for (const mb of record.model_breakdown) {
      acc.add(subject, attribution, "tokens_input", day, "", mb.tokens.input);
      acc.add(subject, attribution, "tokens_output", day, "", mb.tokens.output);
      acc.add(subject, attribution, "tokens_cache_read", day, "", mb.tokens.cache_read);
      acc.add(subject, attribution, "tokens_cache_write", day, "", mb.tokens.cache_creation);
      acc.add(
        subject,
        attribution,
        "model_tokens",
        day,
        `model=${mb.model}`,
        mb.tokens.input +
          mb.tokens.output +
          mb.tokens.cache_read +
          mb.tokens.cache_creation,
      );
      estimatedCents += mb.estimated_cost.amount; // number cents (estimate)
    }
    // Estimated per-actor spend goes to the ESTIMATED metric — the
    // authoritative org number stays the cost report's spend_cents.
    acc.add(subject, attribution, "spend_cents_estimated", day, "", estimatedCents);
  }
  return { records: acc.records(), signals: [], gaps: [OAUTH_GAP] };
}

/** Sums duplicate (subject, metric, day, dim) tuples across page entries —
 * hourly buckets and multi-model breakdowns restate the same tuple. */
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
    // Zero-valued sums (idle hours summed to 0) are dropped except flags,
    // which only exist when set — keeps the fact table lean and honest.
    return [...this.map.values()].filter((r) => r.value !== 0);
  }
}
