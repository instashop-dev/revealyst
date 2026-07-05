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
// (fixtures/vendor-payloads/anthropic_console/ — W1-S replaces them with
// scrubbed live recordings, rule 2); poll() against a stubbed vendor.

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(`fixtures/vendor-payloads/anthropic_console/${name}`, "utf8"),
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
    expect(record(batch, id, "tokens_input", "2026-06-11")?.value).toBe(102000);
    expect(record(batch, id, "spend_cents_estimated", "2026-06-11")?.value).toBe(662);
    expect(
      record(batch, id, "model_tokens", "2026-06-11", "model=claude-opus-4")?.value,
    ).toBe(540000);
    expect(record(batch, id, "sessions", "2026-06-11")?.attribution).toBe("key_project");
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
    const err = await checkAdminKey("k", fetchFn).then(
      () => null,
      (e) => e,
    );
    // checkAdminKey wraps into {ok:false}; hit the raw path via usage:
    await expect(
      fetchUsageMessages("k", { start: "2026-06-11", end: "2026-06-11" }, fetchFn),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 17,
    );
    expect(err).toBeNull(); // validateAuth reports, never throws
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
