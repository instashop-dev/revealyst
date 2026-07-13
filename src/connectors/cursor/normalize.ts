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
  CursorDailyUsageRow,
  CursorRaw,
  CursorUsageEvent,
} from "./types";

// PURE normalize for the Cursor Admin API — recorded payload in,
// deterministic records/signals/gaps out (rule 2). Attribution honesty
// (invariant b), per connector-facts §2:
//   - a member with an email → person (the only billable subject here)
//   - an event with only a serviceAccountId → service_account, key_project
//     attribution, and the service_accounts_unresolved gap is surfaced —
//     never folded into a person, never billed
//   - Cursor has NO session concept → a sessions metric is never emitted
//     (synthesising one would be fabrication; W2-K reads the signals instead)
//   - tokens/spend/model-mix come ONLY from events (daily-usage carries
//     none); prompts/acceptance/lines come from daily-usage — the two
//     surfaces never emit the same metric, so no double count.

const SERVICE_ACCOUNT_GAP: HonestyGap = {
  kind: "service_accounts_unresolved",
  detail:
    "Cursor usage from a service account carries no user email; those rows stay at key level as an unresolved subject — never attributed to a person.",
};

type Subject = MetricRecordInput["subject"];

/** People are keyed by lowercased email — the one identifier present on
 * BOTH surfaces (daily-usage `email`, events `userEmail`) and the W2-K
 * reconciliation key. The email rides on the descriptor so a backfill run
 * (no discover) still captures identity (run.ts `remember`). */
function personSubject(email: string): Subject & { email: string } {
  const lower = email.toLowerCase();
  return { kind: "person", externalId: `email:${lower}`, email: lower };
}

export function normalizeCursor(
  raw: RawPayloadEnvelope<CursorRaw>,
): NormalizedBatch {
  switch (raw.payload.surface) {
    case "daily_usage":
      return normalizeDailyUsage(raw.payload.rows);
    case "usage_events":
      return normalizeUsageEvents(raw.payload.events);
  }
}

function normalizeDailyUsage(rows: CursorDailyUsageRow[]): NormalizedBatch {
  const acc = new Accumulator();
  for (const row of rows) {
    if (!row.email) continue; // no identity → nothing honest to attribute
    const subject = personSubject(row.email);
    const day = row.day;
    const attribution = "person" as const;

    // Presence in a paginated response is not activity — the `isActive`
    // flag is. An inactive/zero row contributes nothing (and the
    // Accumulator drops the zeros), so we never fabricate an active_day.
    if (row.isActive) {
      acc.add(subject, attribution, "active_day", day, "", 1, "max");
    }

    const prompts =
      row.composerRequests +
      row.chatRequests +
      row.agentRequests +
      row.cmdkUsages;
    acc.add(subject, attribution, "prompts", day, "", prompts);

    // Agentic metrics (§8.3): agentRequests is a genuine agent-mode request
    // count. It also rides in `prompts` (an agent request IS a prompt) — no
    // within-family double count, as agent_requests lives in the `agentic`
    // family. agent_active is the cross-vendor agentic-adoption flag; it fires
    // only on real agent activity (never fabricated). Cursor has no
    // agent-session concept → no agent_sessions row (honest gap).
    acc.add(subject, attribution, "agent_requests", day, "", row.agentRequests);
    if (row.agentRequests > 0) {
      acc.add(subject, attribution, "agent_active", day, "", 1, "max");
    }

    // Apply accept/reject (edit actions) and Tab suggestions are distinct
    // acceptance signals — keep them separate, don't conflate.
    acc.add(subject, attribution, "edit_actions_accepted", day, "", row.totalAccepts);
    acc.add(subject, attribution, "edit_actions_rejected", day, "", row.totalRejects);
    acc.add(subject, attribution, "suggestions_offered", day, "", row.totalTabsShown);
    acc.add(subject, attribution, "suggestions_accepted", day, "", row.totalTabsAccepted);

    acc.add(subject, attribution, "lines_added", day, "", row.totalLinesAdded);
    acc.add(subject, attribution, "lines_removed", day, "", row.totalLinesDeleted);

    // F1.5 harvest — fields fetched but deliberately NOT given a metric key
    // or dim, because no existing representation is an honest home
    // (invariant b; a new key is a catalog ADR, out of scope):
    //   • acceptedLinesAdded / acceptedLinesDeleted (AI-accepted LoC):
    //     lines_added/removed already carry totalLinesAdded/Deleted, so a
    //     second mapping there would double-count; and lines_suggested is the
    //     completion-funnel *offered* denominator (per the glossary), so
    //     folding ACCEPTED lines into it would corrupt the LoC-acceptance
    //     ratio. There is no lines_accepted key — these are skipped, not
    //     mismapped.
    //   • totalApplies: apply-actions of AI output. NOT an edit_actions_*
    //     count — the apply→accept/reject funnel already lands in
    //     edit_actions_accepted/rejected (totalAccepts/totalRejects), so
    //     counting applies there would double-count the acceptance family.
    //     And NOT a `feature=apply` breadth dim either: the live presets
    //     (drizzle/0009_seed-score-presets.sql; ADOPTION_TOOL_COVERAGE +
    //     FLUENCY_BREADTH in src/lib/metrics-glossary.ts) aggregate
    //     feature_used with `distinct_dims`, and src/scoring/evaluate.ts
    //     counts EVERY non-empty dim with no filter — since
    //     totalAccepts > 0 implies totalApplies > 0, every engaged Cursor
    //     user would get +1 distinct dim for free, inflating Adoption/
    //     Fluency and skewing Cursor vs other vendors. Same class of
    //     double-count as the granular chat_inline overlap this file
    //     already bans. Skipped until an ADR adds a score-inert home.
    //   • subscriptionIncludedReqs / apiKeyReqs / usageBasedReqs: a billing
    //     PARTITION of the very requests already summed into `prompts`.
    //     Readers sum every dim row of a key, so emitting these as `prompts`
    //     dims (or any existing count) would double-count the request volume.
    //     No billing-bucket key exists — skipped until an ADR adds one.
    //   (`mostUsedModel` stays excluded too — see the model-mix note below.)
    // tests/connector-cursor.test.ts pins these skips (exact row-set
    // assertions + no feature=apply dim).

    // Feature adoption flags — set only for surfaces the person actually
    // touched (dim carries which surface).
    for (const [feature, count] of [
      ["composer", row.composerRequests],
      ["chat", row.chatRequests],
      ["agent", row.agentRequests],
      ["cmdk", row.cmdkUsages],
      ["bugbot", row.bugbotUsages],
    ] as const) {
      if (count > 0) {
        acc.add(subject, attribution, "feature_used", day, `feature=${feature}`, 1, "max");
      }
    }
    // Model mix is NOT taken from daily-usage: `mostUsedModel` is coarse
    // (one label for the whole day) and attributing all requests to it
    // would misstate the mix — events carry the exact per-request model.
  }
  return { records: acc.records(), signals: [], gaps: [] };
}

function normalizeUsageEvents(events: CursorUsageEvent[]): NormalizedBatch {
  const acc = new Accumulator();
  // (subjectKey, day) → per-hour event counts + per-minute counts (the
  // concurrency proxy). Cursor is the one vendor with true event timestamps.
  const perDay = new Map<
    string,
    {
      subject: Subject;
      day: string;
      hours: number[];
      minuteCounts: Map<number, number>;
    }
  >();
  let sawServiceAccount = false;

  for (const event of events) {
    const ms = Number(event.timestamp);
    if (!Number.isFinite(ms)) continue; // undated event — cannot place it
    const when = new Date(ms);
    const day = when.toISOString().slice(0, 10);
    const hour = when.getUTCHours();

    let subject: Subject;
    let attribution: MetricRecordInput["attribution"];
    if (event.userEmail) {
      subject = personSubject(event.userEmail);
      attribution = "person";
    } else if (event.serviceAccountId) {
      subject = { kind: "service_account", externalId: `svc:${event.serviceAccountId}` };
      attribution = "key_project";
      sawServiceAccount = true;
    } else {
      continue; // neither a person nor a service account — nothing to attribute
    }

    acc.add(subject, attribution, "active_day", day, "", 1, "max");

    const tu = event.tokenUsage;
    if (tu) {
      acc.add(subject, attribution, "tokens_input", day, "", tu.inputTokens);
      acc.add(subject, attribution, "tokens_output", day, "", tu.outputTokens);
      acc.add(subject, attribution, "tokens_cache_read", day, "", tu.cacheReadTokens);
      acc.add(subject, attribution, "tokens_cache_write", day, "", tu.cacheWriteTokens);
    }
    // chargedCents is what Cursor actually billed for the request — the
    // authoritative per-event spend, summed to a day (facts §2).
    acc.add(subject, attribution, "spend_cents", day, "", event.chargedCents);

    if (event.model) {
      const dim = `model=${event.model}`;
      acc.add(subject, attribution, "model_requests", day, dim, 1);
      if (tu) {
        acc.add(
          subject,
          attribution,
          "model_tokens",
          day,
          dim,
          tu.inputTokens + tu.outputTokens,
        );
      }
    }
    if (event.kind) {
      acc.add(subject, attribution, "feature_used", day, `feature=${event.kind}`, 1, "max");
    }
    // W5-E: `isHeadless` → feature=headless. A headless event is an
    // automated/background (agent/CI) invocation — a genuinely DISTINCT
    // workflow, orthogonal to `kind` (composer/chat/agent describe WHAT was
    // asked; headless describes HOW it ran). Double-count justification
    // (connector-facts §2 `isHeadless`): it overlaps no other emitted metric
    // (unlike the banned feature=apply, which `totalAccepts>0` implies), and
    // distinct_dims dedupes it — a headless-heavy subject gets exactly +1
    // breadth for the headless workflow, once. This is the surfaced
    // "workflow diversity" signal W5-E promotes.
    if (event.isHeadless) {
      acc.add(subject, attribution, "feature_used", day, "feature=headless", 1, "max");
    }
    // `isChargeable` is EVALUATED and SKIPPED (W5-E): it is a BILLING attribute,
    // not a capability. Spend is already authoritative via `chargedCents`
    // (summed above), so a chargeable count adds no honest spend signal; and as
    // a feature dim `feature=chargeable` would inflate distinct_dims breadth
    // with a billing status — the same class as the banned
    // subscriptionIncludedReqs/usageBasedReqs billing-partition skips above.
    // tests pin that no feature=chargeable dim is ever emitted.

    const dayKey = `${subject.kind}:${subject.externalId}:${day}`;
    let entry = perDay.get(dayKey);
    if (!entry) {
      entry = {
        subject,
        day,
        hours: new Array<number>(24).fill(0),
        minuteCounts: new Map<number, number>(),
      };
      perDay.set(dayKey, entry);
    }
    entry.hours[hour] += 1;
    const minute = Math.floor(ms / 60_000);
    entry.minuteCounts.set(minute, (entry.minuteCounts.get(minute) ?? 0) + 1);
  }

  const signals: SubjectDaySignalInput[] = [...perDay.values()].map((e) => ({
    subject: e.subject,
    day: e.day,
    hours: e.hours,
    // Concurrency proxy: the most requests seen in any single 1-minute
    // window. Point events carry no duration, so true in-flight overlap
    // isn't derivable — this is the honest upper-signal W2-K's
    // shared-account heuristics consume, labelled by sourceGranularity.
    peakConcurrency: Math.max(0, ...e.minuteCounts.values()),
    sourceGranularity: "event",
  }));

  return {
    records: acc.records(),
    signals,
    gaps: sawServiceAccount ? [SERVICE_ACCOUNT_GAP] : [],
  };
}

/** Sums duplicate (subject, metric, day, dim) tuples across the page-
 * concatenated payload — the same person+day appears in many event rows. */
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
