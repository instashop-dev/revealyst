import { describe, expect, it } from "vitest";
import { pushBatch } from "../src/push";
import type { AgentIngestRequest } from "../src/types";

const BATCH: AgentIngestRequest = {
  agentVersion: "0.1.0",
  summarizerVersion: 1,
  window: { start: "2026-07-01", end: "2026-07-02" },
  subjects: [
    { kind: "person", externalId: "d@e.com", email: "d@e.com", displayName: null },
  ],
  records: [],
  signals: [],
  gaps: [],
};

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init ?? {}))) as typeof fetch;
}

describe("pushBatch", () => {
  it("POSTs the batch with the bearer token and returns counts", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    const result = await pushBatch(
      "https://api.test/", // trailing slash must not double up
      "rva1.o.c.s",
      BATCH,
      fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = (init.headers as Record<string, string>).authorization;
        seenBody = String(init.body);
        return Response.json({ ok: true, subjects: 1, records: 5, signals: 2 });
      }),
    );
    expect(seenUrl).toBe("https://api.test/api/agent/ingest");
    expect(seenAuth).toBe("Bearer rva1.o.c.s");
    expect(JSON.parse(seenBody)).toEqual(BATCH);
    expect(result).toEqual({ ok: true, subjects: 1, records: 5, signals: 2 });
  });

  it("surfaces server error messages with their status", async () => {
    const result = await pushBatch(
      "https://api.test",
      "rva1.o.c.s",
      BATCH,
      fakeFetch(() =>
        Response.json({ error: "connection paused" }, { status: 403 }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "connection paused",
    });
  });

  it("handles non-JSON error pages", async () => {
    const result = await pushBatch(
      "https://api.test",
      "rva1.o.c.s",
      BATCH,
      fakeFetch(() => new Response("<html>502</html>", { status: 502 })),
    );
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "server returned 502",
    });
  });

  it("handles network failures without throwing", async () => {
    const result = await pushBatch(
      "https://api.test",
      "rva1.o.c.s",
      BATCH,
      (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeNull();
      expect(result.error).toContain("ECONNREFUSED");
    }
  });
});
