import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { copilotConnector, copilotEntry } from "../src/connectors/copilot";
import {
  checkReportsAccess,
  fetchUsersDaily,
} from "../src/connectors/copilot/client";
import {
  getInstallationAccount,
  mintAppJwt,
  mintInstallationToken,
  parseAppCredential,
} from "../src/connectors/copilot/github-app";
import { normalizeCopilot } from "../src/connectors/copilot/normalize";
import { ENVELOPE_KINDS, type CopilotRaw } from "../src/connectors/copilot/types";
import { getConnector } from "../src/connectors/registry";
import type { RawPayloadEnvelope } from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import { credentialKindFor, RetryableConnectorError } from "../src/poller/run";
import { processPollMessage } from "../src/poller/process";

// W4-T's Copilot connector. Pins the pure normalize() semantics (rule 2) —
// person attribution keyed on user_id, CLI-only tokens/sessions, agentic
// metrics from documented fields, credits-honest spend (native ai_credits,
// never dollars), the standing sub_daily_unavailable +
// telemetry_only_users_in_totals gaps, and no fabricated sub-daily signals.
// Plus the GitHub App auth crypto (JWT + installation token) and the
// two-hop NDJSON report fetch.

const usersFix = JSON.parse(
  readFileSync("fixtures/connectors/copilot/users-1-day.json", "utf8"),
);
const phaseFix = JSON.parse(
  readFileSync("fixtures/connectors/copilot/users-1-day-with-phase.json", "utf8"),
);
const teamsFix = JSON.parse(
  readFileSync("fixtures/connectors/copilot/user-teams-1-day.json", "utf8"),
);
const creditFix = JSON.parse(
  readFileSync("fixtures/connectors/copilot/ai-credit-usage.json", "utf8"),
);

// Test RSA keypair generated at runtime (never committed — a checked-in
// private key trips GitHub push-protection and secret scanners). Exercises
// BOTH the PKCS#8 path and the GitHub-format PKCS#1 wrapper: pkcs1Pem is
// derived by unwrapping the PKCS#8 PrivateKeyInfo down to its RSAPrivateKey.
const APP_ID = "999001";
const INSTALLATION_ID = "55550001";

function derToPem(der: Uint8Array, label: string): string {
  let b = "";
  for (const x of der) b += String.fromCharCode(x);
  const b64 = btoa(b).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}
function readTlv(b: Uint8Array, o: number) {
  let len = b[o + 1];
  let p = o + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | b[p++];
  }
  return { start: p, end: p + len, next: p + len };
}
function pkcs1FromPkcs8(pkcs8: Uint8Array): Uint8Array {
  const outer = readTlv(pkcs8, 0);
  const version = readTlv(pkcs8, outer.start);
  const algId = readTlv(pkcs8, version.next);
  const octet = readTlv(pkcs8, algId.next);
  return pkcs8.slice(octet.start, octet.end);
}
async function generateTestKeys() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    pkcs8Pem: derToPem(pkcs8, "PRIVATE KEY"),
    pkcs1Pem: derToPem(pkcs1FromPkcs8(pkcs8), "RSA PRIVATE KEY"),
    publicKeyPem: derToPem(spki, "PUBLIC KEY"),
  };
}
const KEYS = await generateTestKeys();

const ndjson = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");
const DL_USERS = "https://copilot-reports.github.com/dl/users";
const DL_TEAMS = "https://copilot-reports.github.com/dl/teams";

const ALICE = "user:1001";
const BOB = "user:1002";
const CAROL = "user:1003";

const usersEnvelope: RawPayloadEnvelope<CopilotRaw> = {
  kind: ENVELOPE_KINDS.usersDaily,
  window: { start: "2026-06-19", end: "2026-06-19" },
  payload: { surface: "users_daily", day: "2026-06-19", records: usersFix.records },
};

function record(
  batch: ReturnType<typeof normalizeCopilot>,
  externalId: string,
  metricKey: string,
  dim = "",
  day = "2026-06-19",
) {
  return batch.records.find(
    (r) =>
      r.subject.externalId === externalId &&
      r.metricKey === metricKey &&
      r.day === day &&
      r.dim === dim,
  );
}

describe("normalize: users-1-day (person metrics + agentic + credits)", () => {
  const batch = normalizeCopilot(usersEnvelope);

  it("maps a fully-featured user to person-level Level-1 metrics", () => {
    expect(record(batch, ALICE, "active_day")?.value).toBe(1);
    expect(record(batch, ALICE, "prompts")?.value).toBe(60);
    expect(record(batch, ALICE, "suggestions_offered")?.value).toBe(200);
    expect(record(batch, ALICE, "suggestions_accepted")?.value).toBe(90);
    expect(record(batch, ALICE, "lines_suggested")?.value).toBe(800);
    expect(record(batch, ALICE, "lines_added")?.value).toBe(420);
    expect(record(batch, ALICE, "lines_removed")?.value).toBe(30);
    const r = record(batch, ALICE, "prompts");
    expect(r?.subject.kind).toBe("person");
    expect(r?.attribution).toBe("person");
  });

  it("emits CLI-only tokens + sessions (IDE tokens/sessions are a gap)", () => {
    expect(record(batch, ALICE, "tokens_input")?.value).toBe(12000);
    expect(record(batch, ALICE, "tokens_output")?.value).toBe(4800);
    expect(record(batch, ALICE, "sessions")?.value).toBe(4);
    // Bob has no CLI totals → no tokens/sessions fabricated.
    expect(record(batch, BOB, "tokens_input")).toBeUndefined();
    expect(record(batch, BOB, "sessions")).toBeUndefined();
  });

  it("emits native ai_credits only when the field is present (absence, not zero)", () => {
    expect(record(batch, ALICE, "ai_credits")?.value).toBe(37.5);
    expect(record(batch, CAROL, "ai_credits")?.value).toBe(4);
    // Bob's record has no ai_credits_used field → no row (earlier-days absence).
    expect(record(batch, BOB, "ai_credits")).toBeUndefined();
    // Credits are NOT dollars — never emitted as spend_cents.
    expect(batch.records.some((r) => r.metricKey === "spend_cents")).toBe(false);
    expect(record(batch, ALICE, "ai_credits")?.subject.kind).toBe("person");
  });

  it("derives agentic metrics from documented agent fields (§8.3)", () => {
    // agent_sessions mirrors CLI sessions (CLI is agent-mediated).
    expect(record(batch, ALICE, "agent_sessions")?.value).toBe(4);
    // agent_requests: CLI requests (25) + IDE agent-mode features (12 + 6).
    expect(record(batch, ALICE, "agent_requests")?.value).toBe(43);
    // agent_active: used_agent || coding_agent.
    expect(record(batch, ALICE, "agent_active")?.value).toBe(1);
    // Carol via the cloud-agent alias: active + CLI request count only.
    expect(record(batch, CAROL, "agent_active")?.value).toBe(1);
    expect(record(batch, CAROL, "agent_requests")?.value).toBe(9);
    expect(record(batch, CAROL, "agent_sessions")?.value).toBe(2);
    // Bob is not an agent user → no agentic rows.
    expect(record(batch, BOB, "agent_active")).toBeUndefined();
    expect(record(batch, BOB, "agent_requests")).toBeUndefined();
  });

  it("feature flags come from used_* booleans + feature breakdowns, never IDEs", () => {
    // ONE canonical dim per capability (used_* booleans + derived completion).
    for (const f of ["completion", "chat", "cli", "agent", "coding_agent", "code_review"]) {
      expect(record(batch, ALICE, "feature_used", `feature=${f}`)?.value, f).toBe(1);
    }
    // Granular totals_by_feature vendor strings are NOT re-emitted as
    // feature_used dims (they would double-count the coarse capability and
    // inflate breadth). IDEs are editors, not features.
    for (const f of ["code_completion", "chat_panel_agent_mode", "agent_edit", "vscode"]) {
      expect(record(batch, ALICE, "feature_used", `feature=${f}`), f).toBeUndefined();
    }
    // F1.5: ai_adoption_phase (alice carries { phase: "power" }) is a
    // COHORT, not a capability — never a feature_used dim, because the live
    // presets count every distinct dim into Adoption/Fluency breadth
    // (see the skip note in normalize.ts). Pinned: no phase dim, ever.
    expect(
      batch.records.some((r) => r.dim.includes("phase")),
    ).toBe(false);
  });

  it("model mix is request counts per model; per-model tokens is a gap", () => {
    expect(record(batch, ALICE, "model_requests", "model=gpt-5-copilot")?.value).toBe(45);
    expect(record(batch, ALICE, "model_requests", "model=claude-sonnet-5")?.value).toBe(15);
    expect(batch.records.some((r) => r.metricKey === "model_tokens")).toBe(false);
  });

  it("surfaces the daily-only + telemetry honesty gaps and no sub-daily signals", () => {
    expect(batch.signals).toHaveLength(0);
    expect(batch.gaps).toContainEqual(
      expect.objectContaining({ kind: "sub_daily_unavailable" }),
    );
    expect(batch.gaps).toContainEqual(
      expect.objectContaining({ kind: "telemetry_only_users_in_totals" }),
    );
  });

  it("is deterministic (same envelope → deep-equal batch)", () => {
    expect(normalizeCopilot(usersEnvelope)).toEqual(normalizeCopilot(usersEnvelope));
  });
});

describe("normalize: personal spend context (§6a.2)", () => {
  const batch = normalizeCopilot({
    kind: ENVELOPE_KINDS.personalSpend,
    window: { start: "2026-06-01", end: "2026-06-30" },
    payload: { surface: "personal_spend", username: "Dave", usage: creditFix },
  });

  it("sums net credits per day per person (credits, not dollars)", () => {
    // 2026-06-19 has two model rows: netQuantity 18 + 9 = 27.
    expect(record(batch, "login:dave", "ai_credits", "", "2026-06-19")?.value).toBe(27);
    expect(record(batch, "login:dave", "ai_credits", "", "2026-06-25")?.value).toBe(5);
    expect(batch.records.every((r) => r.metricKey === "ai_credits")).toBe(true);
    expect(batch.records[0].attribution).toBe("person");
  });
});

describe("normalize: ai_adoption_phase is a harvest SKIP (F1.5 negative pin)", () => {
  // The fixture carries every ai_adoption_phase shape (string label,
  // punctuation-heavy label, number-only, absent). None of them may reach the
  // normalized output: feature_used dims feed the presets' distinct_dims
  // breadth (Adoption tool_coverage / Fluency breadth), so a cohort dim would
  // inflate scores merely because GitHub classified a user — a phase-0 "low
  // adoption" cohort would RAISE the Adoption score. Score-inert homes need a
  // catalog ADR; until then the field stays unread (see normalize.ts).
  const batch = normalizeCopilot({
    kind: ENVELOPE_KINDS.usersDaily,
    window: { start: "2026-06-20", end: "2026-06-20" },
    payload: { surface: "users_daily", day: "2026-06-20", records: phaseFix.records },
  });

  it("emits NO phase dim for any user, whatever the phase shape", () => {
    expect(batch.records.some((r) => r.dim.includes("phase"))).toBe(false);
  });

  it("phase-bearing users still get exactly their honest capability dims", () => {
    // dave/erin/grace/frank all have used_chat + generation counts, and no
    // other capability signals — the full dim set is chat + completion only,
    // regardless of their ai_adoption_phase values.
    const dims = new Set(
      batch.records.filter((r) => r.metricKey === "feature_used").map((r) => r.dim),
    );
    expect(dims).toEqual(new Set(["feature=chat", "feature=completion"]));
  });

  it("ignoring the phase field does not disturb the rest of the row", () => {
    // dave (phase "Agent First") normalizes identically on every other key.
    const dave = batch.records.filter((r) => r.subject.externalId === "user:2001");
    expect(dave.map((r) => `${r.metricKey}|${r.dim}`).sort()).toEqual([
      "active_day|",
      "feature_used|feature=chat",
      "feature_used|feature=completion",
      "prompts|",
      "suggestions_accepted|",
      "suggestions_offered|",
    ]);
    expect(dave.find((r) => r.metricKey === "prompts")?.value).toBe(42);
  });
});

describe("GitHub App auth (JWT + installation token)", () => {
  const appCred = {
    appId: APP_ID,
    installationId: INSTALLATION_ID,
    privateKeyPem: KEYS.pkcs8Pem,
  };
  const now = new Date("2026-06-20T12:00:00Z");

  function pemToDer(pem: string): Uint8Array {
    const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const bin = atob(b64);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    return der;
  }
  function b64urlToBytes(s: string): Uint8Array {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function verify(jwt: string): Promise<boolean> {
    const [h, p, s] = jwt.split(".");
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(KEYS.publicKeyPem) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(s) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`),
    );
  }

  it("mints a valid RS256 JWT from a PKCS#8 key", async () => {
    const jwt = await mintAppJwt(appCred, now);
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    expect(payload.iss).toBe(APP_ID);
    expect(payload.exp - payload.iat).toBe(9 * 60);
    expect(await verify(jwt)).toBe(true);
  });

  it("also imports a GitHub-format PKCS#1 key (the wrapper path)", async () => {
    const jwt = await mintAppJwt({ ...appCred, privateKeyPem: KEYS.pkcs1Pem }, now);
    expect(await verify(jwt)).toBe(true);
  });

  it("exchanges the JWT for an installation token", async () => {
    const calls: Array<{ url: string; auth: string | null; method?: string }> = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });
      return new Response(
        JSON.stringify({ token: "ghs_installation", expires_at: "2026-06-20T13:00:00Z" }),
        { status: 200 },
      );
    }) as typeof fetch;
    const tok = await mintInstallationToken(appCred, now, fetchFn);
    expect(tok.token).toBe("ghs_installation");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain(`/app/installations/${INSTALLATION_ID}/access_tokens`);
    expect(calls[0].auth).toMatch(/^Bearer eyJ/); // a JWT, not the App id
  });

  it("resolves the installation account (org login) for the callback", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ account: { login: "acme-inc", type: "Organization" } }),
        { status: 200 },
      )) as typeof fetch;
    const account = await getInstallationAccount(appCred, now, fetchFn);
    expect(account).toEqual({ login: "acme-inc", type: "Organization" });
  });

  it("rejects a malformed credential blob permanently", () => {
    expect(() => parseAppCredential("not json")).toThrow(/valid JSON/);
    expect(() => parseAppCredential(JSON.stringify({ appId: "1" }))).toThrow(/installationId/);
  });

  it("credentialKindFor routes github_app to the private-key row (frozen seam)", () => {
    expect(credentialKindFor("github_app")).toBe("github_app_private_key");
  });
});

describe("client: two-hop report fetch + error policy", () => {
  const scope = { kind: "org", slug: "acme" } as const;

  it("lists then downloads NDJSON (auth on the listing, none on the signed link)", async () => {
    const calls: Array<{ url: string; auth: string | null; apiVersion: string | null }> = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const headers = new Headers(init?.headers);
      calls.push({
        url: u,
        auth: headers.get("authorization"),
        apiVersion: headers.get("x-github-api-version"),
      });
      if (u.includes("/copilot/metrics/reports/users-1-day")) {
        return new Response(JSON.stringify({ download_links: [DL_USERS], report_day: "2026-06-19" }), { status: 200 });
      }
      if (u === DL_USERS) {
        // A deliberately-broken trailing line must be skipped, not throw.
        return new Response(ndjson(usersFix.records) + "\n{ broken", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const records = await fetchUsersDaily("ghs_x", scope, "2026-06-19", fetchFn);
    expect(records).toHaveLength(3);
    const listing = calls.find((c) => c.url.includes("users-1-day"))!;
    expect(listing.auth).toBe("Bearer ghs_x");
    expect(listing.apiVersion).toBe("2026-03-10");
    const download = calls.find((c) => c.url === DL_USERS)!;
    expect(download.auth).toBeNull(); // signed link needs no auth
  });

  it("429 on the listing is retryable with Retry-After", async () => {
    const limited = (async () =>
      new Response("slow", { status: 429, headers: { "retry-after": "30" } })) as typeof fetch;
    await expect(
      fetchUsersDaily("k", scope, "2026-06-19", limited),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 30,
    );
  });

  it("a 403 with Retry-After is a (secondary) rate limit → retryable", async () => {
    const secondary = (async () =>
      new Response("limited", { status: 403, headers: { "retry-after": "25" } })) as typeof fetch;
    await expect(
      fetchUsersDaily("k", scope, "2026-06-19", secondary),
    ).rejects.toSatisfy(
      (e) => e instanceof RetryableConnectorError && e.delaySeconds === 25,
    );
  });

  it("a bare 403 (policy-off / no permission) is PERMANENT, even with remaining=0", async () => {
    // A permission 403 that coincides with an exhausted quota must NOT be
    // retried forever — it is surfaced as a permanent error, never "no usage".
    const forbidden = (async () =>
      new Response('{"message":"policy off"}', {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      })) as typeof fetch;
    await expect(
      fetchUsersDaily("k", scope, "2026-06-19", forbidden),
    ).rejects.toSatisfy((e) => !(e instanceof RetryableConnectorError) && /403/.test(e.message));
    // checkReportsAccess still reports it as a definitive auth failure.
    expect((await checkReportsAccess("k", scope, "2026-06-19", forbidden)).ok).toBe(false);
  });
});

describe("capabilities + registration", () => {
  it("matches connector-facts §1", () => {
    const caps = copilotConnector.capabilities;
    expect(caps.subDaily).toBe("none");
    expect(caps.attributionCeiling).toBe("person");
    expect(caps.restatementWindowDays).toBe(3);
    expect(caps.maxBackfillDays).toBe(365);
  });

  it("src/connectors registers github_copilot", async () => {
    await import("../src/connectors");
    expect(getConnector("github_copilot")?.sourceConnector).toBe("github-copilot@1");
  }, 30000); // cold import of the full connector graph is slow on Windows
});

describe("end-to-end org mode (stubbed GitHub App + reports)", () => {
  function testKek(): string {
    const bytes = new Uint8Array(32).fill(7);
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
    orgId = (await createFixtureOrg(db, "copilot-e2e", "team")).id;
  });

  it("polls a Copilot org into person records, subjects, team meta, and gaps", async () => {
    vi.stubGlobal("fetch", (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/access_tokens")) {
        return new Response(JSON.stringify({ token: "ghs_e2e", expires_at: "2026-06-20T13:00:00Z" }), { status: 200 });
      }
      if (u.includes("/copilot/metrics/reports/users-1-day")) {
        return new Response(JSON.stringify({ download_links: [DL_USERS], report_day: "2026-06-19" }), { status: 200 });
      }
      if (u.includes("/copilot/metrics/reports/user-teams-1-day")) {
        return new Response(JSON.stringify({ download_links: [DL_TEAMS], report_day: "2026-06-19" }), { status: 200 });
      }
      if (u === DL_USERS) return new Response(ndjson(usersFix.records), { status: 200 });
      if (u === DL_TEAMS) return new Response(ndjson(teamsFix.records), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    try {
      const scoped = forOrg(db, orgId);
      const conn = await scoped.connections.create({
        vendor: "github_copilot",
        displayName: "GitHub Copilot (acme)",
        authKind: "github_app",
        config: { mode: "org", org: "acme", appId: APP_ID, installationId: INSTALLATION_ID },
      });
      await scoped.connections.storeCredential(
        conn.id,
        "github_app_private_key",
        JSON.stringify({
          appId: APP_ID,
          installationId: INSTALLATION_ID,
          privateKeyPem: KEYS.pkcs8Pem,
        }),
        ENV,
      );
      await processPollMessage(
        db,
        {
          kind: "connector-poll",
          orgId,
          connectionId: conn.id,
          window: { start: "2026-06-19", end: "2026-06-19" },
        },
        {
          credentialEnv: ENV,
          send: async () => {},
          resolveConnector: (v) => (v === "github_copilot" ? copilotEntry : undefined),
        },
      );

      const run = await scoped.connectorRuns.latest(conn.id);
      expect(run?.status).toBe("success");
      expect(run?.gaps).toContainEqual(
        expect.objectContaining({ kind: "sub_daily_unavailable" }),
      );

      const subjects = await scoped.subjects.list({ connectionId: conn.id });
      const alice = subjects.find((s) => s.externalId === ALICE);
      expect(alice?.kind).toBe("person");
      expect(alice?.displayName).toBe("alice"); // discover joined the login
      expect((alice?.meta as { teams?: string[] }).teams).toEqual(["backend", "platform"]);
      // Carol is suppressed from user-teams (<5-seat team) but still ingested
      // from the usage report — surfaced, never dropped.
      const carol = subjects.find((s) => s.externalId === CAROL);
      expect(carol?.kind).toBe("person");

      const prompts = (
        await scoped.metrics.records({ metricKey: "prompts", from: "2026-06-19", to: "2026-06-19" })
      ).filter((r) => r.connectionId === conn.id);
      expect(prompts.find((r) => r.subjectId === alice?.id)?.value).toBe(60);
      expect(prompts[0].sourceConnector).toBe("github-copilot@1");

      const credits = (
        await scoped.metrics.records({ metricKey: "ai_credits", from: "2026-06-19", to: "2026-06-19" })
      ).filter((r) => r.connectionId === conn.id);
      expect(credits.find((r) => r.subjectId === alice?.id)?.value).toBe(37.5);

      const agentReq = (
        await scoped.metrics.records({ metricKey: "agent_requests", from: "2026-06-19", to: "2026-06-19" })
      ).filter((r) => r.connectionId === conn.id);
      expect(agentReq.find((r) => r.subjectId === alice?.id)?.value).toBe(43);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
