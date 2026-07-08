import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cursorConnector, cursorEntry } from "../src/connectors/cursor";
import { checkAdminKey, fetchDailyUsage } from "../src/connectors/cursor/client";
import { normalizeCursor } from "../src/connectors/cursor/normalize";
import { ENVELOPE_KINDS, type CursorRaw } from "../src/connectors/cursor/types";
import { getConnector } from "../src/connectors/registry";
import type { RawPayloadEnvelope } from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import { processPollMessage } from "../src/poller/process";
import { RetryableConnectorError } from "../src/poller/run";

// W2-J's first Team connector: Cursor. Pins the pure normalize() semantics
// (rule 2) — person attribution keyed on email, service accounts surfaced
// not billed, tokens/spend/model from events only, prompts/acceptance/lines
// from daily-usage, event-grain sub-daily signals.

const fixture = (name: string) =>
  JSON.parse(readFileSync(`fixtures/connectors/cursor/${name}`, "utf8"));
const membersRes = fixture("members.json");
const dailyRes = fixture("daily-usage-data.json");
const eventsRes = fixture("filtered-usage-events.json");

const dailyEnvelope: RawPayloadEnvelope<CursorRaw> = {
  kind: ENVELOPE_KINDS.dailyUsage,
  window: { start: "2026-06-11", end: "2026-06-11" },
  payload: { surface: "daily_usage", rows: dailyRes.data },
};
const eventsEnvelope: RawPayloadEnvelope<CursorRaw> = {
  kind: ENVELOPE_KINDS.usageEvents,
  window: { start: "2026-06-11", end: "2026-06-11" },
  payload: { surface: "usage_events", events: eventsRes.usageEvents },
};

const ALICE = "email:alice@example.com";
const BOB = "email:bob@example.com";
const SVC = "svc:svc-ci-1";

function record(
  batch: ReturnType<typeof normalizeCursor>,
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

describe("normalize: daily-usage-data (prompts/acceptance/lines, no tokens)", () => {
  const batch = normalizeCursor(dailyEnvelope);

  it("active member → person-level prompts/acceptance/tabs/lines", () => {
    expect(record(batch, ALICE, "prompts", "2026-06-11")?.value).toBe(20); // 10+5+3+2
    expect(record(batch, ALICE, "edit_actions_accepted", "2026-06-11")?.value).toBe(8);
    expect(record(batch, ALICE, "edit_actions_rejected", "2026-06-11")?.value).toBe(2);
    expect(record(batch, ALICE, "suggestions_offered", "2026-06-11")?.value).toBe(40);
    expect(record(batch, ALICE, "suggestions_accepted", "2026-06-11")?.value).toBe(25);
    expect(record(batch, ALICE, "lines_added", "2026-06-11")?.value).toBe(120);
    expect(record(batch, ALICE, "lines_removed", "2026-06-11")?.value).toBe(30);
    expect(record(batch, ALICE, "active_day", "2026-06-11")?.value).toBe(1);
    const r = record(batch, ALICE, "prompts", "2026-06-11");
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
  });

  it("feature flags fire only for touched surfaces", () => {
    for (const feature of ["composer", "chat", "agent", "cmdk", "bugbot"]) {
      expect(
        record(batch, ALICE, "feature_used", "2026-06-11", `feature=${feature}`)?.value,
      ).toBe(1);
    }
  });

  it("never emits model mix from daily-usage (mostUsedModel is coarse)", () => {
    expect(batch.records.some((r) => r.metricKey === "model_requests")).toBe(false);
    expect(batch.records.some((r) => r.metricKey === "model_tokens")).toBe(false);
  });

  it("present-but-inactive member is not fabricated as active (pagination honesty)", () => {
    expect(batch.records.filter((r) => r.subject.externalId === BOB)).toHaveLength(0);
  });

  it("never emits a sessions metric (Cursor has no session concept)", () => {
    expect(batch.records.some((r) => r.metricKey === "sessions")).toBe(false);
    expect(batch.signals).toHaveLength(0); // sub-daily is events-only
  });
});

describe("normalize: filtered-usage-events (tokens/spend/model + signals)", () => {
  const batch = normalizeCursor(eventsEnvelope);

  it("sums per-event tokens and authoritative chargedCents spend per person/day", () => {
    expect(record(batch, ALICE, "tokens_input", "2026-06-11")?.value).toBe(3800); // 1000+800+2000
    expect(record(batch, ALICE, "tokens_output", "2026-06-11")?.value).toBe(1900); // 500+400+1000
    expect(record(batch, ALICE, "tokens_cache_read", "2026-06-11")?.value).toBe(300); // 200+100
    expect(record(batch, ALICE, "tokens_cache_write", "2026-06-11")?.value).toBe(150); // 50+100
    expect(record(batch, ALICE, "spend_cents", "2026-06-11")?.value).toBeCloseTo(41.5, 4);
  });

  it("model mix comes from the exact per-event model", () => {
    expect(
      record(batch, ALICE, "model_requests", "2026-06-11", "model=claude-sonnet-5")?.value,
    ).toBe(2);
    expect(record(batch, ALICE, "model_requests", "2026-06-11", "model=gpt-5")?.value).toBe(1);
    expect(
      record(batch, ALICE, "model_tokens", "2026-06-11", "model=claude-sonnet-5")?.value,
    ).toBe(2700); // (1000+500)+(800+400)
    expect(record(batch, ALICE, "model_tokens", "2026-06-11", "model=gpt-5")?.value).toBe(3000);
  });

  it("emits event-grain histogram + minute-window peak-concurrency proxy", () => {
    const alice = batch.signals.find(
      (s) => s.subject.externalId === ALICE && s.day === "2026-06-11",
    );
    expect(alice?.hours?.[9]).toBe(2); // two events in hour 9
    expect(alice?.hours?.[14]).toBe(1);
    expect(alice?.hours?.reduce((a, b) => a + b, 0)).toBe(3);
    expect(alice?.peakConcurrency).toBe(2); // two events share one UTC minute
    expect(alice?.sourceGranularity).toBe("event");
  });

  it("service-account usage stays at key level with the gap surfaced (invariant b)", () => {
    const r = record(batch, SVC, "tokens_input", "2026-06-11");
    expect(r?.value).toBe(5000);
    expect(r?.subject.kind).toBe("service_account");
    expect(r?.attribution).toBe("key_project");
    expect(record(batch, SVC, "spend_cents", "2026-06-11")?.value).toBe(30);
    expect(batch.gaps).toContainEqual(
      expect.objectContaining({ kind: "service_accounts_unresolved" }),
    );
    // Never rolled into a person: Alice's spend excludes the SA's 30c.
    expect(record(batch, ALICE, "spend_cents", "2026-06-11")?.value).toBeCloseTo(41.5, 4);
  });
});

describe("determinism + registration", () => {
  it("same envelope in, deep-equal batch out", () => {
    expect(normalizeCursor(eventsEnvelope)).toEqual(normalizeCursor(eventsEnvelope));
  });

  it("src/connectors registers cursor", async () => {
    await import("../src/connectors");
    expect(getConnector("cursor")?.sourceConnector).toBe("cursor@1");
  });

  it("capabilities match connector-facts §2", () => {
    const caps = cursorConnector.capabilities;
    expect(caps.subDaily).toBe("event");
    expect(caps.attributionCeiling).toBe("person");
    expect(caps.maxBackfillDays).toBeNull();
    expect(caps.restatementWindowDays).toBeGreaterThanOrEqual(2);
  });
});

describe("client", () => {
  it("basic-auth, epoch-ms window, paginates and concatenates rows", async () => {
    const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      // Short page (< pageSize) → the client stops after one call.
      return new Response(JSON.stringify(dailyRes), { status: 200 });
    }) as typeof fetch;

    const rows = await fetchDailyUsage(
      "crsr_test",
      { start: "2026-06-11", end: "2026-06-11" },
      fetchFn,
    );
    expect(rows).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/teams/daily-usage-data");
    expect(calls[0].auth).toBe(`Basic ${btoa("crsr_test:")}`);
    // 2026-06-11 00:00Z = 1781136000000; exclusive end = next midnight.
    expect((calls[0].body as { startDate: number }).startDate).toBe(1781136000000);
    expect((calls[0].body as { endDate: number }).endDate).toBe(1781222400000);
    expect((calls[0].body as { page: number }).page).toBe(1);
  });

  it("429 honors Retry-After; 4xx is permanent", async () => {
    const limited = (async () =>
      new Response("slow", { status: 429, headers: { "retry-after": "42" } })) as typeof fetch;
    await expect(
      fetchDailyUsage("k", { start: "2026-06-11", end: "2026-06-11" }, limited),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 42,
    );
    const forbidden = (async () =>
      new Response('{"error":"forbidden"}', { status: 403 })) as typeof fetch;
    await expect(
      fetchDailyUsage("k", { start: "2026-06-11", end: "2026-06-11" }, forbidden),
    ).rejects.toThrow(/403/);
  });

  it("a fetch that never resolves times out instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = (() => new Promise<Response>(() => {})) as typeof fetch;
      // checkAdminKey exercises the GET call site.
      const validate = checkAdminKey("k", neverResolves);
      await vi.runAllTimersAsync();
      await expect(validate).resolves.toEqual({
        ok: false,
        reason: expect.stringMatching(/timed out/),
      });

      // fetchDailyUsage exercises the POST call site.
      const raw = fetchDailyUsage(
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
});

describe("end-to-end team mode (stubbed vendor)", () => {
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
    orgId = (await createFixtureOrg(db, "cursor-e2e", "team")).id;
  });

  it("polls a team into attribution-tagged records + the SA gap", async () => {
    vi.stubGlobal("fetch", (async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      const body = u.pathname.endsWith("/teams/members")
        ? membersRes
        : u.pathname.endsWith("/teams/daily-usage-data")
          ? dailyRes
          : u.pathname.endsWith("/teams/filtered-usage-events")
            ? eventsRes
            : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch);
    try {
      const scoped = forOrg(db, orgId);
      const conn = await scoped.connections.create({
        vendor: "cursor",
        displayName: "Cursor (team)",
        authKind: "api_key",
        config: {},
      });
      await scoped.connections.storeCredential(conn.id, "api_key", "crsr_e2e", ENV);
      await processPollMessage(
        db,
        {
          kind: "connector-poll",
          orgId,
          connectionId: conn.id,
          window: { start: "2026-06-11", end: "2026-06-11" },
        },
        {
          credentialEnv: ENV,
          send: async () => {},
          resolveConnector: (v) => (v === "cursor" ? cursorEntry : undefined),
        },
      );

      const run = await scoped.connectorRuns.latest(conn.id);
      expect(run?.status).toBe("success");
      expect(run?.gaps).toContainEqual(
        expect.objectContaining({ kind: "service_accounts_unresolved" }),
      );

      const subjects = await scoped.subjects.list({ connectionId: conn.id });
      const alice = subjects.find((s) => s.externalId === ALICE);
      expect(alice?.email).toBe("alice@example.com"); // discover joined the roster
      expect(alice?.kind).toBe("person");
      const svc = subjects.find((s) => s.externalId === SVC);
      expect(svc?.kind).toBe("service_account"); // born from normalize, not discover

      const prompts = await scoped.metrics.records({
        metricKey: "prompts",
        from: "2026-06-11",
        to: "2026-06-11",
      });
      const mine = prompts.filter((r) => r.connectionId === conn.id);
      expect(mine).toHaveLength(1); // only active Alice
      expect(mine[0].value).toBe(20);
      expect(mine[0].sourceConnector).toBe("cursor@1");

      const spend = await scoped.metrics.records({
        metricKey: "spend_cents",
        from: "2026-06-11",
        to: "2026-06-11",
      });
      // Alice (41.5) and the service account (30) — never merged.
      expect(
        spend
          .filter((r) => r.connectionId === conn.id)
          .map((r) => Number(r.value))
          .sort((a, b) => a - b),
      ).toEqual([30, 41.5]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
