# Live-account verification scripts (W0-A)

Each script probes the `needs-live-verification` (NLV) items listed in
[`docs/connector-facts.md`](../../docs/connector-facts.md) for one vendor.
Run with Node ≥ 18 (built-in `fetch`). **Read-only**: every call is a GET/POST
read endpoint; nothing mutates vendor state.

**Keys are read from environment variables only.** Never paste keys into
prompts, files, or command history. Scripts never print keys; raw responses
are printed with credential-bearing headers stripped.

| Script | Env vars | Covers |
|---|---|---|
| `copilot.mjs` | `GITHUB_TOKEN` (org admin PAT or App installation token), `GH_ORG`; optional `GH_USER_TOKEN` (personal-plan PAT) | NLV-C2..C4, C7..C14, C17 |
| `cursor.mjs` | `CURSOR_API_KEY` | NLV-U1..U4, U10..U13 |
| `anthropic.mjs` | `ANTHROPIC_ADMIN_KEY`; optional `ANTHROPIC_ANALYTICS_KEY` (Enterprise) | NLV-A1..A5, A7, A8, A11, A12 |
| `openai.mjs` | `OPENAI_ADMIN_KEY`; optional `OPENAI_PROJECT_KEY` | NLV-O1 (partial), O2, O3, O5, O8, O10, O11, O13 |
| `claude-code-local.mjs` | none (reads local Claude Code logs, read-only) | NLV-L1, L4, L5, L8 — run on macOS/Linux machines |

Usage (PowerShell):

```powershell
$env:GITHUB_TOKEN = "<paste>"; $env:GH_ORG = "your-org"
node scripts/verify/copilot.mjs > copilot-verify.out.txt
```

Paste the `.out.txt` back into a Revealyst session; results are folded into
`connector-facts.md` as a follow-up commit before the W0-C freeze. Items a
script cannot automate (e.g. policy toggles, timezone-straddle activity
generation, rate-limit hammering) are printed as MANUAL steps at the end of
each run — deliberately, to keep these scripts safe and idempotent.
