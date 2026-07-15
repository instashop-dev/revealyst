import { describe, expect, it } from "vitest";
import {
  APP_HOST,
  APP_ORIGIN,
  MARKETING_HOST,
  MARKETING_ORIGIN,
  WORKERS_DEV_HOST,
  classifyPath,
  resolveRedirect,
  toMarketingOrigin,
} from "../src/lib/domains";

describe("classifyPath", () => {
  it("classifies (app) group + flat authed routes as app", () => {
    for (const p of [
      "/admin",
      "/admin/users",
      "/admin/users/user-123",
      "/dashboard",
      "/dashboard/anything",
      "/teams",
      "/people",
      "/connections",
      "/members",
      "/reconcile",
      "/billing",
      "/compliance",
      "/playbook",
      "/account",
      "/sign-in",
      "/reset-password",
      "/onboarding",
      "/invite/tok_123",
    ]) {
      expect(classifyPath(p)).toBe("app");
    }
  });

  it("classifies landing, legal, and share cards as marketing", () => {
    expect(classifyPath("/")).toBe("marketing");
    expect(classifyPath("/legal")).toBe("marketing");
    expect(classifyPath("/legal/terms")).toBe("marketing");
    expect(classifyPath("/legal/privacy")).toBe("marketing");
    expect(classifyPath("/s/abc123")).toBe("marketing");
  });

  it("only matches app prefixes at a path boundary", () => {
    // Not "/people" — a different route that merely shares the prefix.
    expect(classifyPath("/peoplesearch")).toBe("neutral");
    expect(classifyPath("/billings")).toBe("neutral");
    expect(classifyPath("/administrivia")).toBe("neutral");
  });

  it("treats api, assets, and metadata routes as neutral (checked first)", () => {
    expect(classifyPath("/api/auth/callback/github")).toBe("neutral");
    expect(classifyPath("/api/webhooks/paddle")).toBe("neutral");
    expect(classifyPath("/health")).toBe("neutral");
    expect(classifyPath("/_next/static/chunk.js")).toBe("neutral");
    expect(classifyPath("/favicon.ico")).toBe("neutral");
    expect(classifyPath("/robots.txt")).toBe("neutral");
    expect(classifyPath("/sitemap.xml")).toBe("neutral");
    expect(classifyPath("/opengraph-image")).toBe("neutral");
    // A metadata route under a marketing path must stay neutral so social
    // scrapers get it on whichever host they asked — never a 308.
    expect(classifyPath("/s/abc123/opengraph-image")).toBe("neutral");
    // The OTel receiver (V1-001): never redirect — the Claude Code OTLP
    // exporter doesn't follow 308s, and a cross-host redirect strips the
    // Authorization (device-token) header.
    expect(classifyPath("/v1/metrics")).toBe("neutral");
    expect(classifyPath("/v1/logs")).toBe("neutral");
  });
});

describe("resolveRedirect", () => {
  it("sends app paths on the marketing host to the app host", () => {
    expect(
      resolveRedirect(MARKETING_HOST, "GET", "/dashboard", "?tab=x"),
    ).toBe(`${APP_ORIGIN}/dashboard?tab=x`);
    expect(resolveRedirect(MARKETING_HOST, "GET", "/sign-in", "")).toBe(
      `${APP_ORIGIN}/sign-in`,
    );
  });

  it("sends marketing paths on the app host to the marketing host", () => {
    expect(resolveRedirect(APP_HOST, "GET", "/", "")).toBe(
      `${MARKETING_ORIGIN}/`,
    );
    expect(resolveRedirect(APP_HOST, "GET", "/legal/terms", "")).toBe(
      `${MARKETING_ORIGIN}/legal/terms`,
    );
    expect(resolveRedirect(APP_HOST, "GET", "/s/abc", "")).toBe(
      `${MARKETING_ORIGIN}/s/abc`,
    );
  });

  it("preserves HEAD alongside GET", () => {
    expect(resolveRedirect(MARKETING_HOST, "HEAD", "/dashboard", "")).toBe(
      `${APP_ORIGIN}/dashboard`,
    );
  });

  it("never redirects a non-safe method (no cross-host POST replay)", () => {
    expect(resolveRedirect(MARKETING_HOST, "POST", "/dashboard", "")).toBeNull();
    expect(resolveRedirect(APP_HOST, "PUT", "/", "")).toBeNull();
  });

  it("does not redirect when already on the canonical host", () => {
    expect(resolveRedirect(APP_HOST, "GET", "/dashboard", "")).toBeNull();
    expect(resolveRedirect(MARKETING_HOST, "GET", "/", "")).toBeNull();
  });

  it("does not redirect neutral paths on either host", () => {
    expect(
      resolveRedirect(MARKETING_HOST, "GET", "/api/health", ""),
    ).toBeNull();
    expect(
      resolveRedirect(APP_HOST, "GET", "/s/abc/opengraph-image", ""),
    ).toBeNull();
  });

  it("never redirects the OTel receiver (/v1/*), on either host", () => {
    expect(
      resolveRedirect(MARKETING_HOST, "GET", "/v1/metrics", ""),
    ).toBeNull();
    expect(resolveRedirect(APP_HOST, "GET", "/v1/logs", "")).toBeNull();
  });

  it("passes through any unknown host (localhost, previews, self-ref)", () => {
    expect(resolveRedirect("localhost", "GET", "/", "")).toBeNull();
    // CI preview versions are NOT the legacy host — exact match only.
    expect(
      resolveRedirect(
        "abc123-revealyst.thapi.workers.dev",
        "GET",
        "/dashboard",
        "",
      ),
    ).toBeNull();
  });

  it("moves legacy workers.dev pages to the canonical host per surface", () => {
    expect(
      resolveRedirect(WORKERS_DEV_HOST, "GET", "/dashboard", "?tab=x"),
    ).toBe(`${APP_ORIGIN}/dashboard?tab=x`);
    expect(resolveRedirect(WORKERS_DEV_HOST, "GET", "/s/abc", "")).toBe(
      `${MARKETING_ORIGIN}/s/abc`,
    );
    expect(resolveRedirect(WORKERS_DEV_HOST, "GET", "/", "")).toBe(
      `${MARKETING_ORIGIN}/`,
    );
    // Neutral paths keep SERVING on the legacy host: old API GETs (health
    // monitors, authed clients whose Authorization a cross-host redirect
    // would strip) and metadata routes scrapers fetch without following 308s
    // (same rationale as isNeutralPath).
    expect(
      resolveRedirect(WORKERS_DEV_HOST, "GET", "/api/health", ""),
    ).toBeNull();
    expect(
      resolveRedirect(WORKERS_DEV_HOST, "GET", "/s/abc/opengraph-image", ""),
    ).toBeNull();
    // Non-safe methods are served in place, never replayed cross-host.
    expect(
      resolveRedirect(WORKERS_DEV_HOST, "POST", "/api/agent/ingest", ""),
    ).toBeNull();
  });
});

describe("toMarketingOrigin", () => {
  it("rewrites the app-host origin to the marketing origin", () => {
    expect(toMarketingOrigin(APP_ORIGIN)).toBe(MARKETING_ORIGIN);
  });

  it("leaves any other origin unchanged (dev localhost, marketing host)", () => {
    expect(toMarketingOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(toMarketingOrigin(MARKETING_ORIGIN)).toBe(MARKETING_ORIGIN);
    expect(toMarketingOrigin("not a url")).toBe("not a url");
  });
});
