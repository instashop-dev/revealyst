import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  exchangeInstallationCode,
  type FetchFn,
  userControlsInstallation,
  userIsOrgAdmin,
} from "../src/connectors/copilot/github-app";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { connectGithubCopilotInstall } from "../src/lib/api-impl";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  readCopilotAppConfig,
  signConnectState,
  verifyConnectState,
} from "../src/lib/github-app-config";

// Security regression suite for the Copilot GitHub-App connect flow. The core
// property under test is the confused-deputy fix (fix/github-app-install-
// ownership): the callback must PROVE the connecting user controls the
// `installation_id` — an enumerable, attacker-controllable URL param — before
// binding it, because getInstallationAccount authenticates as Revealyst's own
// App and would otherwise resolve ANY installation. For an ORG installation,
// "controls" means ACTIVE ADMIN of the resolved org — NOT mere access, which
// `GET /user/installations` grants to ordinary org members. The org-bound CSRF
// state alone is necessary but insufficient (it binds the org, not the install).

// A throwaway RSA keypair for the App JWT path (getInstallationAccount). Never
// committed — a checked-in private key trips secret scanners.
function derToPem(der: Uint8Array, label: string): string {
  let b = "";
  for (const x of der) b += String.fromCharCode(x);
  const b64 = btoa(b).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}
async function generateKeyPem(): Promise<string> {
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
  return derToPem(pkcs8, "PRIVATE KEY");
}
const PRIVATE_KEY_PEM = await generateKeyPem();

const VICTIM_INSTALLATION = "55550001"; // the id an attacker would enumerate
const OWN_INSTALLATION = "77770002"; // one the caller genuinely administers

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

const APP = {
  appId: "999001",
  privateKeyPem: PRIVATE_KEY_PEM,
  clientId: "Iv23liTESTCLIENT",
  clientSecret: "test-client-secret",
};

/** Routes the GitHub calls the connect flow makes. For an org install the
 * decisive call is `GET /user/memberships/orgs/{login}` (orgRole); for a
 * non-org install it is `GET /user/installations` (userInstallations). */
function makeFetch(cfg: {
  oauth?: "ok" | "error-body" | "http-error";
  /** Membership the OAuth user has in the installation's org: an active
   * "admin" or "member", or null → GitHub returns 404 (not a member). */
  orgRole?: "admin" | "member" | null;
  /** For the org-membership call to 500 (fail-closed test). */
  membershipStatus?: number;
  accountLogin?: string;
  accountType?: string;
  /** For the NON-org fallback path (accountType !== "Organization"). */
  userInstallations?: string[];
}): { fetch: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u === "https://github.com/login/oauth/access_token") {
      if (cfg.oauth === "http-error") return new Response("nope", { status: 500 });
      if (cfg.oauth === "error-body") {
        return new Response(JSON.stringify({ error: "bad_verification_code" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ access_token: "ghu_user_token" }), {
        status: 200,
      });
    }
    if (u.includes("/user/memberships/orgs/")) {
      if (cfg.membershipStatus) return new Response("err", { status: cfg.membershipStatus });
      if (!cfg.orgRole) return new Response("{}", { status: 404 }); // not a member
      return new Response(
        JSON.stringify({ role: cfg.orgRole, state: "active" }),
        { status: 200 },
      );
    }
    if (u.startsWith("https://api.github.com/user/installations")) {
      const ids = cfg.userInstallations ?? [];
      return new Response(
        JSON.stringify({ total_count: ids.length, installations: ids.map((id) => ({ id: Number(id) })) }),
        { status: 200 },
      );
    }
    if (/\/app\/installations\/[^/]+$/.test(u)) {
      return new Response(
        JSON.stringify({
          account: {
            login: cfg.accountLogin ?? "acme-inc",
            type: cfg.accountType ?? "Organization",
          },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as FetchFn;
  return { fetch: fetchFn, calls };
}

describe("connectGithubCopilotInstall — installation-ownership (confused-deputy)", () => {
  let db: Db;
  let orgId: string;
  // A real user row — audit_log.actor_user_id has an FK to user(id). The
  // confused-deputy actor is a genuinely authenticated caller (an org member),
  // so a real id is the faithful fixture.
  const ACTOR = "copilot-connect-actor";

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    await db.insert(schema.user).values({
      id: ACTOR,
      name: "Actor",
      email: "actor@example.com",
    });
  });

  beforeEach(async () => {
    // Fresh org per test so connection/audit assertions don't bleed across cases.
    orgId = (await createFixtureOrg(db, `copilot-connect-${crypto.randomUUID()}`, "team")).id;
  });

  it("(a) REJECTS an org MEMBER who is not an admin — the refined exploit path", async () => {
    const scope = forOrg(db, orgId);
    // The caller is a genuine member of the victim org (so /user/installations
    // would list the org-wide install) but NOT an admin. Must still be refused.
    const { fetch } = makeFetch({ orgRole: "member", accountLogin: "victim-org" });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: VICTIM_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(await scope.connections.list()).toHaveLength(0);
    const audit = await scope.auditLog.list();
    expect(audit[0].action).toBe("connection.install_rejected");
    expect(audit[0].metadata).toMatchObject({
      vendor: "github_copilot",
      installationId: VICTIM_INSTALLATION,
      reason: "not_org_admin",
    });
  });

  it("(a') REJECTS a caller who is not a member of the installation's org at all", async () => {
    const scope = forOrg(db, orgId);
    const { fetch } = makeFetch({ orgRole: null, accountLogin: "victim-org" }); // 404

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: VICTIM_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(await scope.connections.list()).toHaveLength(0);
    expect((await scope.auditLog.list())[0].metadata).toMatchObject({
      reason: "not_org_admin",
    });
  });

  it("(b) BINDS when the caller is an ACTIVE ADMIN of the installation's org", async () => {
    const scope = forOrg(db, orgId);
    const { fetch } = makeFetch({ orgRole: "admin", accountLogin: "acme-inc" });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: true });
    const conns = await scope.connections.list();
    expect(conns).toHaveLength(1);
    expect(conns[0].vendor).toBe("github_copilot");
    expect((conns[0].config as { installationId?: string }).installationId).toBe(
      OWN_INSTALLATION,
    );
    expect(conns[0].displayName).toBe("GitHub Copilot (acme-inc)");
    // The App credential was stored (decryptable envelope) carrying the bound
    // installation id — the material poll() will authenticate with.
    const cred = await scope.connections.withCredential(
      conns[0].id,
      "github_app_private_key",
      ENV,
      async (plaintext) => JSON.parse(plaintext) as { installationId: string },
    );
    expect(cred.installationId).toBe(OWN_INSTALLATION);
    const audit = await scope.auditLog.list();
    expect(audit.some((a) => a.action === "connection.create")).toBe(true);
    expect(audit.some((a) => a.action === "connection.install_rejected")).toBe(false);
  });

  it("(b') reuses a healthy existing connection on a re-install WITHOUT a fresh code", async () => {
    const scope = forOrg(db, orgId);
    const { fetch } = makeFetch({ orgRole: "admin", accountLogin: "acme-inc" });
    // First bind (admin + code).
    await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );
    // Reconfigure re-install: GitHub may send installation_id + state but no
    // fresh code. Must reuse the already-owned connection, not reject.
    const { fetch: noCallFetch, calls } = makeFetch({ orgRole: "admin" });
    const again = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: null, actorUserId: ACTOR },
      { fetchFn: noCallFetch },
    );
    expect(again).toEqual({ ok: true, reused: true });
    expect(await scope.connections.list()).toHaveLength(1); // no duplicate
    expect(calls).toHaveLength(0); // reuse short-circuits before any GitHub call
  });

  it("(orphan) re-binds a credential-less orphan (create-then-store crash) instead of reporting it connected", async () => {
    const scope = forOrg(db, orgId);
    // Simulate the non-atomic-create aftermath: a connection row for this
    // installation with NO stored credential (can't poll).
    const orphan = await scope.connections.create({
      vendor: "github_copilot",
      displayName: "GitHub Copilot (acme-inc)",
      authKind: "github_app",
      config: { mode: "org", org: "acme-inc", appId: APP.appId, installationId: OWN_INSTALLATION },
    });
    const { fetch } = makeFetch({ orgRole: "admin", accountLogin: "acme-inc" });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: true }); // full re-bind, NOT reused
    const conns = await scope.connections.list();
    expect(conns).toHaveLength(1); // orphan replaced, not duplicated
    expect(conns[0].id).not.toBe(orphan.id); // it's the fresh, credentialed one
    const cred = await scope.connections.withCredential(
      conns[0].id,
      "github_app_private_key",
      ENV,
      async () => true,
    );
    expect(cred).toBe(true);
  });

  it("(c) REJECTS a missing OAuth code on a first bind", async () => {
    const scope = forOrg(db, orgId);
    const { fetch, calls } = makeFetch({ orgRole: "admin" });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: null, actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(await scope.connections.list()).toHaveLength(0);
    expect(calls).toHaveLength(0); // never touched GitHub
    expect((await scope.auditLog.list())[0].metadata).toMatchObject({
      reason: "no_oauth_code",
    });
  });

  it("(c') REJECTS a code that fails the OAuth exchange", async () => {
    const scope = forOrg(db, orgId);
    const { fetch } = makeFetch({ orgRole: "admin", oauth: "error-body" });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: "stale_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );

    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(await scope.connections.list()).toHaveLength(0);
    expect((await scope.auditLog.list())[0].metadata).toMatchObject({
      reason: "oauth_exchange_failed",
    });
  });

  it("fails CLOSED when the admin-membership check itself errors (never binds)", async () => {
    const scope = forOrg(db, orgId);
    const { fetch } = makeFetch({ orgRole: "admin", membershipStatus: 500 });

    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: VICTIM_INSTALLATION, code: "c", actorUserId: ACTOR },
      { fetchFn: fetch },
    );
    expect(result).toEqual({ ok: false, reason: "ownership" });
    expect(await scope.connections.list()).toHaveLength(0);
    expect((await scope.auditLog.list())[0].metadata).toMatchObject({
      reason: "ownership_check_failed",
    });
  });

  it("(non-org) a personal install binds when the user can access it", async () => {
    const scope = forOrg(db, orgId);
    // account.type "User" → fall back to installation accessibility (owner-only
    // for a personal account).
    const { fetch } = makeFetch({
      accountType: "User",
      accountLogin: "dave",
      userInstallations: [OWN_INSTALLATION],
    });
    const result = await connectGithubCopilotInstall(
      scope,
      ENV,
      APP,
      { installationId: OWN_INSTALLATION, code: "gho_code", actorUserId: ACTOR },
      { fetchFn: fetch },
    );
    expect(result).toEqual({ ok: true });
    expect(await scope.connections.list()).toHaveLength(1);
  });
});

describe("exchangeInstallationCode", () => {
  it("returns the access token from a successful exchange", async () => {
    const captured: Array<{ method?: string; body?: unknown }> = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ method: init?.method, body: init?.body });
      return new Response(JSON.stringify({ access_token: "ghu_ok" }), { status: 200 });
    }) as FetchFn;
    const token = await exchangeInstallationCode(
      { clientId: "id", clientSecret: "secret", code: "code" },
      fetchFn,
    );
    expect(token).toBe("ghu_ok");
    expect(captured[0].method).toBe("POST");
    expect(JSON.parse(String(captured[0].body))).toMatchObject({
      client_id: "id",
      client_secret: "secret",
      code: "code",
    });
  });

  it("throws on GitHub's 200-with-error body (bad/expired code)", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        status: 200,
      })) as FetchFn;
    await expect(
      exchangeInstallationCode({ clientId: "i", clientSecret: "s", code: "x" }, fetchFn),
    ).rejects.toThrow(/no access token/);
  });

  it("throws on a non-200 response", async () => {
    const fetchFn = (async () => new Response("err", { status: 500 })) as FetchFn;
    await expect(
      exchangeInstallationCode({ clientId: "i", clientSecret: "s", code: "x" }, fetchFn),
    ).rejects.toThrow(/500/);
  });
});

describe("userIsOrgAdmin", () => {
  const ok = (role: string, state = "active") =>
    (async () =>
      new Response(JSON.stringify({ role, state }), { status: 200 })) as FetchFn;

  it("is true only for an active admin", async () => {
    expect(await userIsOrgAdmin("t", "org", ok("admin"))).toBe(true);
    expect(await userIsOrgAdmin("t", "org", ok("member"))).toBe(false);
    expect(await userIsOrgAdmin("t", "org", ok("admin", "pending"))).toBe(false);
  });

  it("is false when the user is not a member (404/403), true admin aside", async () => {
    const notMember = (async () => new Response("{}", { status: 404 })) as FetchFn;
    expect(await userIsOrgAdmin("t", "org", notMember)).toBe(false);
    const forbidden = (async () => new Response("{}", { status: 403 })) as FetchFn;
    expect(await userIsOrgAdmin("t", "org", forbidden)).toBe(false);
  });

  it("throws on other HTTP errors so the caller fails closed", async () => {
    const err = (async () => new Response("boom", { status: 500 })) as FetchFn;
    await expect(userIsOrgAdmin("t", "org", err)).rejects.toThrow(/500/);
  });
});

describe("userControlsInstallation", () => {
  it("matches an installation the user can access", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ installations: [{ id: 111 }, { id: 222 }] }),
        { status: 200 },
      )) as FetchFn;
    expect(await userControlsInstallation("tok", "222", fetchFn)).toBe(true);
    expect(await userControlsInstallation("tok", "999", fetchFn)).toBe(false);
  });

  it("paginates until the installation is found or pages run out", async () => {
    let page = 0;
    const fetchFn = (async (url: RequestInfo | URL) => {
      page = Number(new URL(String(url)).searchParams.get("page"));
      // Page 1 is full (100 items) → keep going; page 2 has the target.
      if (page === 1) {
        return new Response(
          JSON.stringify({
            installations: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ installations: [{ id: 5000 }] }), {
        status: 200,
      });
    }) as FetchFn;
    expect(await userControlsInstallation("tok", "5000", fetchFn)).toBe(true);
    expect(page).toBe(2);
  });

  it("throws on an HTTP error so the caller can fail closed", async () => {
    const fetchFn = (async () => new Response("no", { status: 403 })) as FetchFn;
    await expect(userControlsInstallation("tok", "1", fetchFn)).rejects.toThrow(/403/);
  });
});

describe("readCopilotAppConfig — gating includes the new OAuth secrets", () => {
  const base = {
    GH_COPILOT_APP_ID: "1",
    GH_COPILOT_APP_PRIVATE_KEY: "pem",
    GH_COPILOT_APP_SLUG: "revealyst",
    GH_COPILOT_APP_CLIENT_ID: "cid",
    GH_COPILOT_APP_CLIENT_SECRET: "csecret",
  };

  it("returns a full config only when ALL secrets are present", () => {
    expect(readCopilotAppConfig(base)).toEqual({
      appId: "1",
      privateKeyPem: "pem",
      slug: "revealyst",
      clientId: "cid",
      clientSecret: "csecret",
    });
  });

  it("stays null (flow honestly disabled) if the client id or secret is missing", () => {
    expect(readCopilotAppConfig({ ...base, GH_COPILOT_APP_CLIENT_ID: undefined })).toBeNull();
    expect(
      readCopilotAppConfig({ ...base, GH_COPILOT_APP_CLIENT_SECRET: undefined }),
    ).toBeNull();
  });
});

describe("verifyConnectState — org-bound CSRF state stays required (unchanged)", () => {
  const secret = "state-signing-secret";
  const now = new Date("2026-07-10T12:00:00Z");

  it("verifies a fresh token for the same org", async () => {
    const token = await signConnectState(secret, "org-A", now);
    expect(await verifyConnectState(secret, token, "org-A", now)).toBe(true);
  });

  it("rejects a token minted for a DIFFERENT org (cross-org binding)", async () => {
    const token = await signConnectState(secret, "org-A", now);
    expect(await verifyConnectState(secret, token, "org-B", now)).toBe(false);
  });

  it("rejects a tampered MAC and an expired token", async () => {
    const token = await signConnectState(secret, "org-A", now);
    expect(await verifyConnectState(secret, `${token}x`, "org-A", now)).toBe(false);
    const later = new Date(now.getTime() + 16 * 60 * 1000); // past the 15m TTL
    expect(await verifyConnectState(secret, token, "org-A", later)).toBe(false);
  });
});
