import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openAiConnector, openAiEntry } from "../src/connectors/openai";
import { checkAdminKey, fetchCompletionsUsage } from "../src/connectors/openai/client";
import { normalizeOpenAi, ORG_SUBJECT } from "../src/connectors/openai/normalize";
import { ENVELOPE_KINDS, type OpenAiRaw } from "../src/connectors/openai/types";
import { getConnector } from "../src/connectors/registry";
import type {
  ConnectorContext,
  RawPayloadEnvelope,
} from "../src/contracts/connector";
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

describe("W5-E re-scope (§1.2 (3)): web_search_calls + code_interpreter_sessions", () => {
  const webSearchBatch = normalizeOpenAi({
    kind: ENVELOPE_KINDS.webSearch,
    window: { start: "2026-06-11", end: "2026-06-11" },
    payload: { surface: "usage_web_search", page: fixture("usage-web-search-1d.json") },
  });
  const codeInterpreterBatch = normalizeOpenAi({
    kind: ENVELOPE_KINDS.codeInterpreter,
    window: { start: "2026-06-11", end: "2026-06-11" },
    payload: {
      surface: "usage_code_interpreter",
      page: fixture("usage-code-interpreter-1d.json"),
    },
  });

  it("web_search_calls → feature=web_search, person for user-owned keys", () => {
    const r = record(webSearchBatch, "user:user-alpha", "feature_used", "2026-06-11", "feature=web_search");
    expect(r?.value).toBe(1);
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
  });

  it("web_search_calls: service-key usage stays key-level + surfaces the shared-key gap", () => {
    const r = record(webSearchBatch, "key_svc", "feature_used", "2026-06-11", "feature=web_search");
    expect(r?.subject.kind).toBe("api_key");
    expect(r?.attribution).toBe("key_project");
    expect(webSearchBatch.gaps).toContainEqual(
      expect.objectContaining({ kind: "shared_key_not_person_level" }),
    );
    // The zero-call row (user-idle) never fabricates a flag.
    expect(
      webSearchBatch.records.some((r) => r.subject.externalId === "user:user-idle"),
    ).toBe(false);
  });

  it("code_interpreter_sessions → org-level feature=code_interpreter, never per person", () => {
    const r = record(codeInterpreterBatch, ORG_SUBJECT.externalId, "feature_used", "2026-06-11", "feature=code_interpreter");
    expect(r?.value).toBe(1);
    expect(r?.subject.kind).toBe("account");
    expect(r?.attribution).toBe("account");
    // No sessions metric fabricated (num_sessions is project-only, no person),
    // and the zero-session project adds nothing.
    expect(codeInterpreterBatch.records.some((r) => r.metricKey === "sessions")).toBe(false);
    expect(codeInterpreterBatch.records).toHaveLength(1);
  });

  it("both new surfaces are pure/deterministic", () => {
    expect(
      normalizeOpenAi({
        kind: ENVELOPE_KINDS.webSearch,
        window: null,
        payload: { surface: "usage_web_search", page: fixture("usage-web-search-1d.json") },
      }),
    ).toEqual(
      normalizeOpenAi({
        kind: ENVELOPE_KINDS.webSearch,
        window: null,
        payload: { surface: "usage_web_search", page: fixture("usage-web-search-1d.json") },
      }),
    );
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

describe("discover: org-admin coverage (W2-J)", () => {
  const orgList = (data: unknown[]) =>
    new Response(
      JSON.stringify({ object: "list", data, has_more: false, last_id: null }),
      { status: 200 },
    );
  // Routes the three discovery endpoints; records every path hit.
  function stubFetch(paths: string[]): typeof fetch {
    return (async (url: RequestInfo | URL) => {
      const p = new URL(String(url)).pathname;
      paths.push(p);
      if (p.endsWith("/organization/users")) {
        return orgList([
          { object: "organization.user", id: "user-alpha", name: "Alpha", email: "alpha@example.com", role: "owner" },
        ]);
      }
      if (p.endsWith("/organization/projects")) {
        return orgList([
          { object: "organization.project", id: "proj_alpha", name: "Alpha", status: "active" },
        ]);
      }
      if (p.endsWith("/proj_alpha/api_keys")) {
        return orgList([
          { object: "organization.project.api_key", id: "key_01", name: "Alice key", owner: { type: "user", user: { id: "user-alpha" } } },
          { object: "organization.project.api_key", id: "key_svc", name: "CI bot", owner: { type: "service_account", service_account: { id: "sa_1" } } },
        ]);
      }
      return orgList([]);
    }) as typeof fetch;
  }
  const ctx = (mode: string | undefined, fetchImpl: typeof fetch): ConnectorContext => ({
    connection: { id: "c1", orgId: "o1", vendor: "openai", config: { mode, fetchImpl } },
    credential: "sk-admin-x",
    now: () => new Date("2026-06-11T00:00:00Z"),
    log: () => {},
  });

  it("org_admin enumerates projects + keys with the key→owner map", async () => {
    const paths: string[] = [];
    const subjects = await openAiConnector.discover(ctx("org_admin", stubFetch(paths)));

    expect(subjects.find((s) => s.externalId === "user:user-alpha")?.kind).toBe("person");
    expect(subjects.find((s) => s.externalId === "project:proj_alpha")?.kind).toBe("project");

    // Key externalId is the raw id — the same value normalize keys api_key
    // subjects by (usage api_key_id) — so coverage merges with usage rows.
    const userKey = subjects.find((s) => s.externalId === "key_01");
    expect(userKey?.kind).toBe("api_key");
    expect(userKey?.meta).toMatchObject({ ownerType: "user", ownerUserId: "user-alpha" });
    const svcKey = subjects.find((s) => s.externalId === "key_svc");
    expect(svcKey?.meta).toMatchObject({ ownerType: "service_account", ownerUserId: null });

    expect(paths).toContain("/v1/organization/projects");
    expect(paths).toContain("/v1/organization/projects/proj_alpha/api_keys");
  });

  it("personal mode is unchanged: only the user, no project/key calls", async () => {
    for (const mode of [undefined, "personal_key"]) {
      const paths: string[] = [];
      const subjects = await openAiConnector.discover(ctx(mode, stubFetch(paths)));
      expect(subjects).toHaveLength(1);
      expect(subjects[0].externalId).toBe("user:user-alpha");
      expect(paths).toEqual(["/v1/organization/users"]);
      expect(paths).not.toContain("/v1/organization/projects");
    }
  });

  it("normalize is mode-agnostic (same envelope → same batch)", () => {
    // The org-admin/personal split lives entirely in auth + discover; the
    // pure normalize() never sees a mode, so the two modes ride identical
    // data rules (invariant b comes from the data, not the mode).
    expect(normalizeOpenAi(usageEnvelope)).toEqual(normalizeOpenAi(usageEnvelope));
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

      const raw = fetchCompletionsUsage(
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

  // Regression: the "OpenAI sync failure" (2026-07-11, ADR 0026). Restricted
  // admin keys gate api.management.read and api.usage.read separately; the
  // old users-only probe validated usage-blind keys, then every poll 403'd
  // permanently with a raw vendor JSON as the connection error.
  // Verbatim shape of the live rejection (note: `error` is a bare string,
  // not the usual {error:{message}} envelope).
  const usageScope403 = JSON.stringify({
    error:
      "You have insufficient permissions for this operation. Missing scopes: api.usage.read.",
  });

  it("checkAdminKey probes usage scope too — a usage-blind key is rejected at save", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith("/organization/users")) {
        return new Response(
          JSON.stringify({ object: "list", data: [], has_more: false }),
          { status: 200 },
        );
      }
      return new Response(usageScope403, { status: 403 });
    }) as typeof fetch;
    const result = await checkAdminKey("sk-admin-usage-blind", fetchFn);
    expect(calls).toEqual(["/v1/organization/users", "/v1/organization/costs"]);
    // The reason is what the UI tooltip / 400 shows — it must name the
    // missing scope AND say what key kind to create, not just echo vendor JSON.
    expect(result).not.toHaveProperty("ok", true);
    const reason = result.ok ? "" : result.reason;
    expect(reason).toMatch(/api\.usage\.read/);
    expect(reason).toMatch(/org admin key/);
  });

  it("a 429 during validation is inconclusive (rethrown retryable), never a rejection", async () => {
    const limited = (async () =>
      new Response("slow", { status: 429, headers: { "retry-after": "7" } })) as typeof fetch;
    await expect(checkAdminKey("sk-admin-test", limited)).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 7,
    );
  });

  it("401/403 errors carry the wrong-key-kind hint (project keys, missing scopes)", async () => {
    const forbidden = (async () =>
      new Response(usageScope403, { status: 403 })) as typeof fetch;
    await expect(
      fetchCompletionsUsage("sk-proj-x", { start: "2026-06-11", end: "2026-06-11" }, forbidden),
    ).rejects.toThrow(/org admin key with the api\.management\.read/);
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
