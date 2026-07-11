import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeAnthropic } from "../src/connectors/anthropic/normalize";
import {
  ENVELOPE_KINDS as ANTHROPIC_KINDS,
  type AnthropicRaw,
} from "../src/connectors/anthropic/types";
import { normalizeCopilot } from "../src/connectors/copilot/normalize";
import {
  ENVELOPE_KINDS as COPILOT_KINDS,
  type CopilotRaw,
} from "../src/connectors/copilot/types";
import { normalizeCursor } from "../src/connectors/cursor/normalize";
import {
  ENVELOPE_KINDS as CURSOR_KINDS,
  type CursorRaw,
} from "../src/connectors/cursor/types";
import type { NormalizedBatch, RawPayloadEnvelope } from "../src/contracts/connector";
import {
  computeAgenticAdoption,
  type AgenticMetricRow,
} from "../src/lib/agentic-adoption";

// F1.4 fixture-integration test (review F5, plan §4 F1.4 "verify per-connector
// emission as part of the feature's fixture tests"): feed the RECORDED vendor
// payload fixtures through the real normalizers into computeAgenticAdoption
// and pin the resulting rate. This is the test class that catches F1-style
// bugs — the Anthropic fixtures genuinely emit the same human (alice) under
// TWO subjects on the same day (`acct:acct_01BBB` from usage_report and
// `alice@example.com` from claude_code), and Cursor adds a third subject for
// her — so a subject-day counter instead of a person-day counter changes the
// pinned numbers.

const fixture = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const usagePage = fixture("fixtures/connectors/anthropic_console/usage-messages-1h.json");
const claudeCodePage = fixture("fixtures/connectors/anthropic_console/claude-code-daily.json");
const copilotUsers = fixture("fixtures/connectors/copilot/users-1-day.json");
const cursorDaily = fixture("fixtures/connectors/cursor/daily-usage-data.json");

const usageEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ANTHROPIC_KINDS.usage,
  window: { start: "2026-06-11", end: "2026-06-12" },
  payload: { surface: "usage_messages", page: usagePage },
};
const claudeCodeEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ANTHROPIC_KINDS.claudeCode,
  window: { start: "2026-06-11", end: "2026-06-11" },
  payload: { surface: "claude_code", page: claudeCodePage },
};
const copilotEnvelope: RawPayloadEnvelope<CopilotRaw> = {
  kind: COPILOT_KINDS.usersDaily,
  window: { start: "2026-06-19", end: "2026-06-19" },
  payload: { surface: "users_daily", day: "2026-06-19", records: copilotUsers.records },
};
const cursorEnvelope: RawPayloadEnvelope<CursorRaw> = {
  kind: CURSOR_KINDS.dailyUsage,
  window: { start: "2026-06-11", end: "2026-06-11" },
  payload: { surface: "daily_usage", rows: cursorDaily.data },
};

/** Flattens a NormalizedBatch's records for one metric key into the lib's row
 * shape. Subject ids are prefixed per vendor — in production each connection's
 * subjects are distinct DB rows; the prefix mirrors that. */
function rowsFor(
  batches: { batch: NormalizedBatch; vendor: string; connector: string }[],
  metricKey: string,
): AgenticMetricRow[] {
  return batches.flatMap(({ batch, vendor, connector }) =>
    batch.records
      .filter((r) => r.metricKey === metricKey)
      .map((r) => ({
        subjectId: `${vendor}/${r.subject.kind}:${r.subject.externalId}`,
        day: r.day,
        value: r.value,
        sourceConnector: connector,
      })),
  );
}

describe("agentic adoption over recorded vendor fixtures", () => {
  const batches = [
    { batch: normalizeAnthropic(usageEnvelope), vendor: "anth", connector: "anthropic-console@1" },
    { batch: normalizeAnthropic(claudeCodeEnvelope), vendor: "anth", connector: "anthropic-console@1" },
    { batch: normalizeCopilot(copilotEnvelope), vendor: "copilot", connector: "copilot@1" },
    { batch: normalizeCursor(cursorEnvelope), vendor: "cursor", connector: "cursor@1" },
  ];
  const agentActiveRows = rowsFor(batches, "agent_active");
  const activeDayRows = rowsFor(batches, "active_day");

  // Identity resolution mirroring what W2-K reconciliation would produce:
  // alice spans THREE subjects (Anthropic OAuth acct, Anthropic claude_code
  // email actor, Cursor email); the api-key / service-account subjects stay
  // deliberately unlinked.
  const identityLinks = [
    { subjectId: "anth/person:acct:acct_01BBB", personId: "p-alice" },
    { subjectId: "anth/person:alice@example.com", personId: "p-alice" },
    { subjectId: "cursor/person:email:alice@example.com", personId: "p-alice" },
    { subjectId: "cursor/person:email:bob@example.com", personId: "p-bob" },
    { subjectId: "copilot/person:user:1001", personId: "p-carol" },
    { subjectId: "copilot/person:user:1002", personId: "p-dave" },
    { subjectId: "copilot/person:user:1003", personId: "p-eve" },
  ];

  // A Sunday after all fixture days — every touched week is complete.
  const result = computeAgenticAdoption({
    agentActiveRows,
    activeDayRows,
    identityLinks,
    windowTo: "2026-06-21",
  });

  it("verifies which vendors emit agent_active from their recorded payloads", () => {
    const vendors = new Set(agentActiveRows.map((r) => r.sourceConnector));
    // Claude Code days are inherently agentic; Copilot flags used_agent /
    // cloud agent; Cursor flags agentRequests > 0. (OpenAI emits none — it
    // has no fixture in this file because it has no agent signal to feed.)
    expect(vendors).toEqual(
      new Set(["anthropic-console@1", "copilot@1", "cursor@1"]),
    );
  });

  it("pins the person-day rate: alice's three subjects collapse to ONE 100%-agentic person-day", () => {
    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    // Resolved person-days: p-alice|2026-06-11 (agentic via claude_code AND
    // cursor), p-carol|2026-06-19 (used_agent), p-eve|2026-06-19 (cloud
    // agent), p-dave|2026-06-19 (active only). Bob is inactive in the Cursor
    // fixture (isActive false, 0 agent requests) → no person-day at all.
    expect(result.activeDays).toBe(4);
    expect(result.agenticDays).toBe(3);
    expect(result.ratePct).toBe(75);
  });

  it("excludes and discloses the unlinked api-key / service-account subjects", () => {
    if (result.kind !== "measured") throw new Error("expected measured");
    // apikey_01AAA (usage), svcacct_01CCC (usage), name:ci-runner-key
    // (claude_code api actor). apikey_01IDLE sums to zero tokens → the
    // normalizer emits no rows for it at all, so it is absence, not an
    // unresolved subject.
    expect(result.unresolvedSubjects).toBe(3);
  });

  it("attributes per-vendor coverage in person-days", () => {
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.coveragePerVendor).toEqual([
      { sourceConnector: "copilot@1", agenticDays: 2 },
      { sourceConnector: "anthropic-console@1", agenticDays: 1 },
      { sourceConnector: "cursor@1", agenticDays: 1 },
    ]);
  });
});
