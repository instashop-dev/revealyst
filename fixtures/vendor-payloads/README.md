# Recorded vendor payloads (W1-S owns this directory)

One subdirectory per vendor (`github_copilot/`, `cursor/`, `anthropic_console/`,
`anthropic_claude_enterprise/`, `openai/`, `claude_code_local/`), each holding
**recorded real API responses** — captured from the founder's accounts via the
`scripts/record/` pipeline, then scrubbed of identifying values — NOT
hand-written JSON (rule 2 / execution-plan W1-S).

Every file wraps one frozen `RawPayloadEnvelope` (`src/contracts/connector.ts`)
in recording metadata:

```json
{
  "meta": { "vendor": "anthropic_console", "recordedAt": "…", "script": "…",
            "scrubbed": true, "endpoint": "/v1/…", "status": 200 },
  "envelope": { "kind": "anthropic_console.claude_code",
                "window": { "start": "…", "end": "…" }, "payload": { } }
}
```

CI enforces the shape and a scrub lint over every committed file
(`tests/vendor-fixtures.test.ts`); tests load recordings through
`tests/harness/vendor-payloads.ts` (`loadRecordedPayloads(vendor, kind?)`).
To record: see `scripts/record/README.md` (founder-run, live keys, read-only).

Connector `normalize()` implementations are pure, so W1-D/W2-J test directly:
recorded payload in → expected `metric_records` / `subject_day_signals` /
`HonestyGap[]` out. Gate integration then replays the same payloads against live
credentials to prove the recordings still match reality.

Until W1-S lands recordings, connector work builds against the deterministic
graphs in `fixtures/metric-records/` (loaded via `src/db/fixtures.ts`).
