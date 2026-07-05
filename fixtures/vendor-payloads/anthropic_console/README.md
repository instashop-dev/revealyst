# anthropic_console — provisional recorded-shape fixtures

**Status: provisional (W1-D).** These payloads are hand-assembled to the
*documented* shapes in `docs/connector-facts.md` §3 (field inventory retrieved
2026-07-04) so the connector's pure `normalize()` has a deterministic seam to
build and test against. They are NOT yet recorded from a live org.

W1-S owns replacing them with scrubbed **recorded real** responses from the
founder's Console org via `scripts/verify/anthropic.mjs` (rule 2). When the
recordings land, shapes must stay compatible — a divergence is a normalize bug
or a connector-facts erratum, and either way a finding, not a silent edit.

Files map 1:1 to `raw_payloads.kind` values:
- `usage-messages-1h.json` → `anthropic.usage_report.messages.1h`
- `cost-report-1d.json` → `anthropic.cost_report.1d`
- `claude-code-daily.json` → `anthropic.usage_report.claude_code.1d`
  (includes a `user_actor` record deliberately — bug #27780 says the live API
  omits them today; the connector must handle both worlds without fabricating.)
