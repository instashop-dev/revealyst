# 0022 — GitHub Copilot connector, agentic metrics, and the AI-credits unit

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** W4-T (Copilot connector + agentic metrics), founder

## Context

V1.5 ships the GitHub Copilot connector (Spec V3 §10.1) and adds agentic usage
metrics across all source vendors (§8.3). Both need **additive** changes to
frozen contracts, so they are ADR-gated (rule 1):

1. **Agentic metrics** (§8.3): measuring AI adoption in 2026 without agent usage
   "is measuring 2024." The frozen metric catalog (`CANONICAL_METRICS`,
   `METRIC_FAMILIES`, the `metric_catalog` seed) has no way to express
   agent-mediated work, so new catalog keys + a new `agentic` family are
   required. The frozen contract can express *what* a metric is but not these
   specific concepts.

2. **Copilot AI Credits** (§10.1): GitHub moved Copilot to usage-based **AI
   Credits** (2026-06-01). `ai_credits_used` is **credits, not cents** — there is
   no honest way to store it under any existing `METRIC_UNIT` (`usd_cents` would
   assert a dollar figure the vendor never gave; presenting credits as dollars is
   an invariant-(b) overclaim). A native `credits` unit is required. The frozen
   `metric_catalog.unit` text-enum and `METRIC_UNITS` must widen.

The Copilot **credential seam** (GitHub App auth) needs **no** contract change:
`authKind: "github_app"`, credential kinds `github_app_private_key` /
`github_app_installation`, `VendorId "github_copilot"`, and the
`connectionsCreate`/`connectionCredentialPut` enums were all frozen in at W0-C
in anticipation (W1-D). The App auth material (`{ appId, installationId,
privateKeyPem }`) is stored as ONE `github_app_private_key` credential row (JSON
blob) with app/installation ids also mirrored in non-secret `connections.config`
— so `credentialKindFor("github_app") → github_app_private_key` and the
one-kind `withCredential` seam work unchanged. This dissolves the historical
W2-J "multi-credential seam" blocker without widening the frozen
`ConnectorContext` (`credential: string`).

## Decision

Additively extend the frozen metric catalog:

- **`METRIC_FAMILIES` += `agentic`.** (`metric_catalog.family` is plain text — no
  DDL.)
- **`METRIC_UNITS` += `credits`**, and widen the `metric_catalog.unit` text-enum
  in `schema.ts` (TS-only; no DDL).
- **`CANONICAL_METRICS` += four keys**, seeded by migration `0022`:
  - `agent_sessions` (agentic, count) — Copilot CLI sessions; Claude Code
    sessions. (Copilot exposes no per-user coding-agent session count — a gap,
    not fabricated.)
  - `agent_requests` (agentic, count) — Cursor `agentRequests`; Copilot agent-mode
    + CLI requests.
  - `agent_active` (agentic, flag) — cross-vendor "used an agent this day".
  - `ai_credits` (spend, **credits**) — Copilot vendor-reported AI Credits;
    dollar conversion is deferred/estimated, never emitted as `spend_cents`.

Each source vendor maps ONLY the agent fields it genuinely reports (invariant b):
Cursor emits `agent_requests`/`agent_active` (no agent-session concept → no
`agent_sessions`); Claude Code emits `agent_sessions`/`agent_active` (no request
count → no `agent_requests`); Copilot emits all three where the fields exist.
`agent_requests` co-exists with `prompts` (an agent request *is* a prompt) —
different families, no within-family double count.

Ship the **`github_copilot` connector** against the usage-metrics reports API
(person-level per-user daily NDJSON, two-hop signed-link fetch, users×user-teams
join on subject meta, no sub-daily signals, `restatementWindowDays: 3`) plus a
GitHub App **install connect flow** (`/api/integrations/github/setup` +
`/callback`). The private key is sourced from the `GH_COPILOT_APP_PRIVATE_KEY`
Worker secret at connect time (one Revealyst app) and stored envelope-encrypted
per connection.

**Launch-UX gating (the "never present-tense an unshipped connector" rule):**
registration alone does NOT flip customer-facing surfaces, because the live
integration stays founder-gated (NLV run + deploy secrets) after this merges:

- **Marketing landing "Connects" strip:** Copilot is held in the "Soon" list
  **statically** via `NLV_PENDING_VENDORS` (`src/lib/vendor-connect-meta.ts`) —
  no runtime env check, the marketing page stays statically renderable.
  **Founder flip after the NLV run passes: remove `github_copilot` from that
  array — one line.** `scripts/verify/copilot.mjs` prints the reminder at the
  end of a successful run.
- **App connect surfaces** (connections page, onboarding wizard): gated at
  render time on the GitHub App secrets being configured
  (`readCopilotAppConfig` — the same check the setup route enforces). While
  unconfigured, the Copilot card shows an honest "Not yet available" state
  with no connect control; it flips automatically when the secrets sync, with
  no code change.

## Contracts affected

- **`src/contracts/metrics.ts`** — `METRIC_FAMILIES` (+`agentic`), `METRIC_UNITS`
  (+`credits`), `CANONICAL_METRICS` (+4 keys). Additive.
- **`src/db/schema.ts`** — `metric_catalog.unit` text-enum (+`credits`). No DDL.
- **`drizzle/0022_seed-agentic-and-credits-metrics.sql`** — seeds the 4 catalog
  rows (idempotent `ON CONFLICT DO NOTHING`). Migration numbering is an
  independent sequence from ADR numbering — both landing on 0022 here is
  coincidence, not a convention.
- **`docs/connector-facts.md`** — unchanged (the connector is built *against* §1;
  no facts revised).
- Credential shape, tenancy layer, `tracked_user` semantics — **unchanged.**

## Workstreams to re-sync

- **Shipped connectors (§10.2 maintenance):** Cursor and Anthropic normalize()
  gained the §8.3 agentic emissions — the one deliberate exception to
  maintenance-only posture. `sourceConnector` versions are unchanged (additive
  rows, no restatement of existing metrics), so no re-ingest is forced.
- **Scoring / Builder (W4 flagship):** the four new keys are available to score
  definitions and the Builder as ordinary Level-1 metrics. Any score that *uses*
  them is a new definition version, not an edit.
- **Glossary/methodology (W3-content):** `METRIC_REFERENCE` gained the four
  entries; the mirror test now reads `0007` + `0022`.

## Consequences

- **Credits ≠ dollars, enforced by type.** `ai_credits` (unit `credits`) can
  never be summed into `spend_cents`/`spend_cents_estimated`. Spend Governance
  (W4) renders it as credits; any cents conversion is a separate, labeled
  estimate — deferred to the founder-gated NLV run (facts NLV-C11/C12).
- **Copilot is daily-grain only** (`sub_daily_unavailable` gap on every batch);
  W2-K's shared-account heuristics degrade to daily for Copilot subjects, as the
  schema always anticipated.
- **The dollar-true billing permission stays deferred** (§10.1) — this ADR does
  NOT add the org "Administration (read)" scope.
- **Founder-gated follow-ups (not agent work):** the live NLV run
  (`scripts/verify/copilot.mjs`, 17 open items) against a real Copilot Business
  org, and wiring `GH_COPILOT_APP_*` into deploy secrets. The connector is
  registered and complete against fixtures; it becomes operational once the
  secrets are synced and NLV passes.
- **App private-key at-rest duplication:** storing the (single-app) private key
  in each connection's envelope trades a small secret-sprawl for keeping the
  frozen `ConnectorContext` untouched; each copy is separately AAD-bound, and
  rotation re-stores connections (rare, founder-gated). A classic-PAT fallback
  (`docs/approvals.md`) remains a documented degraded path.
