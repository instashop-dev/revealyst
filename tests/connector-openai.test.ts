import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openAiConnector, openAiEntry } from "../src/connectors/openai";
import { fetchCompletionsUsage } from "../src/connectors/openai/client";
import { normalizeOpenAi, ORG_SUBJECT } from "../src/connectors/openai/normalize";
import { ENVELOPE_KINDS, type OpenAiRaw } from "../src/connectors/openai/types";
import { getConnector } from "../src/connectors/registry";
import type { RawPayloadEnvelope } from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import { processPollMessage } from "../src/poller/process";
import { RetryableConnectorError } from "../src/poller/run";

// PR 3 of the W1-D chain: OpenAI, personal-key mode. One connector, two
// credential modes — this suite pins the shared normalize() semantics both
// modes ride on (W2-J adds org-admin onboarding, not new data rules).

const fixture = (name: string) =>
  JSON.parse(readFileSync(`fixtures/connectors/openai/${name}`, "utf8"));
const usagePage = fixture("usage-completions-1h.json");
const costsPage = fixture("costs-1d.json");

const usageEnvelope: RawPayloadEnvelope<OpenAiRaw> = {
  kind: ENVELOPE_KINDS.completions,
  window: { start: "2026-06-11", end: "2026-06-12" },
  payload: { surface: "usage_completions", page: usagePage },
};
const costsEnvelope: RawPayloadEnvelope<OpenAiRaw> = {
  kind: ENVELOPE_KINDS.costs,
  window: { start: "2026-06-11", end: "2026-06-12" },
  payload: { surface: "costs", page: costsPage },
};

function record(
  batch: ReturnType<typeof normalizeOpenAi>,
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

describe("normalize: usage/completions (1h buckets)", () => {
  const batch = normalizeOpenAi(usageEnvelope);

  it("key-owner usage is person-level and summed across hours (incl. batch)", () => {
    const id = "user:user-alpha";
    expect(record(batch, id, "prompts", "2026-06-11")?.value).toBe(152);
    expect(record(batch, id, "tokens_input", "2026-06-11")?.value).toBe(70000);
    expect(record(batch, id, "tokens_output", "2026-06-11")?.value).toBe(28000);
    expect(record(batch, id, "tokens_cache_read", "2026-06-11")?.value).toBe(5000);
    expect(record(batch, id, "model_requests", "2026-06-11", "model=gpt-5")?.value).toBe(152);
    expect(record(batch, id, "model_tokens", "2026-06-11", "model=gpt-5")?.value).toBe(98000);
    expect(record(batch, id, "active_day", "2026-06-11")?.value).toBe(1);
    const r = record(batch, id, "prompts", "2026-06-11");
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
  });

  it("interactive (batch=false) usage flags feature_used; batch alone doesn't", () => {
    expect(
      record(batch, "user:user-alpha", "feature_used", "2026-06-11", "feature=interactive_api")
        ?.value,
    ).toBe(1);
  });

  it("service-key usage stays at key level with the gap surfaced (invariant b)", () => {
    const r = record(batch, "key_svc", "prompts", "2026-06-11");
    expect(r?.value).toBe(12);
    expect(r?.subject.kind).toBe("api_key");
    expect(r?.attribution).toBe("key_project");
    expect(batch.gaps).toContainEqual(
      expect.objectContaining({ kind: "shared_key_not_person_level" }),
    );
  });

  it("emits 1h histograms; concurrency stays null (not derivable)", () => {
    const alpha = batch.signals.find(
      (s) => s.subject.externalId === "user:user-alpha" && s.day === "2026-06-11",
    );
    expect(alpha?.hours?.[9]).toBe(1);
    expect(alpha?.hours?.[14]).toBe(1);
    expect(alpha?.hours?.reduce((a, b) => a + b, 0)).toBe(2);
    expect(alpha?.peakConcurrency).toBeNull();
    expect(alpha?.sourceGranularity).toBe("1h");
  });

  it("drops idle zero rows and never emits a sessions metric (no such concept)", () => {
    expect(
      batch.records.filter((r) => r.day === "2026-06-12"),
    ).toHaveLength(0); // the all-zero Jun-12 row vanished
    expect(batch.records.some((r) => r.metricKey === "sessions")).toBe(false);
  });
});

describe("normalize: costs (authoritative, org-level only)", () => {
  const batch = normalizeOpenAi(costsEnvelope);

  it("converts float USD to cents per day on the org subject", () => {
    const d1 = record(batch, ORG_SUBJECT.externalId, "spend_cents", "2026-06-11");
    expect(d1?.value).toBeCloseTo(1284.56, 4);
    expect(d1?.attribution).toBe("account");
    expect(
      record(batch, ORG_SUBJECT.externalId, "spend_cents", "2026-06-12")?.value,
    ).toBeCloseTo(420, 4);
  });

  it("never derives per-user spend (no user dimension exists)", () => {
    expect(batch.records.every((r) => r.subject.kind === "account")).toBe(true);
    expect(batch.records.every((r) => r.metricKey === "spend_cents")).toBe(true);
  });
});

describe("determinism + registration", () => {
  it("same envelope in, deep-equal batch out", () => {
    expect(normalizeOpenAi(usageEnvelope)).toEqual(normalizeOpenAi(usageEnvelope));
  });

  it("src/connectors registers both W1-D vendors", async () => {
    await import("../src/connectors");
    expect(getConnector("openai")?.sourceConnector).toBe("openai@1");
    expect(getConnector("anthropic_console")?.sourceConnector).toBe(
      "anthropic-console@1",
    );
  });
});

describe("client", () => {
  it("passes unix-second bounds, explicit group_by, and follows cursors", async () => {
    const calls: string[] = [];
    const page = (over?: object) =>
      new Response(
        JSON.stringify({ object: "page", data: [], has_more: false, next_page: null, ...over }),
        { status: 200 },
      );
    const fetchFn = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return calls.length === 1 ? page({ has_more: true, next_page: "c2" }) : page();
    }) as typeof fetch;
    const pages = await fetchCompletionsUsage(
      "sk-admin-test",
      { start: "2026-06-11", end: "2026-06-12" },
      fetchFn,
    );
    expect(pages).toHaveLength(2);
    expect(calls[0]).toContain("start_time=1781136000");
    expect(calls[0]).toContain("end_time=1781308800");
    expect(calls[0]).toContain("bucket_width=1h");
    expect(calls[0]).toContain("group_by=user_id");
    expect(calls[1]).toContain("page=c2");
  });

  it("429 honors Retry-After; 401 is permanent", async () => {
    const limited = (async () =>
      new Response("slow", { status: 429, headers: { "retry-after": "31" } })) as typeof fetch;
    await expect(
      fetchCompletionsUsage("k", { start: "2026-06-11", end: "2026-06-11" }, limited),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 31,
    );
    const unauthorized = (async () =>
      new Response('{"error":{"message":"invalid api key"}}', { status: 401 })) as typeof fetch;
    await expect(
      fetchCompletionsUsage("k", { start: "2026-06-11", end: "2026-06-11" }, unauthorized),
    ).rejects.toThrow(/401/);
  });
});

describe("end-to-end personal-key mode (stubbed vendor)", () => {
  function testKek(): string {
    const bytes = new Uint8Array(32).fill(13);
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
    orgId = (await createFixtureOrg(db, "openai-e2e", "personal")).id;
  });

  it("polls a personal org (org of one) into attribution-tagged records", async () => {
    vi.stubGlobal("fetch", (async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      const body = u.pathname.endsWith("/organization/users")
        ? {
            object: "list",
            data: [
              {
                object: "organization.user",
                id: "user-alpha",
                name: "Alpha",
                email: "alpha@example.com",
                role: "owner",
              },
            ],
            has_more: false,
            last_id: null,
          }
        : u.pathname.endsWith("/usage/completions")
          ? usagePage
          : u.pathname.endsWith("/organization/costs")
            ? costsPage
            : { object: "page", data: [], has_more: false, next_page: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch);
    try {
      const scoped = forOrg(db, orgId);
      const conn = await scoped.connections.create({
        vendor: "openai",
        displayName: "OpenAI (personal key)",
        authKind: "admin_key",
        config: { mode: "personal_key" },
      });
      await scoped.connections.storeCredential(conn.id, "api_key", "sk-admin-e2e", ENV);
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
          resolveConnector: (v) => (v === "openai" ? openAiEntry : undefined),
        },
      );

      const run = await scoped.connectorRuns.latest(conn.id);
      expect(run?.status).toBe("success");
      expect(run?.gaps).toContainEqual(
        expect.objectContaining({ kind: "shared_key_not_person_level" }),
      );

      const subjects = await scoped.subjects.list({ connectionId: conn.id });
      const alpha = subjects.find((s) => s.externalId === "user:user-alpha");
      expect(alpha?.email).toBe("alpha@example.com"); // discover joined usage user_id
      expect(alpha?.kind).toBe("person");

      const prompts = await scoped.metrics.records({
        metricKey: "prompts",
        from: "2026-06-11",
        to: "2026-06-12",
      });
      const mine = prompts.filter((r) => r.connectionId === conn.id);
      expect(mine.map((r) => r.value).sort((a, b) => a - b)).toEqual([12, 152]);
      expect(mine.every((r) => r.sourceConnector === "openai@1")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("capabilities match connector-facts §4", () => {
    const caps = openAiConnector.capabilities;
    expect(caps.subDaily).toBe("1h");
    expect(caps.attributionCeiling).toBe("person");
    expect(caps.maxBackfillDays).toBeNull(); // undocumented → framework default
    expect(caps.restatementWindowDays).toBeGreaterThanOrEqual(2); // costs lag ~24h
  });
});
