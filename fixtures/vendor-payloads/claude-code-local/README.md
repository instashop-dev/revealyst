# claude-code-local fixtures

Structurally-faithful Claude Code session JSONL (schema per
`docs/connector-facts.md` §5, verified against real logs on the founder's
Windows machine, Claude Code ≥ 2.x record shapes) with every
content-carrying field replaced by a `SENTINEL_*` string.

The sentinels are load-bearing: the privacy suite in
`packages/revealyst-agent/tests/privacy.test.ts` builds a full ingest
payload from these files and asserts **no sentinel survives** — proving the
"summarize locally, never transmit content" tripwire holds by construction,
not by review.

- `main-session.jsonl` — a two-day session: human prompt, streamed
  assistant turn (duplicate `requestId` lines restating the same usage —
  exercises dedup), tool-result carrier user record, attachment,
  queue-operation, titles/mode/last-prompt records, one corrupted line, one
  unknown future record type, and one out-of-window record (2026-06-25).
- `sidechain-session.jsonl` — a subagent transcript (`isSidechain: true`)
  with its own usage; must be included in sums (spend accuracy).
- `streamed-usage.jsonl` — a single turn whose partial and final streamed
  lines carry DIFFERENT usage (`input:100` → `input:1200`), pinning the
  last-wins dedup direction (a first-wins or sum-both bug is observable).
- `unsupported-version.jsonl` — records declaring a `version` beyond the
  connector's supported major (`999.0.0`). The Rust Claude Code connector
  (T5.1) treats the whole file as `unsupported_version` and emits ZERO
  events (spec §11.3.1: never partial-parse an unrecognized format).

Adding files here is coverage (fine); changing existing shapes is a
frozen-fixture change (ADR — CLAUDE.md).
