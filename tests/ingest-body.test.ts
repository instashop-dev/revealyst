import { describe, expect, it } from "vitest";
import { readIngestJson } from "../src/lib/ingest-body";

// Regression coverage for the desktop-agent sync bug (2026-07-17): the Rust
// agent uploads to /api/agent/ingest with a gzipped body + `Content-Encoding:
// gzip`, but the route only did `await req.json()`. Cloudflare Workers does not
// auto-decompress inbound request bodies, so every agent sync got 400 ("body
// must be JSON") and requeued forever, while the CLI (plain JSON) worked. The
// whole sync-engine test suite missed it because each mock transport gunzipped
// the body itself. These tests exercise the real body↔JSON boundary.

/** Gzip a string the same way the agent does, via the Web CompressionStream. */
async function gzip(text: string): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const bytes = new TextEncoder().encode(text);
  const stream = new Response(bytes).body!.pipeThrough(cs);
  return new Response(stream).arrayBuffer();
}

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.test/api/agent/ingest", {
    method: "POST",
    body,
    headers,
  });
}

const BIG = 1_000_000;

describe("readIngestJson", () => {
  it("parses a plain-JSON body (the CLI path, unchanged)", async () => {
    const payload = { agentVersion: "0.1.0", records: [{ metricKey: "prompts" }] };
    const result = await readIngestJson(
      post(JSON.stringify(payload), { "content-type": "application/json" }),
      BIG,
    );
    expect(result).toEqual({ ok: true, body: payload });
  });

  it("decompresses a gzip body with Content-Encoding: gzip (the agent path)", async () => {
    const payload = { agentVersion: "0.1.0", window: { start: "2026-07-15" } };
    const gz = await gzip(JSON.stringify(payload));
    const result = await readIngestJson(
      post(gz, {
        "content-type": "application/json",
        "content-encoding": "gzip",
      }),
      BIG,
    );
    expect(result).toEqual({ ok: true, body: payload });
  });

  it("decompresses a gzip body even if the encoding header is missing (magic sniff)", async () => {
    const payload = { hello: "world" };
    const gz = await gzip(JSON.stringify(payload));
    // No content-encoding header — a proxy could have stripped it.
    const result = await readIngestJson(post(gz), BIG);
    expect(result).toEqual({ ok: true, body: payload });
  });

  it("parses a plain body even if a proxy left a stale Content-Encoding: gzip header", async () => {
    // The gunzip decision is by magic bytes, not the header — so a decompressed
    // body wrongly still tagged gzip parses as JSON instead of 400-ing.
    const payload = { agentVersion: "0.1.0" };
    const result = await readIngestJson(
      post(JSON.stringify(payload), { "content-encoding": "gzip" }),
      BIG,
    );
    expect(result).toEqual({ ok: true, body: payload });
  });

  it("rejects an oversized PLAIN body with 413", async () => {
    const result = await readIngestJson(post("x".repeat(200)), 100);
    expect(result).toEqual({ ok: false, status: 413, error: "body too large" });
  });

  it("bounds the DECOMPRESSED size — a gzip bomb is 413, not accepted", async () => {
    // 50k identical bytes compress tiny but inflate well past the 100-byte cap.
    const gz = await gzip("a".repeat(50_000));
    const result = await readIngestJson(
      post(gz, { "content-encoding": "gzip" }),
      100,
    );
    expect(result).toEqual({ ok: false, status: 413, error: "body too large" });
  });

  it("returns 400 for a Content-Encoding: gzip body that is not valid gzip", async () => {
    const result = await readIngestJson(
      post("this is not gzip", { "content-encoding": "gzip" }),
      BIG,
    );
    expect(result).toEqual({ ok: false, status: 400, error: "body must be JSON" });
  });

  it("returns 400 for a plain body that is not JSON", async () => {
    const result = await readIngestJson(post("not json at all"), BIG);
    expect(result).toEqual({ ok: false, status: 400, error: "body must be JSON" });
  });

  it("returns 400 for gzip that decompresses to non-JSON", async () => {
    const gz = await gzip("still not json");
    const result = await readIngestJson(
      post(gz, { "content-encoding": "gzip" }),
      BIG,
    );
    expect(result).toEqual({ ok: false, status: 400, error: "body must be JSON" });
  });
});
