// Pure demo-seed generator: (anchorDay) -> SeedPlan. No I/O, no Date.now —
// every date derives from the anchorDay argument, and every random choice
// comes from a seeded Rng (rng.ts), so the same anchorDay always produces a
// byte-identical plan (README.md). See README.md for the data narrative and
// CLAUDE.md's seed-data workstream brief for the per-scenario numeric
// targets this file engineers toward.
import type { FixtureGraph } from "../../src/db/fixtures";
import type { AttributionLevel } from "../../src/contracts/attribution";
import type { MetricKey } from "../../src/contracts/metrics";
import type { HonestyGap } from "../../src/contracts/connector";
import type { ScoreDefinitionInput } from "../../src/contracts/scores";
import type {
  BuildDemoSeedPlan,
  ConnectionStateSpec,
  ConnectorRunSpec,
  SeedOrgPlan,
  SeedPlan,
} from "./plan";
import {
  ACME_EMAIL_DOMAIN,
  ACME_PEOPLE,
  ACME_TEAMS,
  GLOBEX_EMAIL_DOMAIN,
  GLOBEX_PEOPLE,
  JORDAN_EMAIL,
  JORDAN_KEY,
  JORDAN_PSEUDONYM,
  type AcmePersona,
  type AcmeVendorKey,
  type ActivityBand,
} from "./personas";
import {
  DEFAULT_SEED,
  chance,
  createRng,
  jitter,
  jitterInt,
  lerp,
  pick,
  randFloat,
  randInt,
  shuffle,
  type Rng,
} from "./rng";

// ---------------------------------------------------------------------------
// Date / window utilities (UTC calendar days, YYYY-MM-DD, no timezones).
// ---------------------------------------------------------------------------

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayOfWeekMon0(iso: string): number {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
}

function mondayOf(iso: string): string {
  return addDays(iso, -dayOfWeekMon0(iso));
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function prevMonthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const prevFirst = new Date(Date.UTC(y, m - 2, 1));
  const start = prevFirst.toISOString().slice(0, 10);
  const end = new Date(
    Date.UTC(prevFirst.getUTCFullYear(), prevFirst.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

function diffDays(a: string, b: string): number {
  const DAY_MS = 86_400_000;
  return Math.round(
    (new Date(`${b}T00:00:00.000Z`).getTime() -
      new Date(`${a}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

function weekdayCount(start: string, end: string): number {
  let n = 0;
  let d = start;
  while (d <= end) {
    if (dayOfWeekMon0(d) < 5) n++;
    d = addDays(d, 1);
  }
  return n;
}

type WeekWindow = { index: number; monday: string; sunday: string };

export type WindowCtx = {
  anchorDay: string;
  windowStart: string;
  currentWeekMonday: string;
  weeks: WeekWindow[]; // 13 complete ISO weeks, index 1 (oldest) .. 13 (most recent complete)
  trailing28Start: string;
  monthStartCurrent: string;
  prevMonth: { start: string; end: string };
  prevMonthMidDay: string;
};

function buildWindowCtx(anchorDay: string): WindowCtx {
  const currentWeekMonday = mondayOf(anchorDay);
  const weeks: WeekWindow[] = [];
  for (let i = 1; i <= 13; i++) {
    const monday = addDays(currentWeekMonday, -7 * (14 - i));
    weeks.push({ index: i, monday, sunday: addDays(monday, 6) });
  }
  const trailing28Start = addDays(anchorDay, -27);
  const prevMonth = prevMonthRange(anchorDay);
  return {
    anchorDay,
    windowStart: weeks[0].monday,
    currentWeekMonday,
    weeks,
    trailing28Start,
    monthStartCurrent: monthStart(anchorDay),
    prevMonth,
    prevMonthMidDay: addDays(prevMonth.start, 14),
  };
}

function weekIndexForDay(day: string, ctx: WindowCtx): number {
  for (const w of ctx.weeks) {
    if (day >= w.monday && day <= w.sunday) return w.index;
  }
  return 14; // the partial (current) week containing anchorDay
}

type MonthFlag = "prev" | "current" | "other";

function monthFlag(day: string, ctx: WindowCtx): MonthFlag {
  if (day >= ctx.monthStartCurrent) return "current";
  if (day >= ctx.prevMonth.start && day <= ctx.prevMonth.end) return "prev";
  return "other";
}

/** Weekday-biased day picker (12% chance a weekend day is also a candidate),
 * shuffled deterministically and truncated to `count`. */
function pickWeekdayDays(
  rng: Rng,
  start: string,
  end: string,
  count: number,
): string[] {
  if (start > end || count <= 0) return [];
  const candidates: string[] = [];
  let d = start;
  while (d <= end) {
    if (dayOfWeekMon0(d) < 5 || chance(rng, 0.12)) candidates.push(d);
    d = addDays(d, 1);
  }
  if (candidates.length < count) {
    // The requested density exceeds the weekday-biased pool (e.g. a power
    // user's near-daily target against a narrow date range) — fall back to
    // treating every calendar day, weekends included, as a candidate so the
    // count stays achievable regardless of anchorDay's day-of-month.
    const all: string[] = [];
    let dd = start;
    while (dd <= end) {
      all.push(dd);
      dd = addDays(dd, 1);
    }
    return shuffle(rng, all).slice(0, Math.min(count, all.length));
  }
  return shuffle(rng, candidates).slice(0, count);
}

function businessDayCount(ctx: WindowCtx): number {
  return weekdayCount(ctx.windowStart, ctx.anchorDay);
}

// ---------------------------------------------------------------------------
// Trend functions — model mix + agentic adoption ramp over the 13 weeks.
// ---------------------------------------------------------------------------

/** gpt-5 falls ~60%→30%, claude-sonnet-5 rises ~40%→70% over the trailing 8
 * complete weeks (weeks 6..13); flat baseline before that. Also used (via
 * .sonnet) to shift Anthropic's own sonnet/opus split the same direction, so
 * the org-wide model mix reinforces one trend rather than fighting itself. */
function modelMixShare(weekIndex: number): { gpt5: number; sonnet: number } {
  const idx = Math.min(weekIndex, 13);
  if (idx < 6) return { gpt5: 0.6, sonnet: 0.4 };
  const t = (idx - 6) / 7;
  return { gpt5: lerp(0.6, 0.3, t), sonnet: lerp(0.4, 0.7, t) };
}

/** Probability an agent-capable active day is ALSO an agentic day, ramping
 * week over week (agent_active adoption growth, ≥6 complete weeks + the
 * partial anchor week). */
function agenticProbability(weekIndex: number): number {
  const idx = Math.min(weekIndex, 14);
  return lerp(0.15, 0.85, (idx - 1) / 13);
}

/** History-segment density ramp (low early, high late) — the SAME mechanism
 * drives both the agentic-adoption growth and the attribution-mix shift
 * (account/key_project early → person late): person-subject volume grows
 * while the org-account/svc-key baseline stays roughly constant. */
function historyRampFactor(weekIndex: number): number {
  return lerp(0.3, 1.3, (weekIndex - 1) / 12);
}

const BAND_MULTIPLIER: Record<ActivityBand, number> = {
  power: 3.2,
  regular: 1.6,
  moderate: 0.9,
  occasional: 0.45,
  new_joiner: 1.1,
  churned: 1.1,
  unsegmented: 0,
};

/** A steeper, `prompts`-only intensity curve (concentration scenario:
 * top person ~50-100x the median resolved person — CLAUDE.md). Applied only
 * to the `prompts` metric so spend/tokens/etc. stay on the gentler
 * BAND_MULTIPLIER curve. */
const PROMPTS_INTENSITY: Record<ActivityBand, number> = {
  power: 9.5,
  regular: 1.3,
  moderate: 0.5,
  occasional: 0.2,
  new_joiner: 0.9,
  churned: 0.9,
  unsegmented: 0,
};

// ---------------------------------------------------------------------------
// Persona day-list construction (segmented: current month / rest of
// trailing-28 / ramped history).
// ---------------------------------------------------------------------------

export type PersonaDaySpec = {
  currentMonthActiveDays: number;
  trailing28ActiveDays: number;
  historyWeeklyActiveDays: number;
  activeSinceDaysBeforeAnchor: number | null;
  activeUntilDaysBeforeAnchor: number | null;
};

function buildPersonaDays(
  rng: Rng,
  spec: PersonaDaySpec,
  ctx: WindowCtx,
): string[] {
  const eligibleStart =
    spec.activeSinceDaysBeforeAnchor != null
      ? addDays(ctx.anchorDay, -spec.activeSinceDaysBeforeAnchor)
      : ctx.windowStart;
  const eligibleEnd =
    spec.activeUntilDaysBeforeAnchor != null
      ? addDays(ctx.anchorDay, -spec.activeUntilDaysBeforeAnchor)
      : ctx.anchorDay;
  const days = new Set<string>();

  const curStart = maxDay(ctx.monthStartCurrent, eligibleStart);
  const curEnd = minDay(ctx.anchorDay, eligibleEnd);
  if (curStart <= curEnd && spec.currentMonthActiveDays > 0) {
    for (const d of pickWeekdayDays(
      rng,
      curStart,
      curEnd,
      spec.currentMonthActiveDays,
    ))
      days.add(d);
  }

  const restCount = Math.max(
    0,
    spec.trailing28ActiveDays - spec.currentMonthActiveDays,
  );
  const restStart = maxDay(ctx.trailing28Start, eligibleStart);
  const restEnd = minDay(addDays(ctx.monthStartCurrent, -1), eligibleEnd);
  if (restStart <= restEnd && restCount > 0) {
    for (const d of pickWeekdayDays(rng, restStart, restEnd, restCount))
      days.add(d);
  }

  if (spec.historyWeeklyActiveDays > 0) {
    const historyCutoff = addDays(ctx.trailing28Start, -1);
    for (const week of ctx.weeks) {
      // Clip (never skip outright) weeks straddling trailing28Start — a
      // week fully or partially inside the trailing-28 window still has a
      // history-eligible prefix, and skipping it entirely left a coverage
      // gap (an under-attributed week in the attribution-mix trend).
      const wStart = maxDay(week.monday, eligibleStart);
      const wEnd = minDay(minDay(week.sunday, historyCutoff), eligibleEnd);
      if (wStart > wEnd) continue;
      const n = jitterInt(
        rng,
        spec.historyWeeklyActiveDays * historyRampFactor(week.index),
        0.3,
        0,
      );
      if (n > 0) {
        for (const d of pickWeekdayDays(rng, wStart, wEnd, n)) days.add(d);
      }
    }
  }

  return Array.from(days).sort();
}

// ---------------------------------------------------------------------------
// Record/signal building blocks.
// ---------------------------------------------------------------------------

type RecordRow = FixtureGraph["records"][number];
type SignalRow = FixtureGraph["signals"][number];

const SOURCE_CONNECTOR: Record<AcmeVendorKey, string> = {
  anthropic: "anthropic-console@1",
  openai: "openai@1",
  cursor: "cursor@1",
  copilot: "github-copilot@1",
  claude_code_local: "claude-code-local@1",
};

const MODEL = {
  sonnet: "model=claude-sonnet-5",
  opus: "model=claude-opus-4",
  gpt5: "model=gpt-5",
  gpt5mini: "model=gpt-5-mini",
  gpt5copilot: "model=gpt-5-copilot",
} as const;

const FEATURE = {
  composer: "feature=composer",
  chat: "feature=chat",
  agent: "feature=agent",
  cmdk: "feature=cmdk",
  claudeCode: "feature=claude_code",
  completion: "feature=completion",
  cli: "feature=cli",
  interactiveApi: "feature=interactive_api",
} as const;

const DAY_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Token-volume multiplier cap. The shared-account volume heuristic
 * (src/lib/shared-account/heuristics.ts) flags any subject whose cumulative
 * tokens_input is ≥3x the team median — an UNCAPPED power-user band
 * multiplier pushed legit single-person subjects over that line (false
 * flags). Concentration skew lives in `prompts` (PROMPTS_INTENSITY), so
 * tokens can stay damped without touching the 50-100x prompts target.
 */
function tokensMult(multiplier: number): number {
  return Math.min(multiplier, 1.6);
}

class GraphBuilder {
  connections: FixtureGraph["connections"] = [];
  people: FixtureGraph["people"] = [];
  teams: FixtureGraph["teams"] = [];
  subjects: FixtureGraph["subjects"] = [];
  identities: FixtureGraph["identities"] = [];
  records: RecordRow[] = [];
  signals: SignalRow[] = [];

  addRecord(row: RecordRow): void {
    this.records.push(row);
  }
  addSignal(row: SignalRow): void {
    this.signals.push(row);
  }

  toGraph(): FixtureGraph {
    return {
      connections: this.connections,
      people: this.people,
      teams: this.teams,
      subjects: this.subjects,
      identities: this.identities,
      records: this.records,
      signals: this.signals,
    };
  }
}

function rec(
  subject: string,
  metricKey: MetricKey,
  day: string,
  dim: string,
  value: number,
  attribution: AttributionLevel,
  sourceConnector: string,
): RecordRow {
  return { subject, metricKey, day, dim, value, attribution, sourceConnector };
}

function buildHours(
  rng: Rng,
  activeSlots: number,
  totalUnits: number,
  candidateHours: readonly number[] = DAY_HOURS,
): number[] {
  const hours = new Array(24).fill(0);
  const chosen = shuffle(rng, candidateHours).slice(
    0,
    Math.min(activeSlots, candidateHours.length),
  );
  if (chosen.length === 0) return hours;
  let remaining = Math.max(totalUnits, chosen.length);
  chosen.forEach((h, i) => {
    const isLast = i === chosen.length - 1;
    const share = remaining / (chosen.length - i);
    const amt = isLast
      ? remaining
      : Math.max(1, Math.round(share * randFloat(rng, 0.6, 1.4)));
    const capped = Math.min(amt, remaining);
    hours[h] += capped;
    remaining -= capped;
  });
  return hours;
}

// ---------------------------------------------------------------------------
// Per-vendor day emitters. Each emits ONLY the metrics CLAUDE.md's per-
// connector emission rules license for that vendor (invariant b — never
// fabricate a metric a vendor doesn't report).
// ---------------------------------------------------------------------------

function emitAnthropicDay(
  g: GraphBuilder,
  rng: Rng,
  subjectKey: string,
  day: string,
  multiplier: number,
  weekIndex: number,
  // Attribution follows the subject's kind (person → person; an api_key
  // subject like Jordan's personal key → key_project) — never stronger than
  // the vendor can honestly claim for that subject.
  attribution: AttributionLevel = "person",
): void {
  const sc = SOURCE_CONNECTOR.anthropic;
  g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));

  const tMult = tokensMult(multiplier);
  const tokensIn = jitterInt(rng, 5000 * tMult, 0.35, 200);
  const tokensOut = jitterInt(rng, 1100 * tMult, 0.35, 50);
  g.addRecord(rec(subjectKey, "tokens_input", day, "", tokensIn, attribution, sc));
  g.addRecord(rec(subjectKey, "tokens_output", day, "", tokensOut, attribution, sc));

  const share = modelMixShare(weekIndex);
  const sonnetTok = Math.round(tokensIn * share.sonnet);
  const opusTok = Math.max(0, tokensIn - sonnetTok);
  if (sonnetTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.sonnet, sonnetTok, attribution, sc));
  if (opusTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.opus, opusTok, attribution, sc));
  const reqTotal = jitterInt(rng, 14 * multiplier, 0.4, 1);
  const sonnetReq = Math.round(reqTotal * share.sonnet);
  const opusReq = Math.max(0, reqTotal - sonnetReq);
  if (sonnetReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.sonnet, sonnetReq, attribution, sc));
  if (opusReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.opus, opusReq, attribution, sc));

  g.addRecord(
    rec(subjectKey, "sessions", day, "", jitterInt(rng, 2 * multiplier, 0.4, 1), attribution, sc),
  );

  const agentic = chance(rng, agenticProbability(weekIndex));
  if (agentic) {
    g.addRecord(
      rec(subjectKey, "agent_sessions", day, "", jitterInt(rng, 2 * multiplier, 0.4, 1), attribution, sc),
    );
    g.addRecord(rec(subjectKey, "agent_active", day, "", 1, attribution, sc));
    g.addRecord(
      rec(subjectKey, "commits", day, "", jitterInt(rng, 2 * multiplier, 0.5, 0), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "pull_requests", day, "", jitterInt(rng, 1 * multiplier, 0.6, 0), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "lines_added", day, "", jitterInt(rng, 90 * multiplier, 0.4, 0), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "lines_removed", day, "", jitterInt(rng, 30 * multiplier, 0.4, 0), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "edit_actions_accepted", day, "", jitterInt(rng, 18 * multiplier, 0.4, 0), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "edit_actions_rejected", day, "", jitterInt(rng, 3 * multiplier, 0.5, 0), attribution, sc),
    );
  }

  g.addRecord(
    rec(subjectKey, "spend_cents_estimated", day, "", jitterInt(rng, 40 * multiplier, 0.3, 5), attribution, sc),
  );
  g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.claudeCode, 1, attribution, sc));

  // Hourly signal (1h granularity, peakConcurrency null per the connector's
  // sub-daily capability — CLAUDE.md "Signals" rule).
  const activeSlots = randInt(rng, 3, Math.min(9, 3 + Math.round(multiplier * 2)));
  g.addSignal({
    subject: subjectKey,
    day,
    hours: buildHours(rng, activeSlots, Math.round(tokensIn / 400)),
    peakConcurrency: null,
    sourceGranularity: "1h",
  });
}

function emitOpenaiDay(
  g: GraphBuilder,
  rng: Rng,
  subjectKey: string,
  day: string,
  multiplier: number,
  promptsMultiplier: number = multiplier,
): void {
  const sc = SOURCE_CONNECTOR.openai;
  const attribution: AttributionLevel = "person";
  g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));
  g.addRecord(
    rec(subjectKey, "prompts", day, "", jitterInt(rng, 9 * promptsMultiplier, 0.4, 1), attribution, sc),
  );

  const tMult = tokensMult(multiplier);
  const tokensIn = jitterInt(rng, 3200 * tMult, 0.35, 100);
  const tokensOut = jitterInt(rng, 700 * tMult, 0.35, 30);
  const cacheRead = jitterInt(rng, 400 * tMult, 0.5, 0);
  g.addRecord(rec(subjectKey, "tokens_input", day, "", tokensIn, attribution, sc));
  g.addRecord(rec(subjectKey, "tokens_output", day, "", tokensOut, attribution, sc));
  if (cacheRead > 0)
    g.addRecord(rec(subjectKey, "tokens_cache_read", day, "", cacheRead, attribution, sc));

  // OpenAI never reports Anthropic models — its own gpt-5/gpt-5-mini split
  // stays fixed, independent of the cross-vendor gpt-5⇄sonnet trend.
  const gpt5Share = 0.7;
  const reqTotal = jitterInt(rng, 8 * multiplier, 0.4, 1);
  const gpt5Req = Math.round(reqTotal * gpt5Share);
  const miniReq = Math.max(0, reqTotal - gpt5Req);
  if (gpt5Req > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.gpt5, gpt5Req, attribution, sc));
  if (miniReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.gpt5mini, miniReq, attribution, sc));
  const tokTotal = jitterInt(rng, 3600 * tMult, 0.4, 0);
  const gpt5Tok = Math.round(tokTotal * gpt5Share);
  const miniTok = Math.max(0, tokTotal - gpt5Tok);
  if (gpt5Tok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.gpt5, gpt5Tok, attribution, sc));
  if (miniTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.gpt5mini, miniTok, attribution, sc));

  // Exactly one feature dim — OpenAI's single reported surface — Data
  // team's structurally-low tool_coverage rides on this (CLAUDE.md).
  g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.interactiveApi, 1, attribution, sc));

  const activeSlots = randInt(rng, 2, Math.min(7, 2 + Math.round(multiplier * 2)));
  g.addSignal({
    subject: subjectKey,
    day,
    hours: buildHours(rng, activeSlots, Math.round(tokensIn / 300)),
    peakConcurrency: null,
    sourceGranularity: "1h",
  });
}

function emitCursorDay(
  g: GraphBuilder,
  rng: Rng,
  subjectKey: string,
  day: string,
  multiplier: number,
  weekIndex: number,
  month: MonthFlag,
  promptsMultiplier: number = multiplier,
): void {
  const sc = SOURCE_CONNECTOR.cursor;
  const attribution: AttributionLevel = "person";
  g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));
  g.addRecord(
    rec(subjectKey, "prompts", day, "", jitterInt(rng, 14 * promptsMultiplier, 0.4, 1), attribution, sc),
  );

  const agentic = chance(rng, agenticProbability(weekIndex));
  if (agentic) {
    g.addRecord(rec(subjectKey, "agent_active", day, "", 1, attribution, sc));
    g.addRecord(
      rec(subjectKey, "agent_requests", day, "", jitterInt(rng, 7 * multiplier, 0.4, 1), attribution, sc),
    );
  }

  g.addRecord(
    rec(subjectKey, "edit_actions_accepted", day, "", jitterInt(rng, 22 * multiplier, 0.4, 0), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "edit_actions_rejected", day, "", jitterInt(rng, 4 * multiplier, 0.5, 0), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "lines_added", day, "", jitterInt(rng, 85 * multiplier, 0.4, 0), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "lines_removed", day, "", jitterInt(rng, 28 * multiplier, 0.4, 0), attribution, sc),
  );

  for (const f of [FEATURE.composer, FEATURE.chat, FEATURE.cmdk]) {
    if (chance(rng, 0.55)) g.addRecord(rec(subjectKey, "feature_used", day, f, 1, attribution, sc));
  }
  if (agentic) g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.agent, 1, attribution, sc));

  const tMult = tokensMult(multiplier);
  const tokensIn = jitterInt(rng, 4200 * tMult, 0.35, 100);
  const tokensOut = jitterInt(rng, 950 * tMult, 0.35, 30);
  g.addRecord(rec(subjectKey, "tokens_input", day, "", tokensIn, attribution, sc));
  g.addRecord(rec(subjectKey, "tokens_output", day, "", tokensOut, attribution, sc));
  g.addRecord(
    rec(subjectKey, "spend_cents", day, "", jitterInt(rng, 130 * multiplier, 0.3, 10), attribution, sc),
  );

  const share = modelMixShare(weekIndex);
  const reqTotal = jitterInt(rng, 11 * multiplier, 0.4, 1);
  const gpt5Req = Math.round(reqTotal * share.gpt5);
  const sonnetReq = Math.max(0, reqTotal - gpt5Req);
  if (gpt5Req > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.gpt5, gpt5Req, attribution, sc));
  if (sonnetReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.sonnet, sonnetReq, attribution, sc));
  const tokTotal = jitterInt(rng, 6200 * tMult, 0.4, 0);
  const gpt5Tok = Math.round(tokTotal * share.gpt5);
  const sonnetTok = Math.max(0, tokTotal - gpt5Tok);
  if (gpt5Tok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.gpt5, gpt5Tok, attribution, sc));
  if (sonnetTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.sonnet, sonnetTok, attribution, sc));

  // Platform's "newlyUnmeasured" + ratio-omission scenario: current month
  // loses suggestions_offered entirely (accepted keeps flowing) — the fluency
  // effectiveness component is omitted, never fabricated from half the data.
  if (month === "current") {
    g.addRecord(
      rec(subjectKey, "suggestions_accepted", day, "", jitterInt(rng, 11 * multiplier, 0.4, 1), attribution, sc),
    );
  } else {
    const offered = jitterInt(rng, 46 * multiplier, 0.35, 5);
    const accepted = Math.round(offered * jitter(rng, 0.35, 0.25));
    g.addRecord(rec(subjectKey, "suggestions_offered", day, "", offered, attribution, sc));
    g.addRecord(rec(subjectKey, "suggestions_accepted", day, "", accepted, attribution, sc));
  }

  const activeSlots = randInt(rng, 2, Math.min(6, 2 + Math.round(multiplier)));
  g.addSignal({
    subject: subjectKey,
    day,
    hours: buildHours(rng, activeSlots, jitterInt(rng, 8 * multiplier, 0.3, 1)),
    // Always 1 for a single-person subject: peak ≥2 is the shared-account
    // concurrent_usage signal, and a legit user must never trip it.
    peakConcurrency: 1,
    sourceGranularity: "event",
  });
}

function emitCopilotDay(
  g: GraphBuilder,
  rng: Rng,
  subjectKey: string,
  day: string,
  multiplier: number,
  weekIndex: number,
  month: MonthFlag,
  includeSignalStub: boolean,
  promptsMultiplier: number = multiplier,
): void {
  const sc = SOURCE_CONNECTOR.copilot;
  const attribution: AttributionLevel = "person";
  g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));
  g.addRecord(
    rec(subjectKey, "prompts", day, "", jitterInt(rng, 10 * promptsMultiplier, 0.4, 1), attribution, sc),
  );

  // Product Eng's fluency-drop scenario: previous month ~45% acceptance at
  // high volume, current month ~8% acceptance — both sides stay present so
  // the drop is a real, nameable effectiveness-component collapse, not an
  // omission (CLAUDE.md).
  let offered: number;
  let accepted: number;
  if (month === "prev") {
    offered = jitterInt(rng, 115 * multiplier, 0.25, 20);
    accepted = Math.round(offered * jitter(rng, 0.45, 0.15));
  } else if (month === "current") {
    offered = jitterInt(rng, 95 * multiplier, 0.25, 15);
    accepted = Math.round(offered * jitter(rng, 0.08, 0.35));
  } else {
    offered = jitterInt(rng, 105 * multiplier, 0.3, 15);
    accepted = Math.round(offered * jitter(rng, 0.42, 0.2));
  }
  g.addRecord(rec(subjectKey, "suggestions_offered", day, "", offered, attribution, sc));
  g.addRecord(rec(subjectKey, "suggestions_accepted", day, "", accepted, attribution, sc));

  const linesSuggested = jitterInt(rng, 160 * multiplier, 0.35, 10);
  g.addRecord(rec(subjectKey, "lines_suggested", day, "", linesSuggested, attribution, sc));
  g.addRecord(
    rec(subjectKey, "lines_added", day, "", Math.round(linesSuggested * 0.55), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "lines_removed", day, "", jitterInt(rng, 25 * multiplier, 0.4, 0), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "ai_credits", day, "", jitterInt(rng, 22 * multiplier, 0.3, 1), attribution, sc),
  );

  const tMult = tokensMult(multiplier);
  const tokensIn = jitterInt(rng, 3000 * tMult, 0.35, 80);
  const tokensOut = jitterInt(rng, 650 * tMult, 0.35, 20);
  g.addRecord(rec(subjectKey, "tokens_input", day, "", tokensIn, attribution, sc));
  g.addRecord(rec(subjectKey, "tokens_output", day, "", tokensOut, attribution, sc));
  g.addRecord(
    rec(subjectKey, "model_requests", day, MODEL.gpt5copilot, jitterInt(rng, 9 * multiplier, 0.4, 1), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "model_tokens", day, MODEL.gpt5copilot, jitterInt(rng, 3400 * tMult, 0.4, 0), attribution, sc),
  );

  const agentic = chance(rng, agenticProbability(weekIndex));
  g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.completion, 1, attribution, sc));
  if (chance(rng, 0.5)) g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.chat, 1, attribution, sc));
  if (chance(rng, 0.3)) g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.cli, 1, attribution, sc));
  if (agentic) {
    g.addRecord(rec(subjectKey, "feature_used", day, FEATURE.agent, 1, attribution, sc));
    g.addRecord(rec(subjectKey, "agent_active", day, "", 1, attribution, sc));
    g.addRecord(
      rec(subjectKey, "agent_requests", day, "", jitterInt(rng, 6 * multiplier, 0.4, 1), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "sessions", day, "", jitterInt(rng, 2 * multiplier, 0.4, 1), attribution, sc),
    );
    g.addRecord(
      rec(subjectKey, "agent_sessions", day, "", jitterInt(rng, 1 * multiplier, 0.5, 1), attribution, sc),
    );
  }

  // Copilot has no sub-daily telemetry (sub_daily_unavailable) — never real
  // hours, only the occasional none-granularity stub CLAUDE.md allows.
  if (includeSignalStub) {
    g.addSignal({
      subject: subjectKey,
      day,
      hours: null,
      peakConcurrency: null,
      sourceGranularity: "none",
    });
  }
}

function emitClaudeCodeLocalDay(
  g: GraphBuilder,
  rng: Rng,
  subjectKey: string,
  day: string,
  multiplier: number,
  weekIndex: number,
  promptsMultiplier: number = multiplier,
): void {
  const sc = SOURCE_CONNECTOR.claude_code_local;
  const attribution: AttributionLevel = "person";
  g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));
  g.addRecord(
    rec(subjectKey, "sessions", day, "", jitterInt(rng, 2 * multiplier, 0.4, 1), attribution, sc),
  );
  g.addRecord(
    rec(subjectKey, "prompts", day, "", jitterInt(rng, 9 * promptsMultiplier, 0.4, 1), attribution, sc),
  );
  const tMult = tokensMult(multiplier);
  const tokensIn = jitterInt(rng, 3800 * tMult, 0.35, 100);
  const tokensOut = jitterInt(rng, 850 * tMult, 0.35, 30);
  g.addRecord(rec(subjectKey, "tokens_input", day, "", tokensIn, attribution, sc));
  g.addRecord(rec(subjectKey, "tokens_output", day, "", tokensOut, attribution, sc));
  g.addRecord(
    rec(subjectKey, "spend_cents_estimated", day, "", jitterInt(rng, 55 * multiplier, 0.3, 5), attribution, sc),
  );

  // Local Claude Code only ever runs Claude models — split sonnet/opus via
  // the same weekly share as Anthropic Console so it reinforces (rather than
  // drowns out with a constant sonnet-only mass) the org-wide model-mix
  // trend (CLAUDE.md: gpt-5 falling / claude-sonnet-5 rising).
  const share = modelMixShare(weekIndex);
  const reqTotal = jitterInt(rng, 6 * multiplier, 0.4, 1);
  const sonnetReq = Math.round(reqTotal * share.sonnet);
  const opusReq = Math.max(0, reqTotal - sonnetReq);
  if (sonnetReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.sonnet, sonnetReq, attribution, sc));
  if (opusReq > 0)
    g.addRecord(rec(subjectKey, "model_requests", day, MODEL.opus, opusReq, attribution, sc));
  const sonnetTok = Math.round(tokensIn * share.sonnet);
  const opusTok = Math.max(0, tokensIn - sonnetTok);
  if (sonnetTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.sonnet, sonnetTok, attribution, sc));
  if (opusTok > 0)
    g.addRecord(rec(subjectKey, "model_tokens", day, MODEL.opus, opusTok, attribution, sc));

  // Deliberately NO feature_used here: claude_code_local's real emission
  // subset is active_day, sessions, prompts, tokens_*, spend_cents_estimated,
  // model_requests/model_tokens + "event" signals ONLY. The feature=claude_code
  // dim belongs to the Anthropic Console connector's claude_code surface
  // (emitAnthropicDay), never to the local agent.

  const activeSlots = randInt(rng, 2, 4);
  g.addSignal({
    subject: subjectKey,
    day,
    hours: buildHours(rng, activeSlots, jitterInt(rng, 6 * multiplier, 0.3, 1), ALL_HOURS),
    // Always 1 for a single-person subject: peak ≥2 is the shared-account
    // concurrent_usage signal, and a legit user must never trip it.
    peakConcurrency: 1,
    sourceGranularity: "event",
  });
}

// ---------------------------------------------------------------------------
// Special Acme subjects: the shared console login, the unresolved CI key,
// and the two org-level billing accounts.
// ---------------------------------------------------------------------------

const SHARED_CONSOLE_KEY = "shared-anthropic-console";
const SVC_CI_RUNNER_KEY = "svc-ci-runner";

/** High-volume shared login: ≥18/24 hour slots on one day, peakConcurrency
 * 2-3 on several days, cumulative tokens_input ≥3x a normal subject's median
 * — mirrors fixtures/metric-records/team-30d.json's shared-console shape. */
function buildSharedConsole(g: GraphBuilder, rng: Rng, ctx: WindowCtx): void {
  const sc = SOURCE_CONNECTOR.anthropic;
  const attribution: AttributionLevel = "account";
  const activeDays = pickWeekdayDays(rng, ctx.windowStart, ctx.anchorDay, 55);
  const busyDays = new Set(shuffle(rng, activeDays).slice(0, 10));
  const highDay = activeDays[Math.floor(activeDays.length / 2)];

  for (const day of activeDays) {
    g.addRecord(rec(SHARED_CONSOLE_KEY, "active_day", day, "", 1, attribution, sc));
    // Shared (multi-person) prompt volume — the concentration panel must
    // DISCLOSE this as excluded volume, never attribute it to a person.
    g.addRecord(
      rec(SHARED_CONSOLE_KEY, "prompts", day, "", jitterInt(rng, 95, 0.3, 10), attribution, sc),
    );
    const tokensIn = jitterInt(rng, 70_000, 0.3, 5000);
    g.addRecord(rec(SHARED_CONSOLE_KEY, "tokens_input", day, "", tokensIn, attribution, sc));
    g.addRecord(
      rec(SHARED_CONSOLE_KEY, "tokens_output", day, "", jitterInt(rng, 14_000, 0.3, 500), attribution, sc),
    );
    g.addRecord(
      rec(SHARED_CONSOLE_KEY, "spend_cents", day, "", jitterInt(rng, 900, 0.3, 50), attribution, sc),
    );
    // Deliberately no model_requests/model_tokens here: this subject's
    // volume is huge and constant across the whole window, and adding it to
    // either model bucket would swamp the trend-controlled cursor/anthropic/
    // openai/claude_code_local mix (CLAUDE.md's gpt-5⇄sonnet shift).

    if (day === highDay) {
      g.addSignal({
        subject: SHARED_CONSOLE_KEY,
        day,
        hours: buildHours(rng, 20, Math.round(tokensIn / 500), ALL_HOURS),
        peakConcurrency: 3,
        sourceGranularity: "event",
      });
    } else if (busyDays.has(day)) {
      g.addSignal({
        subject: SHARED_CONSOLE_KEY,
        day,
        hours: buildHours(rng, randInt(rng, 6, 10), Math.round(tokensIn / 800)),
        peakConcurrency: randInt(rng, 2, 3),
        sourceGranularity: "event",
      });
    }
  }
}

/** Unresolved service-account key: steady CI activity, key_project
 * attribution, no identity link, spend_cents_estimated only (never billed
 * spend_cents — CLAUDE.md's "estimated-only" rule for api_actor traffic). */
function buildSvcCiRunner(g: GraphBuilder, rng: Rng, ctx: WindowCtx): void {
  const sc = SOURCE_CONNECTOR.anthropic;
  const attribution: AttributionLevel = "key_project";
  const days = pickWeekdayDays(
    rng,
    ctx.windowStart,
    ctx.anchorDay,
    Math.round(0.65 * businessDayCount(ctx)),
  );
  for (const day of days) {
    g.addRecord(rec(SVC_CI_RUNNER_KEY, "active_day", day, "", 1, attribution, sc));
    // Unresolved key volume the concentration panel must disclose.
    g.addRecord(
      rec(SVC_CI_RUNNER_KEY, "prompts", day, "", jitterInt(rng, 22, 0.3, 3), attribution, sc),
    );
    // Steady but MODEST tokens: this is a legit (if unattributed) CI key,
    // not a shared seat — its cumulative tokens_input must stay well under
    // 3x the team median or the volume heuristic false-flags it.
    const tokensIn = jitterInt(rng, 5500, 0.3, 500);
    g.addRecord(rec(SVC_CI_RUNNER_KEY, "tokens_input", day, "", tokensIn, attribution, sc));
    g.addRecord(
      rec(SVC_CI_RUNNER_KEY, "tokens_output", day, "", jitterInt(rng, 1100, 0.3, 100), attribution, sc),
    );
    g.addRecord(
      rec(SVC_CI_RUNNER_KEY, "spend_cents_estimated", day, "", jitterInt(rng, 210, 0.3, 20), attribution, sc),
    );
    // No model_requests/model_tokens for the same reason as the shared
    // console: constant background volume would swamp the model-mix trend.
  }
}

/** Org-level billing account: daily billed spend_cents, account attribution,
 * no identity link — the honest home for MTD budget math. */
function buildOrgAccount(
  g: GraphBuilder,
  rng: Rng,
  ctx: WindowCtx,
  subjectKey: string,
  vendor: "anthropic" | "openai",
  baseSpendCents: number,
  density: number,
): void {
  const sc = SOURCE_CONNECTOR[vendor];
  const attribution: AttributionLevel = "account";
  const days = pickWeekdayDays(
    rng,
    ctx.windowStart,
    ctx.anchorDay,
    Math.round(density * businessDayCount(ctx)),
  );
  for (const day of days) {
    g.addRecord(rec(subjectKey, "active_day", day, "", 1, attribution, sc));
    g.addRecord(
      rec(subjectKey, "spend_cents", day, "", jitterInt(rng, baseSpendCents, 0.3, 50), attribution, sc),
    );
  }
}

// ---------------------------------------------------------------------------
// Org 1 — Acme Robotics (team).
// ---------------------------------------------------------------------------

const ACME_CONNECTIONS: FixtureGraph["connections"] = [
  { key: "anthropic", vendor: "anthropic_console", displayName: "Anthropic Console", authKind: "api_key" },
  { key: "openai", vendor: "openai", displayName: "OpenAI", authKind: "api_key" },
  { key: "cursor", vendor: "cursor", displayName: "Cursor", authKind: "admin_key" },
  { key: "copilot", vendor: "github_copilot", displayName: "GitHub Copilot", authKind: "github_app" },
  { key: "claude_code_local", vendor: "claude_code_local", displayName: "Revealyst Agent", authKind: "device_token" },
  { key: "openai_legacy", vendor: "openai", displayName: "OpenAI (legacy key)", authKind: "api_key" },
  { key: "cursor_sandbox", vendor: "cursor", displayName: "Cursor (sandbox)", authKind: "admin_key" },
];

const OAUTH_GAP_DETAIL =
  "OAuth-based actors are not attributed to a person (Console bug #27780).";

/**
 * Person-level clones of the three global team presets (drizzle/0009),
 * mirroring fixtures/score-definitions/personal-presets.json — same slugs/
 * versions/components, subjectLevel "person". Seeded org-scoped into Acme
 * via SeedOrgPlan.scoreDefinitions so recompute writes person-level rows
 * and the segments panel has buckets to fill (standing in for W2-I's
 * canonical segmentation job).
 */
const PERSON_PRESET_CLONES: ScoreDefinitionInput[] = [
  {
    slug: "adoption",
    version: 1,
    name: "AI Adoption Score",
    subjectLevel: "person",
    status: "active",
    components: [
      {
        key: "active_days",
        metric: "active_day",
        aggregation: "active_days",
        weight: 0.5,
        normalization: { min: 0, max: 20 },
      },
      {
        key: "tool_coverage",
        metric: "feature_used",
        aggregation: "distinct_dims",
        weight: 0.5,
        normalization: { min: 0, max: 6 },
      },
    ],
  },
  {
    slug: "fluency",
    version: 1,
    name: "AI Fluency Score",
    subjectLevel: "person",
    status: "active",
    components: [
      {
        key: "breadth",
        metric: "feature_used",
        aggregation: "distinct_dims",
        weight: 0.33,
        normalization: { min: 0, max: 8 },
      },
      {
        key: "depth",
        metric: "active_day",
        aggregation: "active_days",
        weight: 0.33,
        normalization: { min: 0, max: 20 },
      },
      {
        key: "effectiveness",
        ratio: {
          numerator: { metric: "suggestions_accepted", aggregation: "sum" },
          denominator: { metric: "suggestions_offered", aggregation: "sum" },
        },
        weight: 0.34,
        normalization: { min: 0, max: 0.5 },
      },
    ],
  },
  {
    slug: "efficiency",
    version: 1,
    name: "AI Efficiency Score",
    subjectLevel: "person",
    status: "active",
    components: [
      {
        key: "output_per_spend",
        ratio: {
          numerator: { metric: "suggestions_accepted", aggregation: "sum" },
          denominator: { metric: "spend_cents", aggregation: "sum" },
        },
        weight: 0.5,
        normalization: { min: 0, max: 0.2 },
      },
      {
        key: "engagement_per_spend",
        ratio: {
          numerator: { metric: "active_day", aggregation: "active_days" },
          denominator: { metric: "spend_cents", aggregation: "sum" },
        },
        weight: 0.5,
        normalization: { min: 0, max: 0.01 },
      },
    ],
  },
];

function buildAcmeGraph(rng: Rng, ctx: WindowCtx): GraphBuilder {
  const g = new GraphBuilder();
  g.connections.push(...ACME_CONNECTIONS);

  for (const team of ACME_TEAMS) {
    g.teams.push({
      key: team.key,
      name: team.name,
      members: ACME_PEOPLE.filter((p) => p.team === team.key).map((p) => p.key),
    });
  }

  for (const persona of ACME_PEOPLE) {
    g.people.push({
      key: persona.key,
      pseudonym: persona.pseudonym,
      displayName: null,
      email: `${persona.pseudonym}@${ACME_EMAIL_DOMAIN}`,
    });
    for (const vendor of persona.vendors) {
      const subjectKey = `${persona.key}-${vendor}`;
      const email = `${persona.pseudonym}@${ACME_EMAIL_DOMAIN}`;
      g.subjects.push({
        key: subjectKey,
        connection: vendor,
        kind: "person",
        externalId: vendor === "copilot" ? `${persona.pseudonym}-gh` : email,
        email,
        displayName: null,
      });
      g.identities.push({
        subject: subjectKey,
        person: persona.key,
        method: vendor === "copilot" ? "vendor_asserted" : "email_match",
      });
    }
  }

  // Shared console login, linked to 3 people spanning different teams.
  g.subjects.push({
    key: SHARED_CONSOLE_KEY,
    connection: "anthropic",
    kind: "account",
    externalId: "shared-team-login",
    email: null,
    displayName: "Shared Console Login",
  });
  for (const person of ["quiet-otter", "mellow-badger", "hushed-vole"]) {
    g.identities.push({ subject: SHARED_CONSOLE_KEY, person, method: "manual" });
  }

  // Unresolved CI key — no identity link.
  g.subjects.push({
    key: SVC_CI_RUNNER_KEY,
    connection: "anthropic",
    kind: "api_key",
    externalId: "svc-ci-runner",
    email: null,
    displayName: "CI Runner",
  });

  // Org-level billing accounts — no identity link.
  g.subjects.push({
    key: "acme-org-account-anthropic",
    connection: "anthropic",
    kind: "account",
    externalId: "acme-robotics-billing",
    email: null,
    displayName: "Acme Robotics (billing)",
  });
  g.subjects.push({
    key: "acme-org-account-openai",
    connection: "openai",
    kind: "account",
    externalId: "acme-robotics-billing-openai",
    email: null,
    displayName: "Acme Robotics (billing)",
  });

  // Per-persona day-by-day emission. power_1 (multi-vendor) uses ONE day
  // list applied to all its subjects, so anthropic+cursor+claude_code_local
  // genuinely land on the SAME days (person-day dedup exercise).
  for (const persona of ACME_PEOPLE) {
    if (persona.vendors.length === 0) continue; // unsegmented — no subject at all
    let spec: PersonaDaySpec = persona;
    if (persona.band === "churned") {
      // Silent for the trailing 35 days AND all of the current + previous
      // month — clamp the eligibility window against prevMonth.start too.
      const cutoff = minDay(
        addDays(ctx.anchorDay, -35),
        addDays(ctx.prevMonth.start, -1),
      );
      spec = { ...persona, activeUntilDaysBeforeAnchor: diffDays(cutoff, ctx.anchorDay) };
    }
    const multiplier = BAND_MULTIPLIER[persona.band];
    const promptsMult = PROMPTS_INTENSITY[persona.band];
    const days = buildPersonaDays(rng, spec, ctx);
    for (const day of days) {
      const weekIndex = weekIndexForDay(day, ctx);
      const month = monthFlag(day, ctx);
      for (const vendor of persona.vendors) {
        const subjectKey = `${persona.key}-${vendor}`;
        switch (vendor) {
          case "anthropic":
            emitAnthropicDay(g, rng, subjectKey, day, multiplier, weekIndex);
            break;
          case "openai":
            emitOpenaiDay(g, rng, subjectKey, day, multiplier, promptsMult);
            break;
          case "cursor":
            emitCursorDay(g, rng, subjectKey, day, multiplier, weekIndex, month, promptsMult);
            break;
          case "copilot":
            emitCopilotDay(
              g,
              rng,
              subjectKey,
              day,
              multiplier,
              weekIndex,
              month,
              chance(rng, 0.04),
              promptsMult,
            );
            break;
          case "claude_code_local":
            emitClaudeCodeLocalDay(g, rng, subjectKey, day, multiplier, weekIndex, promptsMult);
            break;
        }
      }
    }
  }

  buildSharedConsole(g, rng, ctx);
  buildSvcCiRunner(g, rng, ctx);
  buildOrgAccount(g, rng, ctx, "acme-org-account-anthropic", "anthropic", 480, 0.85);
  buildOrgAccount(g, rng, ctx, "acme-org-account-openai", "openai", 260, 0.8);

  return g;
}

function buildAcmeConnectorRuns(ctx: WindowCtx): ConnectorRunSpec[] {
  const recentStart = addDays(ctx.anchorDay, -2);
  const midStart = addDays(ctx.anchorDay, -9);
  const midEnd = addDays(ctx.anchorDay, -3);
  const backfillEnd = addDays(ctx.anchorDay, -10);

  const gapsFor = (
    key: string,
    idx: number,
  ): HonestyGap[] | undefined => {
    switch (key) {
      case "anthropic":
        // Same (kind, detail) pair on two different runs — dedupe check.
        return [{ kind: "oauth_actors_missing", detail: OAUTH_GAP_DETAIL }];
      case "copilot":
        return idx === 0
          ? [
              { kind: "telemetry_only_users_in_totals", detail: "Server-side telemetry includes users outside the resolved roster." },
              { kind: "sub_daily_unavailable", detail: "Copilot reports daily grain only." },
            ]
          : undefined;
      case "openai":
        return idx === 0
          ? [{ kind: "shared_key_not_person_level", detail: "Shared/service API keys can't be attributed to a person." }]
          : undefined;
      case "cursor":
        return idx === 0
          ? [{ kind: "service_accounts_unresolved", detail: "Cursor service-account usage has no person-level owner." }]
          : undefined;
      default:
        return undefined;
    }
  };

  const runs: ConnectorRunSpec[] = [];
  for (const key of ["anthropic", "openai", "cursor", "copilot", "claude_code_local"]) {
    for (let i = 0; i < 2; i++) {
      runs.push({
        connection: key,
        kind: "poll",
        outcome: "success",
        windowStart: i === 0 ? recentStart : midStart,
        windowEnd: i === 0 ? ctx.anchorDay : midEnd,
        subjectsSeen: randCountForRun(key),
        recordsUpserted: randCountForRun(key) * 12,
        signalsUpserted: randCountForRun(key) * 2,
        gaps: gapsFor(key, i),
      });
    }
    runs.push({
      connection: key,
      kind: "backfill",
      outcome: "success",
      windowStart: ctx.windowStart,
      windowEnd: backfillEnd,
      subjectsSeen: randCountForRun(key),
      recordsUpserted: randCountForRun(key) * 60,
      signalsUpserted: randCountForRun(key) * 20,
    });
  }

  runs.push({
    connection: "openai_legacy",
    kind: "poll",
    outcome: "error",
    windowStart: recentStart,
    windowEnd: ctx.anchorDay,
    error: "429: rate limited — too many requests, retry after backoff",
  });

  return runs;
}

function randCountForRun(key: string): number {
  // Deterministic-enough placeholder magnitudes (narrative realism only —
  // not asserted against actual generated counts).
  const base: Record<string, number> = {
    anthropic: 2,
    openai: 5,
    cursor: 6,
    copilot: 5,
    claude_code_local: 1,
  };
  return base[key] ?? 2;
}

function buildAcmeOrg(anchorDay: string, ctx: WindowCtx): SeedOrgPlan {
  const rng = createRng(DEFAULT_SEED);
  const g = buildAcmeGraph(rng, ctx);
  const graph = g.toGraph();

  // Spend governance sums ALL spend_cents rows regardless of attribution
  // (readSpendGovernance) — size the limit from the org-wide current-month
  // total (org accounts + shared console + Cursor person-attributed spend)
  // so pctUsed lands ≈85% (crosses the 80 threshold, never 100).
  const mtdSpend = graph.records
    .filter(
      (r) => r.metricKey === "spend_cents" && r.day >= ctx.monthStartCurrent,
    )
    .reduce((sum, r) => sum + r.value, 0);
  const budgetLimit = Math.max(1000, Math.round(mtdSpend / 0.85));

  return {
    name: "Acme Robotics",
    kind: "team",
    visibilityMode: "managed",
    users: [
      {
        key: "tara",
        name: "Tara CTO",
        email: `tara.cto@${ACME_EMAIL_DOMAIN}`,
        password: "Demo-Pass-2026!",
        orgRole: "admin",
      },
      {
        key: "member-power",
        name: "Priya Falcon",
        email: `brisk-falcon@${ACME_EMAIL_DOMAIN}`,
        password: "Demo-Pass-2026!",
        orgRole: "member",
        person: "brisk-falcon",
      },
      {
        key: "platform-staff",
        name: "Sam Reyes",
        email: "sam.reyes@revealyst.example",
        password: "Demo-Pass-2026!",
        orgRole: "member",
        platformAdmin: true,
      },
    ],
    graph,
    connectionStates: [
      { connection: "anthropic", status: "active", synced: true },
      { connection: "openai", status: "active", synced: true },
      { connection: "cursor", status: "active", synced: true },
      { connection: "copilot", status: "active", synced: true },
      { connection: "claude_code_local", status: "active", synced: true },
      { connection: "openai_legacy", status: "error", lastError: "invalid_api_key: key revoked" },
      { connection: "cursor_sandbox", status: "paused" },
    ],
    connectorRuns: buildAcmeConnectorRuns(ctx),
    budget: { monthlyLimitCents: budgetLimit, alertThresholds: [50, 80, 100] },
    subscription: { status: "active", quantity: 12 },
    scoreDefinitions: PERSON_PRESET_CLONES,
    customIndexes: [
      {
        slug: "custom-agentic-momentum",
        name: "Agentic Momentum",
        subjectLevel: "org",
        components: [
          {
            key: "agentic_days",
            metric: "agent_active",
            aggregation: "active_days",
            weight: 0.5,
            normalization: { min: 0, max: 15 },
          },
          {
            key: "agent_breadth",
            metric: "feature_used",
            aggregation: "distinct_dims",
            weight: 0.3,
            normalization: { min: 0, max: 4 },
          },
          {
            key: "agent_ratio",
            ratio: {
              numerator: { metric: "agent_requests", aggregation: "sum" },
              denominator: { metric: "prompts", aggregation: "sum" },
            },
            weight: 0.2,
            normalization: { min: 0, max: 1 },
          },
        ],
      },
      {
        slug: "custom-legacy-pilot",
        name: "Legacy Pilot Index",
        subjectLevel: "team",
        archived: true,
        components: [
          {
            key: "legacy_usage",
            metric: "sessions",
            aggregation: "sum",
            weight: 1,
            normalization: { min: 0, max: 200 },
          },
        ],
      },
    ],
    shareLinks: [
      { person: "brisk-falcon", scoreSlug: "fluency", publicLabel: "Acme Robotics — Fluency Score" },
    ],
    invites: [{ email: `newhire@${ACME_EMAIL_DOMAIN}`, role: "member" }],
    benchmarkConsent: [{ user: "member-power", granted: true }],
    auditEvents: [
      {
        actor: "tara",
        action: "connection.created",
        targetKind: "connection",
        targetId: "anthropic",
        metadata: { vendor: "anthropic_console" },
      },
      {
        actor: "tara",
        action: "budget.updated",
        targetKind: "budget",
        metadata: { monthlyLimitCents: budgetLimit },
      },
      {
        actor: "platform-staff",
        action: "org.impersonation_started",
        targetKind: "org",
        metadata: { reason: "support" },
      },
    ],
    recompute: [
      { grain: "month", anchorDay: ctx.prevMonthMidDay },
      { grain: "month", anchorDay: ctx.anchorDay },
      { grain: "rolling_28d", anchorDay: ctx.anchorDay },
    ],
  };
}

// ---------------------------------------------------------------------------
// Org 2 — Jordan Lee (personal, bootstrapped through ensureOrgOfOne).
// ---------------------------------------------------------------------------

// Personal mode genuinely cannot obtain suggestions_offered/accepted (no
// Jordan connector reports them), so the fluency effectiveness component is
// OMITTED here — that absence IS the honest scenario, never fabricated.
// Efficiency stays computable via a billed-spend account subject the user
// self-linked in the reconcile UI (manual method): its account-attributed
// spend_cents rows also degrade Jordan's score attribution to "account"
// via lowestAttribution — the personal-mode attribution-honesty exercise.
function buildJordanOrg(anchorDay: string, ctx: WindowCtx): SeedOrgPlan {
  const rng = createRng(DEFAULT_SEED + 1);
  const g = new GraphBuilder();
  g.connections.push(
    { key: "anthropic", vendor: "anthropic_console", displayName: "Anthropic Console", authKind: "api_key" },
    { key: "openai", vendor: "openai", displayName: "OpenAI", authKind: "api_key" },
    { key: "claude_code_local", vendor: "claude_code_local", displayName: "Revealyst Agent", authKind: "device_token" },
  );
  g.people.push({ key: JORDAN_KEY, pseudonym: JORDAN_PSEUDONYM, displayName: null, email: JORDAN_EMAIL });
  g.subjects.push(
    {
      key: "jordan-anthropic",
      connection: "anthropic",
      kind: "api_key",
      externalId: "jordan-personal-key",
      email: null,
      displayName: null,
    },
    {
      key: "jordan-openai",
      connection: "openai",
      kind: "person",
      externalId: JORDAN_EMAIL,
      email: JORDAN_EMAIL,
      displayName: null,
    },
    {
      key: "jordan-claude_code_local",
      connection: "claude_code_local",
      kind: "person",
      externalId: JORDAN_EMAIL,
      email: JORDAN_EMAIL,
      displayName: null,
    },
    // Jordan's own console billing account, self-linked via reconcile
    // (manual) — carries daily billed spend_cents at account attribution.
    {
      key: "jordan-anthropic-billing",
      connection: "anthropic",
      kind: "account",
      externalId: "jordan-console-billing",
      email: null,
      displayName: "Jordan Lee (console billing)",
    },
  );
  g.identities.push(
    { subject: "jordan-anthropic", person: JORDAN_KEY, method: "manual" },
    { subject: "jordan-openai", person: JORDAN_KEY, method: "email_match" },
    { subject: "jordan-claude_code_local", person: JORDAN_KEY, method: "email_match" },
    { subject: "jordan-anthropic-billing", person: JORDAN_KEY, method: "manual" },
  );

  // Current month: high density (robust to anchorDay's day-of-month — a
  // partial month can't literally hold "~18 active days" unless anchor
  // lands late in the month). Previous month: a real, slightly lower
  // density over a full calendar month — the delta the README asks for.
  const currentBusinessDays = weekdayCount(ctx.monthStartCurrent, ctx.anchorDay);
  const currentDays = pickWeekdayDays(
    rng,
    ctx.monthStartCurrent,
    ctx.anchorDay,
    Math.max(1, Math.round(currentBusinessDays * 0.85)),
  );
  const prevDays = pickWeekdayDays(rng, ctx.prevMonth.start, ctx.prevMonth.end, 16);
  const earlierDays = pickWeekdayDays(
    rng,
    ctx.windowStart,
    addDays(ctx.prevMonth.start, -1),
    10,
  );

  for (const day of [...earlierDays, ...prevDays, ...currentDays]) {
    const weekIndex = weekIndexForDay(day, ctx);
    // api_key subject → key_project attribution (its honest ceiling); it
    // also carries the anthropic claude_code surface's feature=claude_code
    // dim (Jordan's Claude Code runs against this key).
    emitAnthropicDay(g, rng, "jordan-anthropic", day, 1.4, weekIndex, "key_project");
    if (chance(rng, 0.7)) {
      emitOpenaiDay(g, rng, "jordan-openai", day, 1.0);
    }
    emitClaudeCodeLocalDay(g, rng, "jordan-claude_code_local", day, 1.4, weekIndex);
  }

  // Daily billed spend on the self-linked billing account (spend_cents ONLY
  // — no active_day, so the persona's active-day counts stay untouched;
  // efficiency's engagement_per_spend denominator + the account-level
  // lowestAttribution degradation both come from these rows).
  const billingDays = pickWeekdayDays(
    rng,
    ctx.windowStart,
    ctx.anchorDay,
    Math.round(0.85 * businessDayCount(ctx)),
  );
  for (const day of billingDays) {
    g.addRecord(
      rec("jordan-anthropic-billing", "spend_cents", day, "", jitterInt(rng, 130, 0.3, 15), "account", SOURCE_CONNECTOR.anthropic),
    );
  }

  return {
    name: "Jordan Lee",
    kind: "personal",
    bootstrapUser: "jordan",
    users: [
      {
        key: "jordan",
        name: "Jordan Lee",
        email: JORDAN_EMAIL,
        password: "Demo-Pass-2026!",
        orgRole: "admin",
        person: JORDAN_KEY,
      },
    ],
    graph: g.toGraph(),
    connectionStates: [
      { connection: "anthropic", status: "active", synced: true },
      { connection: "openai", status: "active", synced: true },
      { connection: "claude_code_local", status: "active", synced: true },
    ],
    connectorRuns: [
      {
        connection: "anthropic",
        kind: "poll",
        outcome: "success",
        windowStart: addDays(anchorDay, -2),
        windowEnd: anchorDay,
        subjectsSeen: 2,
        recordsUpserted: 45,
        signalsUpserted: 12,
      },
      {
        connection: "openai",
        kind: "poll",
        outcome: "success",
        windowStart: addDays(anchorDay, -2),
        windowEnd: anchorDay,
        subjectsSeen: 1,
        recordsUpserted: 30,
        signalsUpserted: 8,
      },
      {
        connection: "claude_code_local",
        kind: "poll",
        outcome: "success",
        windowStart: addDays(anchorDay, -2),
        windowEnd: anchorDay,
        subjectsSeen: 1,
        recordsUpserted: 40,
        signalsUpserted: 12,
      },
    ],
    benchmarkConsent: [{ user: "jordan", granted: true }],
    shareLinks: [{ person: JORDAN_KEY, scoreSlug: "adoption", publicLabel: "Jordan's AI Adoption" }],
    recompute: [
      { grain: "month", anchorDay: ctx.prevMonthMidDay },
      { grain: "month", anchorDay: ctx.anchorDay },
      { grain: "rolling_28d", anchorDay: ctx.anchorDay },
    ],
  };
}

// ---------------------------------------------------------------------------
// Org 3 — Globex Pilot (small team, no subscription, over budget).
// ---------------------------------------------------------------------------

function buildGlobexOrg(anchorDay: string, ctx: WindowCtx): SeedOrgPlan {
  const rng = createRng(DEFAULT_SEED + 2);
  const g = new GraphBuilder();
  g.connections.push({
    key: "anthropic",
    vendor: "anthropic_console",
    displayName: "Anthropic Console",
    authKind: "api_key",
  });

  // Presets are team-level — without a team, recomputeOrg writes ZERO
  // team-level score rows for this org. One team holds all three people.
  g.teams.push({
    key: "pilot",
    name: "Pilot Team",
    members: GLOBEX_PEOPLE.map((p) => p.key),
  });

  for (const p of GLOBEX_PEOPLE) {
    const email = `${p.pseudonym}@${GLOBEX_EMAIL_DOMAIN}`;
    g.people.push({ key: p.key, pseudonym: p.pseudonym, displayName: null, email });
    const subjectKey = `${p.key}-anthropic`;
    g.subjects.push({
      key: subjectKey,
      connection: "anthropic",
      kind: "person",
      externalId: email,
      email,
      displayName: null,
    });
    g.identities.push({ subject: subjectKey, person: p.key, method: "email_match" });

    const spec: PersonaDaySpec = {
      currentMonthActiveDays: p.currentMonthActiveDays,
      trailing28ActiveDays: p.trailing28ActiveDays,
      historyWeeklyActiveDays: p.historyWeeklyActiveDays,
      activeSinceDaysBeforeAnchor: null,
      activeUntilDaysBeforeAnchor: null,
    };
    for (const day of buildPersonaDays(rng, spec, ctx)) {
      emitAnthropicDay(g, rng, subjectKey, day, 1.3, weekIndexForDay(day, ctx));
    }
  }

  g.subjects.push({
    key: "globex-org-account",
    connection: "anthropic",
    kind: "account",
    externalId: "globex-billing",
    email: null,
    displayName: "Globex Pilot (billing)",
  });
  const billingDays = pickWeekdayDays(
    rng,
    ctx.windowStart,
    ctx.anchorDay,
    Math.round(0.8 * businessDayCount(ctx)),
  );
  for (const day of billingDays) {
    g.addRecord(rec("globex-org-account", "active_day", day, "", 1, "account", SOURCE_CONNECTOR.anthropic));
    g.addRecord(
      rec("globex-org-account", "spend_cents", day, "", jitterInt(rng, 70, 0.3, 10), "account", SOURCE_CONNECTOR.anthropic),
    );
  }
  // Estimated-only spend stretch: a few days with ONLY spend_cents_estimated.
  for (const day of pickWeekdayDays(rng, ctx.trailing28Start, ctx.anchorDay, 3)) {
    g.addRecord(
      rec("globex-org-account", "spend_cents_estimated", day, "", jitterInt(rng, 40, 0.3, 5), "account", SOURCE_CONNECTOR.anthropic),
    );
  }

  const mtdBilled = g.records
    .filter((r) => r.metricKey === "spend_cents" && r.day >= ctx.monthStartCurrent)
    .reduce((sum, r) => sum + r.value, 0);
  // Budget deliberately below MTD spend — over-budget (≥100% of limit).
  const budgetLimit = Math.max(500, Math.round(mtdBilled * 0.9));

  return {
    name: "Globex Pilot",
    kind: "team",
    graph: g.toGraph(),
    connectionStates: [{ connection: "anthropic", status: "active", synced: true }],
    connectorRuns: [
      {
        connection: "anthropic",
        kind: "poll",
        outcome: "success",
        windowStart: addDays(anchorDay, -3),
        windowEnd: anchorDay,
        subjectsSeen: 3,
        recordsUpserted: 60,
        signalsUpserted: 20,
      },
      {
        connection: "anthropic",
        kind: "backfill",
        outcome: "success",
        windowStart: ctx.windowStart,
        windowEnd: addDays(anchorDay, -4),
        subjectsSeen: 3,
        recordsUpserted: 220,
        signalsUpserted: 60,
      },
    ],
    budget: { monthlyLimitCents: budgetLimit, alertThresholds: [50, 80, 100] },
    recompute: [
      { grain: "month", anchorDay: ctx.prevMonthMidDay },
      { grain: "month", anchorDay: ctx.anchorDay },
      { grain: "rolling_28d", anchorDay: ctx.anchorDay },
    ],
  };
}

// ---------------------------------------------------------------------------
// Orgs 4-7 — onboarding states (tiny, no records/signals, no recompute).
// scoreTimingChannel (src/lib/onboarding-guide.ts) drives the classification:
// same_day (usable poll conn), overnight (local synced), awaiting_agent
// (local never synced), mixed (poll + local). `status` omitted from
// connectionStates leaves a connection at its post-create default (pending,
// still usable — never "error"/"paused").
// ---------------------------------------------------------------------------

function buildOnboardingOrgs(): SeedOrgPlan[] {
  const tiny = (
    name: string,
    connections: FixtureGraph["connections"],
    connectionStates: ConnectionStateSpec[],
  ): SeedOrgPlan => ({
    name,
    kind: "team",
    graph: {
      connections,
      people: [],
      teams: [],
      subjects: [],
      identities: [],
      records: [],
      signals: [],
    },
    connectionStates,
    recompute: [],
  });

  return [
    tiny(
      "Onboarding — Same Day",
      [{ key: "anthropic", vendor: "anthropic_console", displayName: "Anthropic Console", authKind: "api_key" }],
      [{ connection: "anthropic", status: "active", synced: true }],
    ),
    tiny(
      "Onboarding — Overnight",
      [{ key: "claude_code_local", vendor: "claude_code_local", displayName: "Revealyst Agent", authKind: "device_token" }],
      [{ connection: "claude_code_local", status: "active", synced: true }],
    ),
    tiny(
      "Onboarding — Awaiting Agent",
      [{ key: "claude_code_local", vendor: "claude_code_local", displayName: "Revealyst Agent", authKind: "device_token" }],
      [],
    ),
    tiny(
      "Onboarding — Mixed",
      [
        { key: "cursor", vendor: "cursor", displayName: "Cursor", authKind: "admin_key" },
        { key: "claude_code_local", vendor: "claude_code_local", displayName: "Revealyst Agent", authKind: "device_token" },
      ],
      [{ connection: "cursor", status: "active", synced: true }],
    ),
  ];
}

// ---------------------------------------------------------------------------
// Top-level entry point.
// ---------------------------------------------------------------------------

export const buildDemoSeedPlan: BuildDemoSeedPlan = (anchorDay: string): SeedPlan => {
  const ctx = buildWindowCtx(anchorDay);
  return {
    anchorDay,
    orgs: [
      buildAcmeOrg(anchorDay, ctx),
      buildJordanOrg(anchorDay, ctx),
      buildGlobexOrg(anchorDay, ctx),
      ...buildOnboardingOrgs(),
    ],
    verifyBenchmarkRow: true,
  };
};
