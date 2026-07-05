import type {
  HonestyGap,
  NormalizedBatch,
  RawPayloadEnvelope,
} from "../../contracts/connector";
import type {
  MetricRecordInput,
  SubjectDaySignalInput,
} from "../../contracts/metrics";
import type { CompletionsBucket, CostsBucket, OpenAiRaw } from "./types";

// PURE normalize for the OpenAI org admin surface — shared verbatim by the
// personal-key mode (W1-D) and the org-admin mode (W2-J): the modes differ
// in auth/onboarding, never in what the data honestly supports.
// Attribution honesty (invariant b), per connector-facts §4:
//   - usage `user_id` = the org member who OWNS the key → person (the only
//     true person path, NLV-O1)
//   - key-only / service-account usage → key_project, with the
//     shared_key_not_person_level gap surfaced
//   - costs have NO user dimension → org-level account attribution; per-user
//     spend is never derived here (that would be fabrication)
//   - sessions do not exist on this surface → no sessions metric, ever

const SHARED_KEY_GAP: HonestyGap = {
  kind: "shared_key_not_person_level",
  detail:
    "OpenAI usage from service-account or shared keys carries no user_id; those rows stay at key level — people are never inferred from them.",
};

/** The whole-org subject org-level costs land on. */
export const ORG_SUBJECT = { kind: "account", externalId: "org" } as const;

type Subject = MetricRecordInput["subject"];

export function normalizeOpenAi(
  raw: RawPayloadEnvelope<OpenAiRaw>,
): NormalizedBatch {
  switch (raw.payload.surface) {
    case "usage_completions":
      return normalizeCompletions(raw.payload.page.data);
    case "costs":
      return normalizeCosts(raw.payload.page.data);
  }
}

function subjectForUsage(result: {
  user_id: string | null;
  api_key_id: string | null;
}): {
  subject: Subject;
  attribution: MetricRecordInput["attribution"];
  personLevel: boolean;
} {
  if (result.user_id) {
    // Key-owner attribution — joins discover()'s `user:<id>` subjects.
    return {
      subject: { kind: "person", externalId: `user:${result.user_id}` },
      attribution: "person",
      personLevel: true,
    };
  }
  if (result.api_key_id) {
    return {
      subject: { kind: "api_key", externalId: result.api_key_id },
      attribution: "key_project",
      personLevel: false,
    };
  }
  return { subject: ORG_SUBJECT, attribution: "account", personLevel: false };
}

function normalizeCompletions(buckets: CompletionsBucket[]): NormalizedBatch {
  const acc = new Accumulator();
  const hourFlags = new Map<
    string,
    { subject: Subject; day: string; hours: number[] }
  >();
  let sawKeyLevel = false;

  for (const bucket of buckets) {
    const start = new Date(bucket.start_time * 1000);
    const day = start.toISOString().slice(0, 10);
    const hour = start.getUTCHours();
    for (const result of bucket.results) {
      const { subject, attribution, personLevel } = subjectForUsage(result);
      sawKeyLevel ||= !personLevel && subject !== ORG_SUBJECT;

      acc.add(subject, attribution, "prompts", day, "", result.num_model_requests);
      acc.add(subject, attribution, "tokens_input", day, "", result.input_tokens);
      acc.add(subject, attribution, "tokens_output", day, "", result.output_tokens);
      acc.add(subject, attribution, "tokens_cache_read", day, "", result.input_cached_tokens);
      if (result.model) {
        acc.add(
          subject,
          attribution,
          "model_requests",
          day,
          `model=${result.model}`,
          result.num_model_requests,
        );
        acc.add(
          subject,
          attribution,
          "model_tokens",
          day,
          `model=${result.model}`,
          result.input_tokens + result.output_tokens,
        );
      }
      if (result.batch === false && result.num_model_requests > 0) {
        // Interactive-usage proxy (facts: filter batch=false).
        acc.add(subject, attribution, "feature_used", day, "feature=interactive_api", 1, "max");
      }
      if (result.num_model_requests > 0) {
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

  const signals: SubjectDaySignalInput[] = [...hourFlags.values()].map((e) => ({
    subject: e.subject,
    day: e.day,
    hours: e.hours,
    // No concurrency field exists on this surface (connector-facts) —
    // request-count bucket shapes are all W2-K gets; never faked.
    peakConcurrency: null,
    sourceGranularity: "1h",
  }));
  return {
    records: acc.records(),
    signals,
    gaps: sawKeyLevel ? [SHARED_KEY_GAP] : [],
  };
}

function normalizeCosts(buckets: CostsBucket[]): NormalizedBatch {
  const acc = new Accumulator();
  for (const bucket of buckets) {
    const day = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
    for (const result of bucket.results) {
      // Float USD → cents. numeric(24,6) absorbs the decimals; /costs is
      // the authoritative spend (usage × price ≠ costs — facts quirk).
      acc.add(ORG_SUBJECT, "account", "spend_cents", day, "", result.amount.value * 100);
    }
  }
  return { records: acc.records(), signals: [], gaps: [] };
}

/** Sums duplicate (subject, metric, day, dim) tuples across hourly buckets. */
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
    return [...this.map.values()].filter((r) => r.value !== 0);
  }
}
