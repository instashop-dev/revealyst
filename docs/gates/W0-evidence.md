# W0 exit-gate evidence — frozen-contract checklist

Assembled at the W0-C freeze ceremony for `/gate-check W0` (rule 4: the founder
judges evidence, not code). Suite state at assembly: **132 tests green across 12
files** (`npm test`), typecheck clean, org-scope guard clean.

| # | Gate item | Evidence |
|---|---|---|
| 1 | Skeleton serves an authenticated page in production; heartbeat runs on schedule | W0-B (PRs #5–#14): https://revealyst.thapi.workers.dev live; `poll_heartbeats` written by Cron → Queue → consumer (`tests/poller.test.ts`); `docs/infra.md` |
| 2 | `connector-facts.md` complete | W0-A (PR #1): all five vendors, summary table, per-vendor facts. **DRAFT caveat: `scripts/verify/` NLV items need founder runs with live keys — confirm folded in before tagging `contracts-v1`** |
| 3 | Schema migrations incl. sub-daily signals | Migrations 0003–0009 apply on empty PGlite in every test run and to Neon via the Deploy workflow. Sub-daily: `subject_day_signals` 24-slot histogram CHECK proven (`tests/facts.test.ts` rejects 23/25 slots, accepts the Copilot NULL+`none` case). Restatement upsert key proven (same key twice → one row). PRs #15, #16, #19, #21 |
| 4 | `tracked_user` definition | Frozen in `src/contracts/tracked-user.ts` (doc-comment + pure `countTrackedUsers`). Matrix proven in `tests/contracts.test.ts`: shared account → resolved identities only; unresolved subjects surfaced NOT billed; zero-record people excluded; person counted once across subjects; SQL twin ≡ pure on the loaded fixture. PR #23 |
| 5 | Encrypted-credential shape + envelope wiring | `connection_credentials` (envelope columns only; no-plaintext-column schema test) + `src/lib/credentials.ts` (WebCrypto AES-256-GCM, versioned KEK, AAD tenant binding, DEK-only rotation). 27 crypto/boundary tests (`tests/credentials.test.ts`). Security-review record: PR #17 comment (6 findings, all remediated in #18). deploy.yml syncs `CREDENTIAL_KEK_CURRENT`/`_PREVIOUS` incl. rotation-window deletion. PRs #17, #18 |
| 6 | Enforced tenant isolation + cross-org-read test | ADR `docs/decisions/0001-tenant-isolation.md` (repo layer over RLS, with rationale). `tests/tenant-isolation.test.ts`: registry sweep over all 18 read surfaces (zero B-id leakage), completeness tripwire (org_id table not in sweep → suite fails), composite-FK write rejections, credential AAD row-copy fails GCM. `scripts/check-org-scope.mjs` in CI + self-tests. PRs #18, #24 |
| 7 | Typed `Connector`/`ScoreDefinition`/`ScoreResult`/API interfaces | `src/contracts/**` (barrel `index.ts`), zod-validated; `CANONICAL_METRICS` ≡ catalog seed contract test; API privacy by shape (strict person payloads, write-only credentials — tested); fixtures validate against contract vocabulary; score presets validate against `scoreComponentsSchema`. PRs #21, #23 |

## Freeze ceremony steps
1. Merge the chain: #18 → #19 → #21 → #23 → #24 → this PR, then the aggregate to `main`.
2. Founder confirms item-2 caveat (NLV verification folded into connector-facts.md).
3. Tag: `git tag contracts-v1 && git push origin contracts-v1` (on the merge commit).
4. From this tag on: `contract-guardian` runs on every PR; the `frozen-contracts`
   CI job blocks frozen-path changes lacking an ADR.
