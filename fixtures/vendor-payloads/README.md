# Recorded vendor payloads (W1-S owns this directory)

One subdirectory per vendor (`github_copilot/`, `cursor/`, `anthropic_console/`,
`anthropic_claude_enterprise/`, `openai/`, `claude_code_local/`), each holding
**recorded real API responses** — captured from the founder's accounts via the
`scripts/verify/` harness, then scrubbed of identifying values — NOT hand-written
JSON (rule 2 / execution-plan W1-S).

Connector `normalize()` implementations are pure, so W1-D/W2-J test directly:
recorded payload in → expected `metric_records` / `subject_day_signals` /
`HonestyGap[]` out. Gate integration then replays the same payloads against live
credentials to prove the recordings still match reality.

Until W1-S lands recordings, connector work builds against the deterministic
graphs in `fixtures/metric-records/` (loaded via `src/db/fixtures.ts`).
