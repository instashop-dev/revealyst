// Read a POST body as JSON, transparently decompressing a
// `Content-Encoding: gzip` request body.
//
// Why this exists (desktop-agent sync bug, 2026-07-17): the Revealyst Desktop
// Agent uploads to POST /api/agent/ingest with the body gzipped and
// `Content-Encoding: gzip` (sync engine, spec §14.3). Cloudflare Workers does
// NOT auto-decompress an inbound request body carrying a client-set
// Content-Encoding, so a plain `await req.json()` sees the raw gzip bytes and
// throws — every agent sync returned 400 ("body must be JSON") and requeued its
// events forever, while the CLI (which posts UNcompressed JSON) worked. Every
// sync-engine unit test used a mock transport that gunzipped the body itself,
// so this agent↔server boundary was never exercised. This reader accepts BOTH:
// plain JSON (the CLI, byte-for-byte unchanged) and gzip (the desktop agent).
//
// `maxBytes` bounds the DECOMPRESSED size, streamed so we stop the moment the
// cap is exceeded rather than after materializing a decompression bomb. This is
// the load-bearing memory guard: a gzip body's Content-Length reflects only the
// COMPRESSED size, so the caller's Content-Length pre-check (when present at
// all) can't bound what a small compressed body inflates to.

export type ReadBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string };

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Parse a request body into JSON, decompressing gzip when present. `maxBytes`
 * bounds the DECOMPRESSED size. Never throws — every failure resolves to a
 * `{ ok: false }` with the HTTP status the route should return.
 */
export async function readIngestJson(
  req: Request,
  maxBytes: number,
): Promise<ReadBodyResult> {
  const buf = await req.arrayBuffer();
  const raw = new Uint8Array(buf);

  // Decide gzip by the MAGIC NUMBER, not the Content-Encoding header. A gzip
  // stream always begins 0x1f8b (RFC 1952); a decompressed body never does; and
  // plain JSON can't (it starts with `{`, `[`, or whitespace). Sniffing the
  // bytes is therefore correct for every proxy permutation — header stripped,
  // header kept, body decompressed-but-header-left — whereas trusting the header
  // would gunzip an already-plain body and 400 it.
  const looksGzip =
    raw.length >= 2 && raw[0] === GZIP_MAGIC_0 && raw[1] === GZIP_MAGIC_1;

  let text: string;
  if (looksGzip) {
    const inflated = await gunzip(buf, maxBytes);
    if (!inflated.ok) return inflated;
    text = inflated.text;
  } else {
    if (raw.length > maxBytes) {
      return { ok: false, status: 413, error: "body too large" };
    }
    text = new TextDecoder().decode(raw);
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "body must be JSON" };
  }
}

/** Streaming gunzip with a hard cap on the inflated size. */
async function gunzip(
  buf: ArrayBuffer,
  maxBytes: number,
): Promise<
  { ok: true; text: string } | { ok: false; status: 400 | 413; error: string }
> {
  let stream: ReadableStream<Uint8Array>;
  try {
    const source = new Response(buf).body;
    if (!source) return { ok: false, status: 400, error: "body must be JSON" };
    stream = source.pipeThrough(new DecompressionStream("gzip"));
  } catch {
    return { ok: false, status: 400, error: "body must be JSON" };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: "body too large" };
      }
      chunks.push(value);
    }
  } catch {
    // Truncated or otherwise malformed gzip stream.
    return { ok: false, status: 400, error: "body must be JSON" };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
