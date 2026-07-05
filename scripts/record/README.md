# Recorded-payload pipeline (W1-S)

Founder-run recorders that capture **real vendor API responses**, scrub them
(`scrub.mjs`), and write `RawPayloadEnvelope` fixture files into
`fixtures/vendor-payloads/<vendor>/` — the recordings every connector's
`normalize()` tests replay (rule 2: recorded real, never hand-written).

Same safety rules as `scripts/verify/`: **read-only** report endpoints only;
keys come from environment variables and are never printed or written; a
recorder refuses to write any file the scrub self-check still flags.

| Script | Env vars | Records |
|---|---|---|
| `anthropic.mjs` | `ANTHROPIC_ADMIN_KEY`; optional `ANTHROPIC_ANALYTICS_KEY` (Enterprise), `RECORD_DAYS` (default 30) | Console Claude Code Analytics (per-day), messages usage report (1d buckets), cost report (1d); Enterprise summaries/users/usage/cost when the Analytics key is set |

Usage (PowerShell):

```powershell
$env:ANTHROPIC_ADMIN_KEY = "<paste>"
node scripts/record/anthropic.mjs
```

Then: review the diff under `fixtures/vendor-payloads/`, run `npm test`
(`tests/vendor-fixtures.test.ts` validates envelope shape + scrub lint), and
commit. Re-running rewrites recordings wholesale — pseudonyms are stable
within a run, not across runs, so never mix files from different runs for the
same vendor.

Scrubbing (deterministic within a run, joins preserved):
- emails → `user-N@scrubbed.example` · key names → `api-key-N` · names → `name-N`
- `organization_id`/`workspace_id`/`api_key_id`/`account_id`/`service_account_id`/
  `user_id`/`rbac_group_id` → stable `*_scrub_N` tokens
- any `sk-ant-…` material → `sk-ant-REDACTED`; emails inside free text also caught
- metric numbers (tokens, costs, counts) are **never** altered — they are the data

New vendors (W1-D/W1-E/W2-J seams): add `<vendor>.mjs` here following the same
pattern — shared scrubber instance per run, `findScrubViolations` self-check,
envelope `kind` namespaced `<vendor>.<report>`.
