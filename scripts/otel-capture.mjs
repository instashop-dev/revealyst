// Throwaway local OTLP/HTTP collector for capturing real Claude Code telemetry
// fixtures — the FOUNDER-GATED capture step the W5-B spike documented
// (docs/research/2026-07-13-claude-code-otel-receiver-spike.md §9;
// fixtures/otel/README.md). Dependency-free (node:http + node:fs).
//
// It listens on the OTLP/HTTP default port, accepts POST /v1/metrics and
// POST /v1/logs, writes each raw JSON body to fixtures/otel/*.captured.json,
// and — critically — replies HTTP 200 with an empty OTLP service response so
// Claude Code's exporter does NOT retry (the spike's finding: OTLP wants 200,
// not 202). Content is never requested from Claude Code (we don't set the
// OTEL_LOG_* flags) so nothing sensitive should arrive; the collector also
// prints only header SHAPES, never values.
//
// Run:  node scripts/otel-capture.mjs
// Then, in the shell where you'll run Claude Code:
//   export CLAUDE_CODE_ENABLE_TELEMETRY=1
//   export OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp
//   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json          # MANDATORY (override the grpc default)
//   export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
//   export OTEL_METRIC_EXPORT_INTERVAL=10000 OTEL_LOGS_EXPORT_INTERVAL=2000
//   # DO NOT set OTEL_LOG_USER_PROMPTS / _ASSISTANT_RESPONSES / _RAW_API_BODIES / _TOOL_DETAILS
// Use Claude Code ~5-10 min (accept AND reject edits, run bash, spawn a subagent,
// ideally trigger a retry), then Ctrl-C here. Captures land in fixtures/otel/.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "otel");
mkdirSync(OUT_DIR, { recursive: true });

const counters = { "/v1/metrics": 0, "/v1/logs": 0, other: 0 };

function authShape(header) {
  if (!header) return "(none)";
  // Report only the SHAPE — never the secret. e.g. "Bearer rva1.<4-part-token>"
  const m = /^Bearer\s+(\S+)/i.exec(header);
  if (!m) return `${header.split(" ")[0]} <opaque>`;
  const parts = m[1].split(".");
  return `Bearer <${parts.length}-part token>`;
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const path = req.url || "";
    const signal = path === "/v1/metrics" ? "metrics" : path === "/v1/logs" ? "logs" : "other";
    const key = counters[path] !== undefined ? path : "other";
    const n = ++counters[key];

    if (signal !== "other") {
      const file = join(OUT_DIR, `${signal}-${String(n).padStart(3, "0")}.captured.json`);
      // Pretty-print if it parses as JSON (http/json); otherwise store raw.
      let out = body;
      try { out = JSON.stringify(JSON.parse(body), null, 2); } catch { /* protobuf/raw */ }
      writeFileSync(file, out);
      console.log(
        `[capture] ${path}  #${n}  ${req.headers["content-type"] || "?"}  ` +
          `auth=${authShape(req.headers["authorization"])}  ${body.length}B  -> ${file}`,
      );
    } else {
      console.log(`[skip] ${req.method} ${path} (not an OTLP signal path)  ${body.length}B`);
    }

    // OTLP/HTTP success = 200 + an (empty) Export<signal>ServiceResponse. Empty
    // object is a valid "fully accepted" response and stops exporter retries.
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});

server.listen(4318, "127.0.0.1", () => {
  console.log("OTLP capture collector listening on http://127.0.0.1:4318");
  console.log(`Writing captures to ${OUT_DIR}`);
  console.log("Point Claude Code's exporter here (see the header of this file), then Ctrl-C when done.\n");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    const total = counters["/v1/metrics"] + counters["/v1/logs"];
    console.log(
      `\nStopping. Captured ${counters["/v1/metrics"]} metrics + ${counters["/v1/logs"]} logs ` +
        `(${total} total) into ${OUT_DIR}.`,
    );
    server.close(() => process.exit(0));
  });
}
