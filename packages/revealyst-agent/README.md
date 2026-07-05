# revealyst-agent

The Revealyst Agent — the sanctioned local-ingest path for Claude Code
(product spec §10). Reads your local Claude Code session logs, summarizes
them **on your machine** into daily metric records, and pushes only those
records to Revealyst with a device token.

## What leaves your machine — and what never does

Transmitted (the full list — enforced by the privacy test suite):
- daily counts: sessions, prompts, active days
- daily token totals (input / output / cache read / cache write)
- per-model request/token counts (model *ids* only)
- estimated spend (public list prices; marked as an estimate)
- a 24-slot hourly activity histogram + peak session concurrency per day
- your Claude account email — **only** if you opt in with
  `--consent-identity`; otherwise a one-way device hash

Never transmitted: prompt or completion text, tool inputs/outputs, file
contents or paths, session titles, working directories, git branches,
session ids. The parser structurally cannot carry these fields
(`src/parse.ts`), and `tests/privacy.test.ts` proves no content survives
into an outgoing payload using sentinel-seeded fixtures.

## Usage

```
revealyst-agent login --token rva1.…  [--api <url>] [--consent-identity]
revealyst-agent sync  [--days 30] [--dry-run]
revealyst-agent status
```

Create the device token in Revealyst → Connections → Revealyst Agent (it is
shown once; re-issuing rotates it). `sync --dry-run` shows exactly what
would be pushed without pushing. Schedule `sync` daily with Task Scheduler
(Windows) or cron if you want hands-off updates.

Log locations scanned: `%USERPROFILE%\.claude\projects\` (or
`~/.claude/projects/`), honoring `CLAUDE_CONFIG_DIR` (multi-path). Local
logs retain ~30 days by default, so backfill depth is bounded by that.

## Development

Lives in the Revealyst monorepo; tests run from the repo root (`npm test`)
against recorded-shape fixtures in `fixtures/vendor-payloads/claude-code-local/`.
Dev invocation without a build: `npm run agent -- sync --dry-run`.
Build the distributable CLI: `npm run build` in this directory (emits
`dist/`, CommonJS, `revealyst-agent` bin).
