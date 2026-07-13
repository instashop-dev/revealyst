import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  anthropicConsoleConnector,
  anthropicConsoleEntry,
} from "../src/connectors/anthropic";
import {
  checkAdminKey,
  fetchUsageMessages,
} from "../src/connectors/anthropic/client";
import { normalizeAnthropic, ORG_SUBJECT } from "../src/connectors/anthropic/normalize";
import { ENVELOPE_KINDS, type AnthropicRaw } from "../src/connectors/anthropic/types";
import type { RawPayloadEnvelope } from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import { processPollMessage } from "../src/poller/process";
import { RetryableConnectorError } from "../src/poller/run";

// PR 2 of the W1-D chain: the Anthropic Console connector. normalize() is
// exercised purely against the provisional recorded-shape fixtures
// (fixtures/connectors/anthropic_console/ — W1-S lands scrubbed live
// recordings separately under fixtures/vendor-payloads/, rule 2); poll()
// against a stubbed vendor.

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(`fixtures/connectors/anthropic_console/${name}`, "utf8"),
  );
const usagePage = fixture("usage-messages-1h.json");
const costPage = fixture("cost-report-1d.json");
const claudeCodePage = fixture("claude-code-daily.json");

const usageEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ENVELOPE_KINDS.usage,
  window: { start: "2026-06-11", end: "2026-06-12" },
  payload: { surface: "usage_messages", page: usagePage },
};
const costEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ENVELOPE_KINDS.cost,
  window: { start: "2026-06-11", end: "2026-06-12" },
  payload: { surface: "cost_report", page: costPage },
};
const claudeCodeEnvelope: RawPayloadEnvelope<AnthropicRaw> = {
  kind: ENVELOPE_KINDS.claudeCode,
  window: { start: "2026-06-11", end: "2026-06-11" },
  payload: { surface: "claude_code", page: claudeCodePage },
};

function record(
  batch: ReturnType<typeof normalizeAnthropic>,
  externalId: string,
  metricKey: string,
  day: string,
  dim = "",
) {
  return batch.records.find(
    (r) =>
      r.subject.externalId === externalId &&
      r.metricKey === metricKey &&
      r.day === day &&
      r.dim === dim,
  );
}

describe("normalize: usage_report/messages (1h buckets)", () => {
  const batch = normalizeAnthropic(usageEnvelope);

  it("sums hourly buckets per api key per day at key_project attribution", () => {
    expect(record(batch, "apikey_01AAA", "tokens_input", "2026-06-11")?.value).toBe(19000);
    expect(record(batch, "apikey_01AAA", "tokens_output", "2026-06-11")?.value).toBe(12000);
    expect(record(batch, "apikey_01AAA", "tokens_cache_read", "2026-06-11")?.value).toBe(57000);
    expect(record(batch, "apikey_01AAA", "tokens_cache_write", "2026-06-11")?.value).toBe(4500);
    expect(
      record(batch, "apikey_01AAA", "model_tokens", "2026-06-11", "model=claude-opus-4")?.value,
    ).toBe(92500);
    expect(record(batch, "apikey_01AAA", "active_day", "2026-06-11")?.value).toBe(1);
    expect(record(batch, "apikey_01AAA", "tokens_input", "2026-06-11")?.attribution).toBe("key_project");
  });

  it("maps OAuth account usage to a person subject (person attribution)", () => {
    const r = record(batch, "acct:acct_01BBB", "tokens_input", "2026-06-11");
    expect(r?.value).toBe(5000);
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
  });

  it("maps service accounts to key_project, never person", () => {
    const r = record(batch, "svcacct_01CCC", "tokens_input", "2026-06-12");
    expect(r?.subject.kind).toBe("service_account");
    expect(r?.attribution).toBe("key_project");
  });

  it("emits 1h activity histograms and never fakes concurrency", () => {
    const aaa = batch.signals.find(
      (s) => s.subject.externalId === "apikey_01AAA" && s.day === "2026-06-11",
    );
    expect(aaa?.hours?.[9]).toBe(1);
    expect(aaa?.hours?.[14]).toBe(1);
    expect(aaa?.hours?.reduce((a, b) => a + b, 0)).toBe(2);
    expect(aaa?.peakConcurrency).toBeNull();
    expect(aaa?.sourceGranularity).toBe("1h");
  });

  it("drops idle (all-zero) results instead of recording zeros", () => {
    expect(
      batch.records.some((r) => r.subject.externalId === "apikey_01IDLE"),
    ).toBe(false);
    expect(
      batch.signals.some((s) => s.subject.externalId === "apikey_01IDLE"),
    ).toBe(false);
  });

  it("W5-E: server_tool_use.web_search_requests → feature=web_search only when >0", () => {
    // apikey_01AAA had web_search_requests: 2 on 2026-06-11 (feature fires),
    // and 0 on the 14:00 bucket → still exactly one flag (max mode).
    expect(
      record(batch, "apikey_01AAA", "feature_used", "2026-06-11", "feature=web_search")?.value,
    ).toBe(1);
    // svcacct_01CCC had web_search_requests: 1 on 2026-06-12.
    expect(
      record(batch, "svcacct_01CCC", "feature_used", "2026-06-12", "feature=web_search")?.value,
    ).toBe(1);
    // acct_01BBB never used web search (0) → no flag, never fabricated.
    expect(
      record(batch, "acct:acct_01BBB", "feature_used", "2026-06-11", "feature=web_search"),
    ).toBeUndefined();
  });
});

describe("normalize: cost_report (authoritative org spend)", () => {
  const batch = normalizeAnthropic(costEnvelope);

  it("sums decimal-string cents per day on the org subject at account attribution", () => {
    const d1 = record(batch, ORG_SUBJECT.externalId, "spend_cents", "2026-06-11");
    expect(d1?.value).toBeCloseTo(1313.46, 6);
    expect(d1?.subject.kind).toBe("account");
    expect(d1?.attribution).toBe("account");
    expect(
      record(batch, ORG_SUBJECT.externalId, "spend_cents", "2026-06-12")?.value,
    ).toBeCloseTo(410, 6);
  });

  it("never invents per-person spend from an org-level report", () => {
    expect(batch.records.every((r) => r.subject.kind === "account")).toBe(true);
  });
});

describe("W5-E: cost_type split → org-level feature flags (never per-category spend)", () => {
  const featuresPage = fixture("cost-report-features.json");
  const batch = normalizeAnthropic({
    kind: ENVELOPE_KINDS.cost,
    window: { start: "2026-06-11", end: "2026-06-11" },
    payload: { surface: "cost_report", page: featuresPage },
  });

  it("emits feature=web_search + feature=code_execution on the org subject", () => {
    expect(
      record(batch, ORG_SUBJECT.externalId, "feature_used", "2026-06-11", "feature=web_search")
        ?.value,
    ).toBe(1);
    expect(
      record(batch, ORG_SUBJECT.externalId, "feature_used", "2026-06-11", "feature=code_execution")
        ?.value,
    ).toBe(1);
    // Feature flags stay account-attributed on the org subject.
    expect(
      record(batch, ORG_SUBJECT.externalId, "feature_used", "2026-06-11", "feature=web_search")
        ?.subject.kind,
    ).toBe("account");
  });

  it("the authoritative spend total is unchanged — no per-category spend dims", () => {
    // Single dimensionless spend_cents row summing ALL cost types
    // (1000 + 50 + 25 + 5 = 1080), never split into per-type spend dims.
    const spend = batch.records.filter((r) => r.metricKey === "spend_cents");
    expect(spend).toHaveLength(1);
    expect(spend[0].dim).toBe("");
    expect(spend[0].value).toBeCloseTo(1080, 6);
  });

  it("STAYS DROPPED: `tokens` and undocumented `session_usage` cost types are not features", () => {
    const featureDims = batch.records
      .filter((r) => r.metricKey === "feature_used")
      .map((r) => r.dim);
    expect(featureDims).not.toContain("feature=tokens");
    expect(featureDims).not.toContain("feature=session_usage");
    // description is freeform prose — never a dim.
    expect(featureDims.every((d) => !d.includes("usage") || d === "")).toBe(true);
  });
});

describe("W5-E stays-dropped pins: claude_code terminal_type + model_breakdown.tokens (§1.2 (4))", () => {
  // claude-code-daily.json carries terminal_type (vscode / iTerm.app) AND
  // model_breakdown[].tokens on every actor. Neither may reach normalized
  // output — terminal_type is an editor identity (breadth inflation, the
  // Copilot-IDE class), and model_breakdown tokens double-count the usage
  // report (the single canonical token source). "Fixing" either into emission
  // is a regression (invariant b).
  const batch = normalizeAnthropic(claudeCodeEnvelope);

  it("emits NO terminal dim for any actor", () => {
    expect(batch.records.some((r) => r.dim.includes("terminal"))).toBe(false);
    // The only feature dim on this surface is the coarse claude_code capability.
    const featureDims = new Set(
      batch.records.filter((r) => r.metricKey === "feature_used").map((r) => r.dim),
    );
    expect(featureDims).toEqual(new Set(["feature=claude_code"]));
  });

  it("emits NO token metric from model_breakdown (usage report is canonical)", () => {
    const tokenKeys = new Set([
      "tokens_input",
      "tokens_output",
      "tokens_cache_read",
      "tokens_cache_write",
      "model_tokens",
      "model_requests",
    ]);
    expect(batch.records.some((r) => tokenKeys.has(r.metricKey))).toBe(false);
    // ...yet the estimated-spend derived from model_breakdown still lands.
    expect(record(batch, "alice@example.com", "spend_cents_estimated", "2026-06-11")?.value).toBe(95);
  });
});

describe("normalize: claude_code analytics", () => {
  const batch = normalizeAnthropic(claudeCodeEnvelope);

  it("maps api actors to name-keyed api_key subjects at key_project", () => {
    const id = "name:ci-runner-key";
    expect(record(batch, id, "sessions", "2026-06-11")?.value).toBe(4);
    expect(record(batch, id, "commits", "2026-06-11")?.value).toBe(3);
    expect(record(batch, id, "pull_requests", "2026-06-11")?.value).toBe(1);
    expect(record(batch, id, "lines_added", "2026-06-11")?.value).toBe(310);
    expect(record(batch, id, "lines_removed", "2026-06-11")?.value).toBe(120);
    expect(record(batch, id, "edit_actions_accepted", "2026-06-11")?.value).toBe(35);
    expect(record(batch, id, "edit_actions_rejected", "2026-06-11")?.value).toBe(6);
    expect(record(batch, id, "spend_cents_estimated", "2026-06-11")?.value).toBe(662);
    expect(record(batch, id, "sessions", "2026-06-11")?.attribution).toBe("key_project");
  });

  it("never emits token metrics — the usage report is the canonical token source (no cross-surface double count)", () => {
    const tokenKeys = new Set([
      "tokens_input",
      "tokens_output",
      "tokens_cache_read",
      "tokens_cache_write",
      "model_tokens",
    ]);
    expect(batch.records.some((r) => tokenKeys.has(r.metricKey))).toBe(false);
  });

  it("maps user actors to lowercased-email person subjects with the email kept", () => {
    const r = record(batch, "alice@example.com", "sessions", "2026-06-11");
    expect(r?.value).toBe(2);
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
    expect(
      (r?.subject as { email?: string } | undefined)?.email,
    ).toBe("alice@example.com");
  });

  it("estimated spend lands on spend_cents_estimated, never spend_cents", () => {
    expect(record(batch, "alice@example.com", "spend_cents_estimated", "2026-06-11")?.value).toBe(95);
    expect(batch.records.some((r) => r.metricKey === "spend_cents")).toBe(false);
  });

  it("always surfaces the #27780 OAuth-actors gap (invariant b)", () => {
    expect(batch.gaps).toContainEqual(
      expect.objectContaining({ kind: "oauth_actors_missing" }),
    );
  });
});

describe("normalize is pure and deterministic", () => {
  it("same envelope in, deep-equal batch out", () => {
    expect(normalizeAnthropic(usageEnvelope)).toEqual(normalizeAnthropic(usageEnvelope));
    expect(normalizeAnthropic(claudeCodeEnvelope)).toEqual(
      normalizeAnthropic(claudeCodeEnvelope),
    );
  });
});

describe("client error policy", () => {
  const page = (over?: object) =>
    new Response(JSON.stringify({ data: [], has_more: false, next_page: null, ...over }), {
      status: 200,
    });

  it("follows pagination cursors", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return page({ has_more: true, next_page: "cursor-2" });
      }
      return page();
    }) as typeof fetch;
    const pages = await fetchUsageMessages(
      "sk-ant-admin01-test",
      { start: "2026-06-11", end: "2026-06-12" },
      fetchFn,
    );
    expect(pages).toHaveLength(2);
    expect(calls[1]).toContain("page=cursor-2");
    expect(calls[0]).toContain("bucket_width=1h");
    expect(calls[0]).toContain("group_by%5B%5D=api_key_id");
  });

  it("429 → RetryableConnectorError honoring Retry-After", async () => {
    const fetchFn = (async () =>
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "17" },
      })) as typeof fetch;
    // Hit the raw path via usage:
    await expect(
      fetchUsageMessages("k", { start: "2026-06-11", end: "2026-06-11" }, fetchFn),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 17,
    );
  });

  it("a 429 during checkAdminKey rethrows as RetryableConnectorError, not {ok:false}", async () => {
    // Transient failures are inconclusive: credential-save (api-impl
    // putConnectionCredential) keeps the key on a throw and only rejects it
    // on a definitive {ok:false} — a vendor blip must never do the latter.
    const limited = (async () =>
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "9" },
      })) as typeof fetch;
    await expect(checkAdminKey("k", limited)).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 9,
    );
  });

  it("a definitive 401 during checkAdminKey still resolves {ok:false} (unchanged)", async () => {
    const unauthorized = (async () =>
      new Response('{"error":"invalid x-api-key"}', { status: 401 })) as typeof fetch;
    await expect(checkAdminKey("k", unauthorized)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("5xx → retryable; 401 → permanent", async () => {
    const fivehundred = (async () =>
      new Response("boom", { status: 503 })) as typeof fetch;
    await expect(
      fetchUsageMessages("k", { start: "2026-06-11", end: "2026-06-11" }, fivehundred),
    ).rejects.toBeInstanceOf(RetryableConnectorError);

    const unauthorized = (async () =>
      new Response('{"error":"invalid x-api-key"}', { status: 401 })) as typeof fetch;
    await expect(
      fetchUsageMessages("k", { start: "2026-06-11", end: "2026-06-11" }, unauthorized),
    ).rejects.toThrow(/401/);
    await expect(
      fetchUsageMessages("k", { start: "2026-06-11", end: "2026-06-11" }, unauthorized),
    ).rejects.not.toBeInstanceOf(RetryableConnectorError);
  });

  it("a fetch that never resolves times out instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = (() => new Promise<Response>(() => {})) as typeof fetch;
      // A timeout is INCONCLUSIVE, not a rejection: checkAdminKey rethrows
      // the retryable so credential-save keeps the key instead of erroring
      // the connection on a vendor blip.
      const validate = checkAdminKey("k", neverResolves);
      const validateAssertion = expect(validate).rejects.toSatisfy(
        (e) => e instanceof RetryableConnectorError && /timed out/.test(e.message),
      );
      await vi.runAllTimersAsync();
      await validateAssertion;

      const raw = fetchUsageMessages(
        "k",
        { start: "2026-06-11", end: "2026-06-11" },
        neverResolves,
      );
      const assertion = expect(raw).rejects.toSatisfy(
        (e) => e instanceof RetryableConnectorError && /timed out/.test(e.message),
      );
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a response whose body never resolves also times out (not just a stalled connect)", async () => {
    vi.useFakeTimers();
    try {
      const slowBody = (async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers(),
          json: () => new Promise(() => {}),
          text: () => new Promise(() => {}),
        }) as unknown as Response) as typeof fetch;
      const validate = checkAdminKey("k", slowBody);
      const assertion = expect(validate).rejects.toSatisfy(
        (e) => e instanceof RetryableConnectorError && /timed out/.test(e.message),
      );
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("end-to-end through the framework (stubbed vendor)", () => {
  function testKek(): string {
    const bytes = new Uint8Array(32).fill(11);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `v1:${btoa(binary)}`;
  }
  const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };
  let db: Db;
  let orgId: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "anthropic-e2e", "personal")).id;
  });

  it("polls the stubbed Console org into attribution-tagged metric_records", async () => {
    const emptyPage = { data: [], has_more: false, next_page: null };
    vi.stubGlobal("fetch", (async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      const body = u.pathname.endsWith("/organizations/users")
        ? { data: [{ id: "acct_01BBB", email: "alice@example.com", name: "Alice" }], has_more: false, next_page: null }
        : u.pathname.endsWith("/usage_report/messages")
          ? usagePage
          : u.pathname.endsWith("/cost_report")
            ? costPage
            : u.pathname.endsWith("/usage_report/claude_code")
              ? u.searchParams.get("starting_at") === "2026-06-11"
                ? claudeCodePage
                : emptyPage
              : emptyPage;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch);
    try {
      const scoped = forOrg(db, orgId);
      const conn = await scoped.connections.create({
        vendor: "anthropic_console",
        displayName: "Anthropic Console",
        authKind: "admin_key",
      });
      await scoped.connections.storeCredential(
        conn.id,
        "api_key",
        "sk-ant-admin01-e2e",
        ENV,
      );
      await processPollMessage(
        db,
        {
          kind: "connector-poll",
          orgId,
          connectionId: conn.id,
          window: { start: "2026-06-11", end: "2026-06-12" },
        },
        {
          credentialEnv: ENV,
          send: async () => {},
          resolveConnector: (v) =>
            v === "anthropic_console" ? anthropicConsoleEntry : undefined,
        },
      );

      const run = await scoped.connectorRuns.latest(conn.id);
      expect(run?.status).toBe("success");
      expect(run?.gaps).toContainEqual(
        expect.objectContaining({ kind: "oauth_actors_missing" }),
      );

      const subjects = await scoped.subjects.list({ connectionId: conn.id });
      const alice = subjects.find((s) => s.externalId === "acct:acct_01BBB");
      expect(alice?.email).toBe("alice@example.com"); // discover() joined it
      const ccAlice = subjects.find((s) => s.externalId === "alice@example.com");
      expect(ccAlice?.email).toBe("alice@example.com"); // normalize kept it

      const spend = await scoped.metrics.records({
        metricKey: "spend_cents",
        from: "2026-06-11",
        to: "2026-06-12",
      });
      expect(spend.filter((r) => r.connectionId === conn.id)).toHaveLength(2);
      expect(
        spend.every(
          (r) => r.sourceConnector === "anthropic-console@1" && r.attribution === "account",
        ),
      ).toBe(true);

      const sessions = await scoped.metrics.records({
        metricKey: "sessions",
        from: "2026-06-11",
        to: "2026-06-11",
      });
      expect(sessions.map((r) => r.value).sort()).toEqual([2, 4]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("capabilities match connector-facts §3", () => {
    const caps = anthropicConsoleConnector.capabilities;
    expect(caps.subDaily).toBe("1h");
    expect(caps.attributionCeiling).toBe("person");
    expect(caps.maxBackfillDays).toBe(90);
    expect(caps.restatementWindowDays).toBeGreaterThanOrEqual(4); // Enterprise D+4-style lags
  });
});
